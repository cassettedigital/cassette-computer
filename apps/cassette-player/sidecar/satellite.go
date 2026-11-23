// Satellite computers (BUG-862, step 2 of the satellite computers plan).
//
// An account has one main computer (step 1, computer-id.go): it holds the library and reports it. Any
// other computer the person signs in is, to the cloud, one of two things (apps/cassette/src/lib/
// player-satellite.ts):
//
//   - spare: signed in, holding nothing. Its own music folder and its own music server carry on as
//     before for playing here, but it reports nothing and writes nothing into those files (no library
//     report, no MusicBrainz tags, no covers), since that music isn't the account's library. Its desk
//     greets it with "Bring your music to this computer?".
//   - satellite: the person said yes. It RECEIVES the account's music from the main computer over the
//     home Wi-Fi, the way the phones do, into a folder of its own ("Cassette from <main>", beside the
//     music folder), and its music server runs over that folder with a data folder of its own. Nothing
//     else on the computer is read or touched.
//
// The receiver is the USB filler's engine (usb.go) pointed at the main computer: the same instruction
// queue, inventory reports and one-pass-at-a-time rule, the source being the main computer's music
// server through its Wi-Fi gateway (lan-tls.go; address, login and certificate pin from /api/player/me,
// like the phones), copying original files whatever the phones' quality is.
//
// The founder's rule for satellites (2026-11-07): the main computer is the source, a satellite follows
// every change there without being told why and keeps nothing of its own. So every copy records the
// main computer's version of the song at the moment it is made (the audio fingerprint the main reports,
// read just before the copy), and a later mismatch means copy it again. A copy whose version was never
// known is copied again once one is. A version measured a new way (its kind, the part before ":",
// changed) is the same song, so it is taken as the new baseline instead of copying the library again.
// A folder cover travels only when the main computer's album has one, by the same rule.
//
// A satellite never rips, takes drop-ins, fills USB players, edits the library, or answers the phones.

package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	satelliteRole = "satellite"

	satelliteManifestFile = ".cassette-manifest.json"
	satelliteManifestVer  = 1

	// The cloud's reachable window is five minutes; the light on Devices stays on with this.
	satellitePresenceInterval = 2 * time.Minute
	// A Sync now click on the web queues instructions this has to notice.
	satelliteIntentPollInterval = 20 * time.Second
	// A full inventory report (the cloud reconciles on it) and the version check.
	satelliteReconcileInterval = 10 * time.Minute

	// Room a satellite leaves on its disk: the person's computer, not a card.
	satelliteFreeFloor = int64(2 << 30)

	// One original file over the home Wi-Fi.
	satelliteCopyTimeout = 30 * time.Minute

	// Its own name on the main computer's music server.
	satelliteClientName = "cassette-satellite"

	satelliteCopyWorkers = 2
)

// satelliteState is this computer's part in the account when it isn't the main one (sidecar.json).
type satelliteState struct {
	// Role is "satellite" once the person said "Bring my music here", else empty.
	Role string `json:"role,omitempty"`
	// Main is the main computer as the cloud last named it. Set while this computer isn't the main one.
	Main string `json:"main,omitempty"`
	// Folder is where the received music lands, chosen once when it became a satellite.
	Folder string `json:"folder,omitempty"`
	// Declined is "Keep <main> as main": the greeting doesn't come back by itself.
	Declined   bool      `json:"declined,omitempty"`
	JoinedAt   time.Time `json:"joinedAt,omitempty"`
	LastFillAt time.Time `json:"lastFillAt,omitempty"`
	LastError  string    `json:"lastError,omitempty"`
}

var (
	// satelliteOn: this run is a satellite (placeLibrary decided it before the music server started).
	satelliteOn atomic.Bool
	// notMainName: the main computer's name once the cloud refused this one as main; empty while this
	// computer is the main one, as far as anything has said.
	notMainName atomic.Value // string
	satMu       sync.Mutex
	satLive     struct {
		Syncing  bool
		Progress usbProgress
		Full     bool
		Pending  int
		Facts    *satelliteFacts
		FactsAt  time.Time
		Here     *satelliteHere
		HereAt   time.Time
		Bytes    *int64
		BytesAt  time.Time
		Reach    *bool
	}
	// The main computer's music-server ids mapped to this computer's own, rebuilt after each scan.
	satIndex atomic.Pointer[satelliteIndex]
)

func notMain() string {
	if v, ok := notMainName.Load().(string); ok {
		return v
	}
	return ""
}

// asSpare reports whether this hub must keep quiet about its own library: a satellite, or a computer the
// cloud has refused as main (or did last run, until a check-in says otherwise).
func asSpare() bool { return satelliteOn.Load() || notMain() != "" }

// ─── Where the library lives (before the music server starts) ────────────────

func satelliteNavidromeData() string { return filepath.Join(sidecarDataDir, "satellite-navidrome") }

// placeLibrary points this hub and its music server at the right folder before either starts: a
// satellite's received folder with its own music-server data, or a library the app's defaults don't name
// (a satellite made the main computer keeps the folder it received). Reads sidecar.json on its own,
// since the full state loads after the music server is up.
func placeLibrary() {
	b, err := os.ReadFile(statePath())
	if err != nil {
		return
	}
	var peek struct {
		Satellite      *satelliteState `json:"satellite"`
		LibraryDir     string          `json:"libraryDir"`
		LibraryData    string          `json:"libraryData"`
		LibraryDrive   string          `json:"libraryDrive"`
		LibraryOnDrive string          `json:"libraryOnDrive"`
	}
	if json.Unmarshal(b, &peek) != nil {
		return
	}
	dir, data := peek.LibraryDir, peek.LibraryData
	// A Cassette folder moved to an external drive that came back under another letter (Windows): follow it.
	if dir != "" && peek.LibraryDrive != "" {
		if _, err := os.Stat(dir); err != nil {
			if now, ok := findOnDrive(peek.LibraryDrive, peek.LibraryOnDrive); ok {
				dir = now
			}
		}
	}
	if s := peek.Satellite; s != nil {
		if s.Main != "" {
			notMainName.Store(s.Main)
		}
		if s.Role == satelliteRole && s.Folder != "" {
			dir, data = s.Folder, satelliteNavidromeData()
			satelliteOn.Store(true)
		}
	}
	if dir != "" {
		if err := makeMusicFolder(dir); err != nil {
			if satelliteOn.Load() {
				log.Printf("satellite: can't make the music folder %q: %v", dir, err)
				satelliteOn.Store(false)
				return
			}
			// A Cassette folder the person moved stays where they put it even while its drive is away:
			// falling back to the old folder would send music and rips to a place they left behind,
			// and the hub reads the away folder as away, never as empty (library-folders.go).
			log.Printf("folders: the Cassette folder %q isn't here (%v); waiting for its drive", dir, err)
		}
		sidecarMusicDir = dir
		os.Setenv("SIDECAR_MUSIC_DIR", dir)
		os.Setenv("ND_MUSICFOLDER", dir)
	}
	if data != "" {
		_ = os.MkdirAll(data, 0o755)
		os.Setenv("ND_DATAFOLDER", data)
	}
	if satelliteOn.Load() {
		log.Printf("satellite: this computer receives the music from %s into %s", peek.Satellite.Main, dir)
	}
}

// satelliteFolderFor is the folder a new satellite fills: beside the music folder, named for the main
// computer, never inside the person's own folder, and never one that's already there with other things
// in it.
func satelliteFolderFor(main string) string {
	parent := filepath.Dir(filepath.Clean(sidecarMusicDir))
	name := fatSafeSegment("Cassette from " + strings.TrimSpace(main))
	base := filepath.Join(parent, name)
	for i := 1; ; i++ {
		p := base
		if i > 1 {
			p = fmt.Sprintf("%s %d", base, i)
		}
		entries, err := os.ReadDir(p)
		if os.IsNotExist(err) || (err == nil && len(entries) == 0) {
			return p
		}
		if err == nil && len(entries) == 1 && entries[0].Name() == satelliteManifestFile {
			return p
		}
	}
}

// ─── The cloud's side (/api/player/computer) ──────────────────────────────────

type satelliteFacts struct {
	Role string `json:"role"`
	Main *struct {
		Name   string  `json:"name"`
		SeenAt *string `json:"seenAt"`
	} `json:"main"`
	Library struct {
		Songs   int `json:"songs"`
		Records int `json:"records"`
	} `json:"library"`
}

func computerCall(action string, extra map[string]any, out any) (int, error) {
	body := map[string]any{"computerId": computerID, "action": action}
	for k, v := range extra {
		body[k] = v
	}
	status, resp, err := cassetteAPI(http.MethodPost, "/api/player/computer", body)
	if err != nil {
		return 0, err
	}
	if status < 200 || status >= 300 {
		return status, fmt.Errorf("computer %s → %d (%.200s)", action, status, string(resp))
	}
	if out != nil && len(resp) > 0 {
		return status, json.Unmarshal(resp, out)
	}
	return status, nil
}

// askRole asks the cloud what this computer is, remembering the answer for the desk.
func askRole() (*satelliteFacts, error) {
	var f satelliteFacts
	if _, err := computerCall("role", nil, &f); err != nil {
		return nil, err
	}
	satMu.Lock()
	satLive.Facts, satLive.FactsAt = &f, time.Now()
	satMu.Unlock()
	return &f, nil
}

// noteRefusedAsMain is a check-in or sign-in the cloud refused because another computer is the main one.
// From here this hub reports nothing of its own. If the person already made it a satellite elsewhere
// (the switch made the old main one), it becomes one.
func noteRefusedAsMain(state *SidecarState, mainName string) {
	if satelliteOn.Load() {
		return
	}
	first := notMain() == ""
	if mainName != "" {
		notMainName.Store(mainName)
	} else if first {
		notMainName.Store("your main computer")
	}
	if first {
		log.Printf("satellite: the cloud says %s is this account's main computer; this one reports nothing of its own", notMain())
	}
	stateMu.Lock()
	if state.Satellite == nil {
		state.Satellite = &satelliteState{}
	}
	changed := state.Satellite.Main != notMain()
	state.Satellite.Main = notMain()
	stateMu.Unlock()
	if changed {
		_ = saveState(state)
	}
	if f, err := askRole(); err == nil && f.Role == satelliteRole {
		log.Printf("satellite: this computer was made a satellite of %s; starting again as one", notMain())
		becomeSatellite(state, false)
	}
}

// noteMain is a check-in the cloud took: this computer is the main one.
func noteMain(state *SidecarState) {
	if notMain() == "" {
		return
	}
	notMainName.Store("")
	stateMu.Lock()
	if state.Satellite != nil {
		state.Satellite.Main = ""
	}
	stateMu.Unlock()
	_ = saveState(state)
	log.Printf("satellite: the cloud takes this computer as the main one again")
}

// becomeSatellite records the role and starts the hub again, so the music server comes up over the
// received folder. The app's watchdog starts it again (a hub the app started keeps its sign-in in
// memory, and the app hands it over on every start).
func becomeSatellite(state *SidecarState, wait bool) {
	stateMu.Lock()
	if state.Satellite == nil {
		state.Satellite = &satelliteState{}
	}
	s := state.Satellite
	if s.Main == "" {
		s.Main = notMain()
	}
	s.Role = satelliteRole
	s.Declined = false
	if s.Folder == "" {
		s.Folder = satelliteFolderFor(s.Main)
	}
	s.JoinedAt = time.Now()
	stateMu.Unlock()
	if err := saveState(state); err != nil {
		log.Printf("satellite: couldn't save the role: %v", err)
		return
	}
	restartHub(wait)
}

func restartHub(wait bool) {
	go func() {
		if wait {
			time.Sleep(400 * time.Millisecond) // let the reply reach the desk
		}
		log.Println("Starting the hub again for its new role.")
		// The music server goes with it: the next start brings one up over the new folder, and one left
		// running would hold the port and keep serving the old folder.
		killSupervisedNavidrome()
		os.Exit(0)
	}()
}

// ─── The main computer, over the home Wi-Fi ─────────────────────────────────

type mainLink struct {
	base   string // https://host:port or http://host:port
	user   string
	pass   string
	client *http.Client
	at     time.Time
}

var (
	mainLinkMu sync.Mutex
	mainLinkV  *mainLink
)

// pinnedClient trusts exactly one certificate key, the main computer's (lan-tls.go): no name check, no
// public issuer, the way the phones do it.
func pinnedClient(pin string, timeout time.Duration) *http.Client {
	cfg := &tls.Config{
		InsecureSkipVerify: true, // replaced by the pin check below, which is the whole trust decision
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 {
				return errors.New("the main computer sent no certificate")
			}
			leaf, err := x509.ParseCertificate(raw[0])
			if err != nil {
				return err
			}
			sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
			got := base64.StdEncoding.EncodeToString(sum[:])
			if subtle.ConstantTimeCompare([]byte(got), []byte(pin)) != 1 {
				return errors.New("the computer on that address isn't the main computer (its key doesn't match)")
			}
			return nil
		},
	}
	tr := &http.Transport{
		TLSClientConfig:     cfg,
		DialContext:         (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		MaxIdleConnsPerHost: satelliteCopyWorkers + 1,
	}
	return &http.Client{Transport: tr, Timeout: timeout}
}

// theMain is how to reach the main computer's music server, from /api/player/me (kept ten minutes).
func theMain() (*mainLink, error) {
	mainLinkMu.Lock()
	defer mainLinkMu.Unlock()
	if mainLinkV != nil && time.Since(mainLinkV.at) < 10*time.Minute {
		return mainLinkV, nil
	}
	var me struct {
		LanHostname      string  `json:"lanHostname"`
		LanPort          int     `json:"lanPort"`
		LanTLSPin        *string `json:"lanTlsPin"`
		SubsonicUsername string  `json:"subsonicUsername"`
		SubsonicPassword string  `json:"subsonicPassword"`
	}
	if err := cloudJSON(http.MethodGet, "/api/player/me", nil, &me); err != nil {
		return nil, err
	}
	if me.LanHostname == "" || me.SubsonicUsername == "" {
		return nil, errors.New("the cloud has no address for the main computer")
	}
	port := me.LanPort
	if port <= 0 {
		port = 4533
	}
	host := net.JoinHostPort(me.LanHostname, strconv.Itoa(port))
	l := &mainLink{user: me.SubsonicUsername, pass: me.SubsonicPassword, at: time.Now()}
	if me.LanTLSPin != nil && *me.LanTLSPin != "" {
		l.base, l.client = "https://"+host, pinnedClient(*me.LanTLSPin, satelliteCopyTimeout)
	} else {
		// A main computer from before the encrypted gateway: plain, as its phones do.
		l.base, l.client = "http://"+host, &http.Client{Timeout: satelliteCopyTimeout}
	}
	mainLinkV = l
	return l, nil
}

func forgetMain() {
	mainLinkMu.Lock()
	mainLinkV = nil
	mainLinkMu.Unlock()
}

// restURL is a Subsonic call on the main computer, signed with the token form (salted MD5), never the
// password itself on the wire.
func (l *mainLink) restURL(endpoint string, q url.Values) string {
	if q == nil {
		q = url.Values{}
	}
	salt := newUUID()[:12]
	q.Set("u", l.user)
	q.Set("t", subsonicToken(l.pass, salt))
	q.Set("s", salt)
	q.Set("v", "1.16.1")
	q.Set("c", satelliteClientName)
	return l.base + "/rest/" + endpoint + "?" + q.Encode()
}

type mainSong struct {
	ID                 string `json:"id"`
	Title              string `json:"title"`
	Album              string `json:"album"`
	Artist             string `json:"artist"`
	DisplayAlbumArtist string `json:"displayAlbumArtist"`
	Track              int    `json:"track"`
	DiscNumber         int    `json:"discNumber"`
	Size               int64  `json:"size"`
	Suffix             string `json:"suffix"`
	AlbumID            string `json:"albumId"`
	CoverArt           string `json:"coverArt"`
	Duration           int    `json:"duration"`
}

func (l *mainLink) getJSON(endpoint string, q url.Values, out any) error {
	if q == nil {
		q = url.Values{}
	}
	q.Set("f", "json")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, l.restURL(endpoint, q), nil)
	if err != nil {
		return err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s → HTTP %d", endpoint, resp.StatusCode)
	}
	var env struct {
		R json.RawMessage `json:"subsonic-response"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<20)).Decode(&env); err != nil {
		return err
	}
	var head struct {
		Status string `json:"status"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(env.R, &head)
	if head.Status != "ok" {
		if head.Error != nil {
			return fmt.Errorf("%s: %s (%d)", endpoint, head.Error.Message, head.Error.Code)
		}
		return fmt.Errorf("%s: not ok", endpoint)
	}
	return json.Unmarshal(env.R, out)
}

func (l *mainLink) song(id string) (*mainSong, error) {
	var r struct {
		Song mainSong `json:"song"`
	}
	if err := l.getJSON("getSong", url.Values{"id": {id}}, &r); err != nil {
		return nil, err
	}
	if r.Song.ID == "" {
		return nil, errors.New("the main computer doesn't have that song")
	}
	return &r.Song, nil
}

// librarySize adds up every song's size on the main computer, for the greeting ("about 48 GB").
func (l *mainLink) librarySize() (int64, error) {
	var total int64
	for offset := 0; ; offset += libraryPageSize {
		var r struct {
			S struct {
				Song []mainSong `json:"song"`
			} `json:"searchResult3"`
		}
		q := url.Values{"query": {""}, "songCount": {strconv.Itoa(libraryPageSize)}, "songOffset": {strconv.Itoa(offset)}, "artistCount": {"0"}, "albumCount": {"0"}}
		if err := l.getJSON("search3", q, &r); err != nil {
			return 0, err
		}
		for _, s := range r.S.Song {
			total += s.Size
		}
		if len(r.S.Song) < libraryPageSize {
			return total, nil
		}
	}
}

// fetchTo streams one Subsonic answer (a song's original file, or a cover) into dst through a ".partial"
// file and a rename, so nothing half-copied is ever played. want > 0 is the size the main computer
// reported, checked before the file is kept. Returns the bytes written and the answer's content type.
func (l *mainLink) fetchTo(endpoint string, q url.Values, dst string, want int64) (int64, string, error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), satelliteCopyTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, l.restURL(endpoint, q), nil)
	if err != nil {
		return 0, "", err
	}
	resp, err := l.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != http.StatusOK {
		return 0, ct, fmt.Errorf("%s → HTTP %d", endpoint, resp.StatusCode)
	}
	// An error comes back as an XML or JSON envelope with status 200.
	if strings.Contains(ct, "xml") || strings.Contains(ct, "json") || strings.HasPrefix(ct, "text/") {
		return 0, ct, fmt.Errorf("%s answered %s, not a file", endpoint, ct)
	}
	tmp := dst + usbPartialExt
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, ct, err
	}
	n, err := io.Copy(out, resp.Body)
	if err == nil && n == 0 {
		err = errors.New("the main computer sent an empty file")
	}
	if err == nil && want > 0 && n != want {
		err = fmt.Errorf("got %d bytes of %d", n, want)
	}
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = replaceFile(tmp, dst) // a song playing here may be the one being replaced (BUG-913)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return 0, ct, err
	}
	return n, ct, nil
}

// ─── What's here (the manifest, in the received folder) ─────────────────────

// satTrack is one song this computer received.
type satTrack struct {
	Path   string `json:"path"`   // relative to the received folder, forward slashes
	MainID string `json:"mainId"` // the main computer's music-server id for it, as last heard
	Size   int64  `json:"size"`
	// Version is the main computer's version of the song when this copy was made ("" = it had none
	// yet, so this copy is untraceable and is copied again once there is one).
	Version  string    `json:"version"`
	CopiedAt time.Time `json:"copiedAt"`
}

// satCover is one album folder's cover, received from the main computer.
type satCover struct {
	File    string `json:"file"`
	Version string `json:"version"`
}

type satManifest struct {
	Version int                 `json:"version"`
	Tracks  map[string]satTrack `json:"tracks"`           // keyed by cassette_local_id
	Covers  map[string]satCover `json:"covers,omitempty"` // keyed by the album folder, relative
}

func satFolder(state *SidecarState) string {
	stateMu.Lock()
	defer stateMu.Unlock()
	if state.Satellite == nil {
		return ""
	}
	return state.Satellite.Folder
}

func satManifestPath(folder string) string { return filepath.Join(folder, satelliteManifestFile) }

func readSatManifest(folder string) satManifest {
	m := satManifest{Version: satelliteManifestVer, Tracks: map[string]satTrack{}, Covers: map[string]satCover{}}
	b, err := os.ReadFile(satManifestPath(folder))
	if err != nil {
		return m
	}
	var parsed satManifest
	if json.Unmarshal(b, &parsed) != nil || parsed.Tracks == nil {
		return m
	}
	if parsed.Covers == nil {
		parsed.Covers = map[string]satCover{}
	}
	parsed.Version = satelliteManifestVer
	return parsed
}

func writeSatManifest(folder string, m satManifest) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return atomicWriteFile(satManifestPath(folder), b, 0o644)
}

// satPath maps a manifest path to the file, never outside the received folder.
func satPath(folder, rel string) string {
	clean := filepath.Clean("/" + filepath.FromSlash(rel))
	return filepath.Join(folder, clean)
}

// satRelPath is where a song lands: <album artist>/<album>/<disc-track title>.<suffix>, from the main
// computer's tags, each part made safe for any disk. The same song always lands in the same place.
func satRelPath(s *mainSong) string {
	artist := strings.TrimSpace(s.DisplayAlbumArtist)
	if artist == "" {
		artist = strings.TrimSpace(s.Artist)
	}
	if artist == "" {
		artist = "Unknown artist"
	}
	album := strings.TrimSpace(s.Album)
	if album == "" {
		album = "Unknown album"
	}
	name := strings.TrimSpace(s.Title)
	if name == "" {
		name = s.ID
	}
	if s.Track > 0 {
		name = fmt.Sprintf("%02d %s", s.Track, name)
		if s.DiscNumber > 1 {
			name = fmt.Sprintf("%d-%s", s.DiscNumber, name)
		}
	}
	ext := strings.ToLower(strings.Trim(s.Suffix, ". "))
	if ext == "" {
		ext = "audio"
	}
	return fatSafeSegment(artist) + "/" + fatSafeSegment(album) + "/" + fatSafeSegment(name) + "." + fatSafeSegment(ext)
}

// versionKind is the part of a version before its colon ("a1", "f1"), or "" for one measured before kinds.
func versionKind(v string) string {
	if i := strings.IndexByte(v, ':'); i > 0 {
		return v[:i]
	}
	return ""
}

// copyVerdict is what a copy's recorded version against the main computer's current one asks for:
// "keep", "adopt" (the same song measured a new way: take the new one as the baseline) or "recopy".
func copyVerdict(recorded, current string) string {
	switch {
	case current == "" || recorded == current:
		return "keep" // no word from the main yet, or the same
	case recorded == "":
		return "recopy" // a copy whose version was never known is the satellite's own: follow the source
	case versionKind(recorded) != versionKind(current):
		return "adopt"
	}
	return "recopy"
}

// ─── The cloud's versions for songs (made-from, and the freshness check) ────

type satVersion struct {
	LocalID      string  `json:"cassette_local_id"`
	MainID       string  `json:"subsonic_track_id"`
	AudioVersion *string `json:"audio_version"`
	CoverVersion *string `json:"cover_version"`
}

func versionsFor(ids []string) (map[string]satVersion, error) {
	out := map[string]satVersion{}
	for i := 0; i < len(ids); i += 2000 {
		end := i + 2000
		if end > len(ids) {
			end = len(ids)
		}
		var r struct {
			Tracks []satVersion `json:"tracks"`
		}
		if _, err := computerCall("versions", map[string]any{"localIds": ids[i:end]}, &r); err != nil {
			return nil, err
		}
		for _, t := range r.Tracks {
			out[t.LocalID] = t
		}
	}
	return out, nil
}

func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ─── The receiver ─────────────────────────────────────────────────────────────

func satDevice(state *SidecarState) *usbDeviceRecord {
	// Its name as the person knows it (a Windows hub's Wi-Fi address is its number, lan-host_windows.go).
	label := "This computer"
	if h, err := os.Hostname(); err == nil && strings.TrimSpace(h) != "" {
		label = strings.ReplaceAll(strings.TrimSuffix(strings.TrimSpace(h), ".local"), "-", " ")
	}
	return &usbDeviceRecord{DeviceID: "computer-" + computerID, Label: label}
}

// satelliteLoop is the satellite's whole life after start: presence, the queue, the full report and the
// version check, one pass at a time.
func satelliteLoop(state *SidecarState) {
	if !satelliteOn.Load() {
		return
	}
	folder := satFolder(state)
	// A music server just started over this folder reads it first (a new one reads all of it): map the
	// main computer's ids once that's done, or songs here wouldn't play until the next change.
	waitForScanIdle(scanIdleMaxWait)
	rebuildSatIndex(folder)
	var lastPresence, lastReconcile time.Time
	for {
		if _, ok := bearer(); ok {
			now := time.Now()
			if now.Sub(lastPresence) >= satellitePresenceInterval {
				lastPresence = now
				f, err := askRole()
				switch {
				case err != nil:
					log.Printf("satellite: presence failed (will retry): %v", err)
				case f.Role != satelliteRole:
					// Taken off Devices (or made the main one): stop receiving. The folder stays as it is.
					log.Printf("satellite: the cloud no longer has this computer as a satellite (%s); stopping", f.Role)
					leaveSatellite(state)
					return
				}
			}
			reconcile := now.Sub(lastReconcile) >= satelliteReconcileInterval
			if reconcile {
				lastReconcile = now
			}
			satellitePass(state, folder, reconcile)
		}
		time.Sleep(satelliteIntentPollInterval)
	}
}

// leaveSatellite drops the role (the received folder is kept, untouched) and starts the hub again on the
// computer's own folder.
func leaveSatellite(state *SidecarState) {
	stateMu.Lock()
	if state.Satellite != nil {
		state.Satellite.Role = ""
	}
	stateMu.Unlock()
	_ = saveState(state)
	restartHub(false)
}

func satSetProgress(done, total int, current, phase string) {
	satMu.Lock()
	satLive.Progress = usbProgress{Done: done, Total: total, Current: current, Phase: phase}
	satMu.Unlock()
}

func satNote(state *SidecarState, msg string) {
	stateMu.Lock()
	if state.Satellite != nil {
		state.Satellite.LastError = msg
		if msg == "" {
			state.Satellite.LastFillAt = time.Now()
		}
	}
	stateMu.Unlock()
	_ = saveState(state)
}

// satelliteFreeBytes is the room left where the music lands (-1 when the disk won't say).
func satelliteFreeBytes(folder string) int64 { return diskFreeBytes(folder) }

func satHasRoom(free, need int64) bool { return free < 0 || free-need >= satelliteFreeFloor }

// satellitePass is one pass: (on a reconcile pass) the version check and a full report, then the queue.
func satellitePass(state *SidecarState, folder string, reconcile bool) {
	satMu.Lock()
	if satLive.Syncing {
		satMu.Unlock()
		return
	}
	satLive.Syncing = true
	full := satLive.Full
	satMu.Unlock()
	defer func() {
		satMu.Lock()
		satLive.Syncing = false
		satLive.Progress = usbProgress{}
		satMu.Unlock()
	}()

	// Room came back (the person freed some): adds go again.
	if full && satHasRoom(satelliteFreeBytes(folder), 0) {
		satMu.Lock()
		satLive.Full, full = false, false
		satMu.Unlock()
	}
	rec := satDevice(state)
	changed := false
	if reconcile && !full {
		if n := satRefresh(state, folder); n > 0 {
			changed = true
		}
	}
	if reconcile {
		m := readSatManifest(folder)
		pruned := 0
		for id, t := range m.Tracks {
			if _, err := os.Stat(satPath(folder, t.Path)); err != nil {
				delete(m.Tracks, id)
				pruned++
			}
		}
		if pruned > 0 {
			_ = writeSatManifest(folder, m)
			changed = true
		}
		// Songs here the map doesn't know yet (the music server hadn't read them): read and map again.
		if idx := satIndex.Load(); idx == nil || len(idx.byMain) < len(m.Tracks) {
			changed = true
		}
		if err := satPostInventoryFull(rec, m); err != nil {
			log.Printf("satellite: report of what's here failed: %v", err)
			return
		}
	}
	intents, err := usbFetchPendingIntents(rec.DeviceID)
	if err != nil {
		log.Printf("satellite: queue check failed: %v", err)
		return
	}
	satMu.Lock()
	satLive.Pending = len(intents)
	satMu.Unlock()
	for _, it := range intents {
		isRemove := it.IntentKind == "remove" || strings.HasPrefix(it.TargetID, "localid@")
		satMu.Lock()
		held := satLive.Full
		satMu.Unlock()
		if held && !isRemove {
			continue // out of room: adds wait, removes are what make room
		}
		if satProcessIntent(state, folder, rec, it) {
			changed = true
		}
	}
	if changed {
		finishSatChanges(folder)
		satMu.Lock()
		held := satLive.Full
		satMu.Unlock()
		if !held {
			satNote(state, "")
		}
	}
}

// finishSatChanges has the music server read the folder again and maps the main computer's ids to its own.
func finishSatChanges(folder string) {
	if err := triggerNavidromeScan(); err != nil {
		log.Printf("satellite: scan trigger failed: %v", err)
	}
	waitForScanIdle(scanIdleMaxWait)
	rebuildSatIndex(folder)
}

// satProcessIntent applies one instruction. Removes take out only what this computer received; adds copy
// the original files from the main computer, recording each one's version first.
func satProcessIntent(state *SidecarState, folder string, rec *usbDeviceRecord, it usbIntentJSON) bool {
	usbPutIntentState(it.ID, "syncing", "")
	tracks, err := usbFetchIntentTracks(it.ID)
	if err != nil {
		usbPutIntentState(it.ID, "failed", "Could not resolve tracks: "+err.Error())
		return false
	}
	m := readSatManifest(folder)

	if it.IntentKind == "remove" || strings.HasPrefix(it.TargetID, "localid@") {
		var removed []string
		for _, t := range tracks {
			e, ok := m.Tracks[t.CassetteLocalID]
			if !ok {
				continue // never received here: never touched
			}
			p := satPath(folder, e.Path)
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				log.Printf("satellite: remove %q failed: %v", p, err)
				continue
			}
			delete(m.Tracks, t.CassetteLocalID)
			removed = append(removed, t.CassetteLocalID)
			dropEmptyAlbum(folder, &m, filepath.Dir(p))
		}
		if err := writeSatManifest(folder, m); err != nil {
			log.Printf("satellite: manifest write failed: %v", err)
		}
		if err := usbPostInventoryDiff(rec, nil, removed); err != nil {
			log.Printf("satellite: report (remove) failed: %v", err)
		}
		usbPutIntentState(it.ID, "complete", "")
		return len(removed) > 0
	}

	var want []string
	for _, t := range tracks {
		if e, ok := m.Tracks[t.CassetteLocalID]; ok {
			if _, err := os.Stat(satPath(folder, e.Path)); err == nil {
				continue // already here
			}
		}
		want = append(want, t.CassetteLocalID)
	}
	if len(want) == 0 {
		usbPutIntentState(it.ID, "complete", "")
		return false
	}
	// The main computer's version of each song, read before its copy is made: that is what the copy is of.
	versions, err := versionsFor(want)
	if err != nil {
		usbPutIntentState(it.ID, "pending", "")
		log.Printf("satellite: versions unavailable (will retry): %v", err)
		return false
	}
	link, err := theMain()
	if err != nil {
		usbPutIntentState(it.ID, "pending", "")
		satNote(state, "Can't reach the main computer: "+err.Error())
		return false
	}
	byID := map[string]usbIntentTrackJSON{}
	for _, t := range tracks {
		byID[t.CassetteLocalID] = t
	}
	jobs, failed, roomOut, lastErr := satPlan(folder, link, want, byID, versions, m)
	added, copiedOK, fails := satRunCopies(folder, link, jobs, versions, &m, "copying")
	failed += fails
	if copiedOK > 0 {
		if err := usbPostInventoryDiff(rec, added, nil); err != nil {
			log.Printf("satellite: report (add) failed: %v", err)
		}
	}
	switch {
	case roomOut:
		satMu.Lock()
		satLive.Full = true
		satMu.Unlock()
		msg := fmt.Sprintf("Not enough room on this computer (%d GB free)", satelliteFreeBytes(folder)>>30)
		satNote(state, msg)
		usbPutIntentState(it.ID, "failed", msg)
	case failed > 0:
		usbPutIntentState(it.ID, "failed", fmt.Sprintf("%d of %d songs did not arrive: %s", failed, len(want), lastErr))
	default:
		usbPutIntentState(it.ID, "complete", "")
	}
	return copiedOK > 0
}

type satJob struct {
	localID string
	song    *mainSong
	rel     string
}

// satPlan asks the main computer for each song and sizes it against the room left, before anything copies.
func satPlan(folder string, link *mainLink, want []string, byID map[string]usbIntentTrackJSON, versions map[string]satVersion, m satManifest) (jobs []satJob, failed int, roomOut bool, lastErr string) {
	free := satelliteFreeBytes(folder)
	taken := map[string]string{}
	for id, t := range m.Tracks {
		taken[t.Path] = id
	}
	for _, id := range want {
		mainID := byID[id].SubsonicTrackID
		if v, ok := versions[id]; ok && v.MainID != "" {
			mainID = v.MainID
		}
		s, err := link.song(mainID)
		if err != nil {
			failed++
			lastErr = "the main computer couldn't find one"
			log.Printf("satellite: getSong %s failed: %v", mainID, err)
			continue
		}
		rel := satRelPath(s)
		if other, ok := taken[rel]; ok && other != id {
			// Two songs the tags would put in one place: the second keeps its own name.
			tag := id
			if len(tag) > 8 {
				tag = tag[:8]
			}
			rel = strings.TrimSuffix(rel, filepath.Ext(rel)) + " (" + tag + ")" + filepath.Ext(rel)
		}
		if !satHasRoom(free, s.Size) {
			roomOut = true
			break
		}
		if free >= 0 {
			free -= s.Size
		}
		taken[rel] = id
		jobs = append(jobs, satJob{localID: id, song: s, rel: rel})
	}
	return jobs, failed, roomOut, lastErr
}

// satRunCopies copies jobs a couple at a time, writing the manifest from one goroutine as each lands,
// with the version read before the copy. Album covers follow their songs.
func satRunCopies(folder string, link *mainLink, jobs []satJob, versions map[string]satVersion, m *satManifest, phase string) (added []usbInventoryItem, ok int, failed int) {
	if len(jobs) == 0 {
		return nil, 0, 0
	}
	byLocal := map[string]satJob{}
	usbJobs := make([]usbCopyJob, 0, len(jobs))
	for _, j := range jobs {
		byLocal[j.localID] = j
		usbJobs = append(usbJobs, usbCopyJob{localID: j.localID, subsonicID: j.song.ID, title: j.song.Title, rel: j.rel, dst: satPath(folder, j.rel), need: j.song.Size})
	}
	done := 0
	satSetProgress(0, len(jobs), "", phase)
	usbRunCopies(usbJobs, satelliteCopyWorkers, func(job usbCopyJob) (int64, usbCoverOutcome, error) {
		n, _, err := link.fetchTo("download", url.Values{"id": {job.subsonicID}}, job.dst, job.need)
		return n, usbCoverOutcome{}, err
	}, func(r usbCopyResult) {
		done++
		satSetProgress(done, len(jobs), r.job.title, phase)
		if r.err != nil {
			failed++
			log.Printf("satellite: copy of %q failed: %v", r.job.rel, r.err)
			return
		}
		j := byLocal[r.job.localID]
		v := versions[r.job.localID]
		if prev, had := m.Tracks[r.job.localID]; had && prev.Path != r.job.rel {
			_ = os.Remove(satPath(folder, prev.Path))
		}
		now := time.Now()
		m.Tracks[r.job.localID] = satTrack{Path: r.job.rel, MainID: j.song.ID, Size: r.size, Version: str(v.AudioVersion), CopiedAt: now}
		satEnsureCover(folder, link, m, j, str(v.CoverVersion))
		if err := writeSatManifest(folder, *m); err != nil {
			log.Printf("satellite: manifest write failed: %v", err)
		}
		added = append(added, usbInventoryItem{CassetteLocalID: r.job.localID, DownloadedAt: now.UTC().Format(time.RFC3339)})
		ok++
	})
	satSetProgress(len(jobs), len(jobs), "", "")
	return added, ok, failed
}

// satEnsureCover brings the album's folder cover over when the main computer's album has one (the cloud
// knows its version) and this folder's is missing or of another version. No version, no cover: a
// satellite never makes a picture the main computer doesn't have.
func satEnsureCover(folder string, link *mainLink, m *satManifest, j satJob, version string) {
	if version == "" {
		return
	}
	dir := filepath.ToSlash(filepath.Dir(j.rel))
	if c, ok := m.Covers[dir]; ok && c.Version == version {
		if _, err := os.Stat(satPath(folder, c.File)); err == nil {
			return
		}
	}
	id := j.song.AlbumID
	if id == "" {
		id = j.song.CoverArt
	}
	if id == "" {
		return
	}
	tmpRel := dir + "/.cover-incoming"
	n, ct, err := link.fetchTo("getCoverArt", url.Values{"id": {id}}, satPath(folder, tmpRel), 0)
	if err != nil || n == 0 {
		log.Printf("satellite: cover for %q didn't arrive: %v", dir, err)
		_ = os.Remove(satPath(folder, tmpRel))
		return
	}
	ext := ".jpg"
	switch {
	case strings.Contains(ct, "png"):
		ext = ".png"
	case strings.Contains(ct, "webp"):
		ext = ".webp"
	case strings.Contains(ct, "gif"):
		ext = ".gif"
	}
	file := dir + "/cover" + ext
	if prev, ok := m.Covers[dir]; ok && prev.File != file {
		_ = os.Remove(satPath(folder, prev.File))
	}
	if err := replaceFile(satPath(folder, tmpRel), satPath(folder, file)); err != nil {
		_ = os.Remove(satPath(folder, tmpRel))
		return
	}
	m.Covers[dir] = satCover{File: file, Version: version}
}

// dropEmptyAlbum removes an album folder once its last song is gone, and its cover with it: only what this
// computer put there, and only when nothing else is left in it.
func dropEmptyAlbum(folder string, m *satManifest, dir string) {
	rel, err := filepath.Rel(folder, dir)
	if err != nil || strings.HasPrefix(rel, "..") {
		return
	}
	key := filepath.ToSlash(rel)
	for _, t := range m.Tracks {
		if filepath.ToSlash(filepath.Dir(t.Path)) == key {
			return
		}
	}
	if c, ok := m.Covers[key]; ok {
		_ = os.Remove(satPath(folder, c.File))
		delete(m.Covers, key)
	}
	_ = os.Remove(dir)               // only if empty
	_ = os.Remove(filepath.Dir(dir)) // the artist folder, only if empty
}

// satRefresh is the version check: every song here against the main computer's current version. A
// changed song is copied again (no reasons asked), a new way of measuring is taken as the baseline, and
// the main computer's ids are kept current (a switch of main computer changes them). Returns how many
// songs or covers it copied again.
func satRefresh(state *SidecarState, folder string) int {
	m := readSatManifest(folder)
	if len(m.Tracks) == 0 {
		return 0
	}
	ids := make([]string, 0, len(m.Tracks))
	for id := range m.Tracks {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	versions, err := versionsFor(ids)
	if err != nil {
		log.Printf("satellite: version check unavailable: %v", err)
		return 0
	}
	var stale []string
	touched := false
	for _, id := range ids {
		v, ok := versions[id]
		if !ok {
			continue // not in the library now: the cloud's remove instruction handles it
		}
		e := m.Tracks[id]
		if v.MainID != "" && v.MainID != e.MainID {
			e.MainID, touched = v.MainID, true
		}
		switch copyVerdict(e.Version, str(v.AudioVersion)) {
		case "adopt":
			e.Version, touched = str(v.AudioVersion), true
		case "recopy":
			stale = append(stale, id)
		}
		m.Tracks[id] = e
	}
	if touched {
		_ = writeSatManifest(folder, m)
	}
	link, err := theMain()
	if err != nil {
		if len(stale) > 0 {
			log.Printf("satellite: %d songs changed on the main computer, which can't be reached: %v", len(stale), err)
		}
		return 0
	}
	refreshed := 0
	// Covers whose version moved (the person picked another on the main computer).
	for _, id := range ids {
		v, ok := versions[id]
		if !ok || str(v.CoverVersion) == "" {
			continue
		}
		e := m.Tracks[id]
		dir := filepath.ToSlash(filepath.Dir(e.Path))
		if c, ok := m.Covers[dir]; ok && c.Version == str(v.CoverVersion) {
			continue
		}
		s, err := link.song(e.MainID)
		if err != nil {
			continue
		}
		before := m.Covers[dir]
		satEnsureCover(folder, link, &m, satJob{localID: id, song: s, rel: e.Path}, str(v.CoverVersion))
		if m.Covers[dir] != before {
			refreshed++
			_ = writeSatManifest(folder, m)
		}
	}
	if len(stale) == 0 {
		return refreshed
	}
	log.Printf("satellite: copying %d songs again that changed on the main computer", len(stale))
	byID := map[string]usbIntentTrackJSON{}
	for _, id := range stale {
		byID[id] = usbIntentTrackJSON{CassetteLocalID: id, SubsonicTrackID: m.Tracks[id].MainID}
	}
	jobs, _, roomOut, _ := satPlan(folder, link, stale, byID, versions, m)
	_, ok, _ := satRunCopies(folder, link, jobs, versions, &m, "refreshing")
	if roomOut {
		satNote(state, "Not enough room on this computer to bring changed songs over")
	}
	return refreshed + ok
}

func satPostInventoryFull(rec *usbDeviceRecord, m satManifest) error {
	items := make([]usbInventoryItem, 0, len(m.Tracks))
	for id, t := range m.Tracks {
		items = append(items, usbInventoryItem{CassetteLocalID: id, DownloadedAt: t.CopiedAt.UTC().Format(time.RFC3339)})
	}
	return cloudJSON(http.MethodPost, "/api/sync/device-inventory", map[string]any{
		"device_id":    rec.DeviceID,
		"device_label": rec.Label,
		"full_state":   true,
		"items":        items,
	}, nil)
}

// ─── Playing here: the main computer's ids, this computer's songs ──────────

type satelliteIndex struct {
	byMain map[string]string // main computer's id → this music server's id
}

// rebuildSatIndex maps each received song (by its path in the folder) to this music server's id.
func rebuildSatIndex(folder string) {
	if folder == "" {
		return
	}
	m := readSatManifest(folder)
	songs, err := fetchAllSubsonicSongs()
	if err != nil {
		log.Printf("satellite: couldn't list this computer's songs: %v", err)
		return
	}
	// The music server may name the folder through a link (/tmp is /private/tmp on a Mac): compare real paths.
	real := func(p string) string {
		if r, err := filepath.EvalSymlinks(p); err == nil {
			return r
		}
		return filepath.Clean(p)
	}
	byPath := map[string]string{}
	for _, s := range songs {
		p := s.Path
		if !filepath.IsAbs(p) {
			p = filepath.Join(folder, p)
		}
		byPath[real(p)] = s.SubsonicTrackID
	}
	idx := &satelliteIndex{byMain: map[string]string{}}
	for _, t := range m.Tracks {
		if local, ok := byPath[real(satPath(folder, t.Path))]; ok && t.MainID != "" {
			idx.byMain[t.MainID] = local
		}
	}
	satIndex.Store(idx)
}

// localSongID is the id this computer's music server knows a song by, for an id the desk holds (the main
// computer's, from the cloud). Unchanged on the main computer; "" on a satellite for a song not here.
func localSongID(id string) string {
	if !satelliteOn.Load() {
		return id
	}
	if idx := satIndex.Load(); idx != nil {
		if local, ok := idx.byMain[id]; ok {
			return local
		}
	}
	return ""
}

// ─── What this computer holds of its own (for the switch screen) ────────────

type satelliteHere struct {
	Songs    int      `json:"songs"`
	Records  int      `json:"records"`
	localIDs []string // never to the desk
}

func countHere(state *SidecarState) (*satelliteHere, error) {
	satMu.Lock()
	if satLive.Here != nil && time.Since(satLive.HereAt) < 2*time.Minute {
		h := satLive.Here
		satMu.Unlock()
		return h, nil
	}
	satMu.Unlock()
	h := &satelliteHere{}
	if satelliteOn.Load() {
		m := readSatManifest(satFolder(state))
		dirs := map[string]bool{}
		for id, t := range m.Tracks {
			h.localIDs = append(h.localIDs, id)
			dirs[filepath.ToSlash(filepath.Dir(t.Path))] = true
		}
		h.Songs, h.Records = len(h.localIDs), len(dirs)
	} else {
		songs, err := fetchAllSubsonicSongs()
		if err != nil {
			return nil, err
		}
		records := map[string]bool{}
		seen := map[string]bool{}
		for _, s := range songs {
			if s.CassetteLocalID == "" || seen[s.CassetteLocalID] {
				continue
			}
			seen[s.CassetteLocalID] = true
			h.localIDs = append(h.localIDs, s.CassetteLocalID)
			artist := s.ArtistName
			if s.AlbumArtist != nil && *s.AlbumArtist != "" {
				artist = *s.AlbumArtist
			}
			records[strings.ToLower(artist)+"\x00"+strings.ToLower(s.AlbumName)] = true
		}
		h.Songs, h.Records = len(h.localIDs), len(records)
	}
	satMu.Lock()
	satLive.Here, satLive.HereAt = h, time.Now()
	satMu.Unlock()
	return h, nil
}

// ─── The desk's doors ─────────────────────────────────────────────────────────

func handleSatelliteStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	state := liveState
	role := "main"
	if satelliteOn.Load() {
		role = satelliteRole
	} else if notMain() != "" {
		role = "spare"
	}
	out := map[string]any{"ok": true, "role": role, "main": notMain()}
	if state == nil || role == "main" {
		writePlaybackJSON(w, http.StatusOK, out)
		return
	}
	stateMu.Lock()
	if s := state.Satellite; s != nil {
		out["declined"] = s.Declined
		out["folder"] = s.Folder
		if !s.LastFillAt.IsZero() {
			out["lastFillAt"] = s.LastFillAt.UTC().Format(time.RFC3339)
		}
		if s.LastError != "" {
			out["error"] = s.LastError
		}
	}
	stateMu.Unlock()

	satMu.Lock()
	facts, factsAt := satLive.Facts, satLive.FactsAt
	out["progress"], out["syncing"], out["full"], out["pending"] = satLive.Progress, satLive.Syncing, satLive.Full, satLive.Pending
	satMu.Unlock()
	if facts == nil || time.Since(factsAt) > time.Minute {
		if f, err := askRole(); err == nil {
			facts = f
		}
	}
	if facts != nil {
		out["library"] = facts.Library
		if facts.Main != nil {
			out["main"] = facts.Main.Name
			out["mainSeenAt"] = facts.Main.SeenAt
		}
	}
	if h, err := countHere(state); err == nil {
		out["here"] = h
	}
	where := sidecarMusicDir
	if f := satFolder(state); f != "" && satelliteOn.Load() {
		where = f
	}
	out["freeBytes"] = satelliteFreeBytes(where)
	// The greeting's "about 48 GB": the main computer's songs added up over the Wi-Fi, kept half an hour.
	if role == "spare" {
		satMu.Lock()
		bytes, at, reach := satLive.Bytes, satLive.BytesAt, satLive.Reach
		satMu.Unlock()
		if time.Since(at) > 30*time.Minute {
			ok := false
			if link, err := theMain(); err == nil {
				if n, err := link.librarySize(); err == nil {
					bytes, ok = &n, true
				}
			}
			reach = &ok
			satMu.Lock()
			satLive.Bytes, satLive.BytesAt, satLive.Reach = bytes, time.Now(), reach
			satMu.Unlock()
		}
		out["libraryBytes"], out["mainReachable"] = bytes, reach
	}
	writePlaybackJSON(w, http.StatusOK, out)
}

// handleSatelliteJoin is "Bring my music here".
func handleSatelliteJoin(w http.ResponseWriter, r *http.Request) {
	state := liveState
	if state == nil || satelliteOn.Load() || notMain() == "" {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "This computer isn't waiting to receive music."})
		return
	}
	label := satDevice(state).Label
	extra := map[string]any{"label": label, "model": runtime.GOOS, "appVersion": buildVersion}
	if status, err := computerCall("satellite", extra, nil); err != nil {
		code := http.StatusBadGateway
		if status == http.StatusConflict {
			code = http.StatusConflict
		}
		writePlaybackJSON(w, code, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	becomeSatellite(state, true)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "restarting": true})
}

// handleSatelliteKeepMain is "Keep <main> as main": signed in, holding nothing, no greeting by itself.
func handleSatelliteKeepMain(w http.ResponseWriter, r *http.Request) {
	state := liveState
	if state == nil || notMain() == "" {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false})
		return
	}
	stateMu.Lock()
	if state.Satellite == nil {
		state.Satellite = &satelliteState{Main: notMain()}
	}
	state.Satellite.Declined = true
	stateMu.Unlock()
	_ = saveState(state)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleSatellitePreview is the switch screen's counts: what would leave the library and the phones.
func handleSatellitePreview(w http.ResponseWriter, r *http.Request) {
	state := liveState
	if state == nil || notMain() == "" {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "This is the main computer."})
		return
	}
	h, err := countHere(state)
	if err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var counts map[string]any
	if _, err := computerCall("preview", map[string]any{"localIds": h.localIDs, "records": h.Records}, &counts); err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	counts["ok"] = true
	writePlaybackJSON(w, http.StatusOK, counts)
}

// handleSatelliteMakeMain is "Make this my main computer". The cloud counts again and refuses under the
// quarter line; on its yes this computer signs in as the main one (its music server gets the phones'
// login), keeps whichever folder it holds as the library, and starts again.
func handleSatelliteMakeMain(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Confirm bool `json:"confirm"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<12)).Decode(&req)
	state := liveState
	if state == nil || notMain() == "" || !req.Confirm {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "Nothing to switch."})
		return
	}
	h, err := countHere(state)
	if err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var res map[string]any
	status, err := computerCall("main", map[string]any{"localIds": h.localIDs, "records": h.Records, "confirm": true}, &res)
	if err != nil {
		code := http.StatusBadGateway
		if status == http.StatusConflict {
			code = http.StatusConflict
		}
		writePlaybackJSON(w, code, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	token, _ := bearer()
	if _, err := registerThisComputer(token); err != nil {
		// The slot is ours; the next start signs in again from the app and finishes this.
		log.Printf("satellite: made the main computer, but signing in as it failed (the next start retries): %v", err)
	}
	stateMu.Lock()
	if s := state.Satellite; s != nil && s.Role == satelliteRole && s.Folder != "" {
		// A satellite made the main computer keeps the folder it received, and its music server's data.
		state.LibraryDir, state.LibraryData = s.Folder, satelliteNavidromeData()
	}
	state.Satellite = nil
	stateMu.Unlock()
	notMainName.Store("")
	if err := saveState(state); err != nil {
		log.Printf("satellite: couldn't save the switch: %v", err)
	}
	restartHub(true)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "restarting": true})
}

// mainOnly is for a door that changes the library itself (rips, drop-ins, covers, removing records, USB
// players). On a satellite those happen on the main computer; on a spare there's no library here to change.
func mainOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if asSpare() {
			name := notMain()
			if name == "" {
				name = "your main computer"
			}
			writePlaybackJSON(w, http.StatusConflict, map[string]any{
				"ok": false, "error": "SATELLITE", "main": name,
				"message": "Your library lives on " + name + ". Do this there.",
			})
			return
		}
		next(w, r)
	}
}

// Where a person's music lives (board #1163, the founder 2026-11-23: "leave their music where it is").
//
// Two things, one screen:
//
//   - The Cassette folder: where music they add and discs they rip land, and the only folder the hub ever
//     writes into. It can be moved (to an external drive, say); the move copies it, switches over, and
//     leaves the old one exactly where it was for the person to put away themselves.
//   - Folders Cassette reads: a library they already keep somewhere (a big folder, an external drive, a
//     NAS), played where it is. Each is its own Navidrome library. The hub never writes into one: no
//     MusicBrainz tag, no folder picture, no rename, and Delete in Cassette hides a song rather than
//     putting its file in the Trash. That rule lives in songHeld (tag-writer.go) and folderArtAllowed
//     (folder-art-forward.go), the two doors every automatic write already goes through.
//
// A folder on a drive that's unplugged or a NAS that's asleep looks empty. The hub reads that as "away",
// never "deleted": while any folder is away it reports only what's new and never what's gone
// (library-sync.go), so no phone is told to drop a song because a drive went to sleep. The cloud's own
// floor (a full sync that loses three quarters of the library removes nothing) stays as the backstop.
//
// Changes: a folder on this computer's own disks gets change notices, like the Cassette folder; a network
// folder (where notices don't arrive for changes other machines make) is looked at every 15 minutes, two
// folder levels down, so the NAS isn't kept awake by a walk of every file.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// linkedFolder is one folder Cassette reads where it is.
type linkedFolder struct {
	Path      string    `json:"path"`
	LibraryID int       `json:"libraryId"`
	AddedAt   time.Time `json:"addedAt"`
	// Drive and OnDrive name the folder by its drive's own serial and its place on that drive (Windows),
	// so the hub can follow it when the drive comes back under another letter (followMovedDrives).
	Drive   string `json:"drive,omitempty"`
	OnDrive string `json:"onDrive,omitempty"`
}

// linkedRootsVal holds the linked folders' paths for readers on any goroutine (songHeld runs inside the
// MusicBrainz pass, the library sync and the tag writer). A []string, replaced whole.
var linkedRootsVal atomic.Value

func publishLinkedRoots(state *SidecarState) {
	roots := make([]string, 0, len(state.LinkedFolders))
	for _, f := range state.LinkedFolders {
		roots = append(roots, filepath.Clean(f.Path))
	}
	linkedRootsVal.Store(roots)
}

func linkedRoots() []string {
	r, _ := linkedRootsVal.Load().([]string)
	return r
}

// foldCase: macOS and Windows disks don't tell names apart by case, so neither does a path check.
var foldCase = runtime.GOOS == "darwin" || runtime.GOOS == "windows"

// pathWithin reports whether p is root or sits anywhere under it.
func pathWithin(root, p string) bool {
	root, p = filepath.Clean(root), filepath.Clean(p)
	if foldCase {
		root, p = strings.ToLower(root), strings.ToLower(p)
	}
	if p == root {
		return true
	}
	if !strings.HasSuffix(root, string(filepath.Separator)) {
		root += string(filepath.Separator)
	}
	return strings.HasPrefix(p, root)
}

// inLinkedFolder reports whether path is inside a folder Cassette only reads.
func inLinkedFolder(path string) bool {
	if path == "" {
		return false
	}
	for _, root := range linkedRoots() {
		if pathWithin(root, path) {
			return true
		}
	}
	return false
}

// linkedRootFor is the linked folder holding path, or "".
func linkedRootFor(path string) string {
	for _, root := range linkedRoots() {
		if pathWithin(root, path) {
			return root
		}
	}
	return ""
}

// ─── Here or away ─────────────────────────────────────────────────────────────

// linkedFolderHere: the folder answers and has something in it. A linked folder had music in it when it
// was added, so an empty one is a drive that's away (an unplugged disk's mount point, a sleeping share),
// not a library someone emptied.
func linkedFolderHere(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), ".") {
			return true
		}
	}
	return false
}

// musicFolderHere: the Cassette folder exists. It can be new and empty, so only its absence counts as away
// (its drive is unplugged).
func musicFolderHere() bool {
	info, err := os.Stat(sidecarMusicDir)
	return err == nil && info.IsDir()
}

// awayFolders lists every folder of this library that can't be read right now. Empty when all are here.
func awayFolders(state *SidecarState) []string {
	var away []string
	if !musicFolderHere() {
		away = append(away, sidecarMusicDir)
	}
	if state == nil {
		return away
	}
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	for _, f := range folders {
		if !linkedFolderHere(f.Path) {
			away = append(away, f.Path)
		}
	}
	return away
}

// makeMusicFolder creates the Cassette folder on a fresh install, but only where the place it belongs
// already exists. A Cassette folder moved to an external drive that's unplugged has no parent
// (/Volumes/Drive is gone), and creating it would quietly start a new, empty library on the computer's
// own disk under the drive's name.
func makeMusicFolder(dir string) error {
	if dir == "" {
		return nil
	}
	if info, err := os.Stat(dir); err == nil && info.IsDir() {
		return nil
	}
	if info, err := os.Stat(filepath.Dir(filepath.Clean(dir))); err != nil || !info.IsDir() {
		return fmt.Errorf("the place for %q isn't there (is its drive connected?)", dir)
	}
	return os.MkdirAll(dir, 0o755)
}

// ─── Navidrome's libraries ────────────────────────────────────────────────────

type navidromeLibrary struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Path string `json:"path"`
}

func navidromeAdminDo(method, path string, body any, out any) error {
	token, err := navidromeAdminLogin(navidromeAdmin)
	if err != nil {
		return err
	}
	return navidromeDo(token, method, path, body, out)
}

func navidromeDo(token, method, path string, body any, out any) error {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		rd = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, navidromeBase+path, rd)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-Nd-Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s %s: %d %.200s", method, path, resp.StatusCode, data)
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func navidromeLibraries(token string) ([]navidromeLibrary, error) {
	var libs []navidromeLibrary
	err := navidromeDo(token, http.MethodGet, "/api/library?_start=0&_end=1000", nil, &libs)
	return libs, err
}

// navidromeAddLibrary makes a Navidrome library over path, given to every new user, and returns its id.
// Navidrome starts watching and scanning it straight away.
func navidromeAddLibrary(token, name, path string) (int, error) {
	var res struct {
		ID json.RawMessage `json:"id"`
	}
	if err := navidromeDo(token, http.MethodPost, "/api/library",
		map[string]any{"name": name, "path": path, "defaultNewUsers": true}, &res); err != nil {
		return 0, err
	}
	id, err := strconv.Atoi(strings.Trim(string(res.ID), `"`))
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("library made but no id came back (%s)", res.ID)
	}
	return id, nil
}

// grantLibraryToPlayers gives every playback user (the phones sign in as one) the library. Navidrome only
// hands a new library to users made after it, so the user a phone already has would never see it.
func grantLibraryToPlayers(token string, libraryID int) error {
	users, err := navidromeListUsers(token)
	if err != nil {
		return err
	}
	var firstErr error
	for _, u := range users {
		if u.IsAdmin {
			continue // admins see every library already
		}
		var have []navidromeLibrary
		if err := navidromeDo(token, http.MethodGet, "/api/user/"+u.ID+"/library", nil, &have); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		ids := []int{libraryID}
		for _, l := range have {
			if l.ID == libraryID {
				ids = nil
				break
			}
			ids = append(ids, l.ID)
		}
		if ids == nil {
			continue
		}
		if err := navidromeDo(token, http.MethodPut, "/api/user/"+u.ID+"/library", map[string]any{"libraryIds": ids}, nil); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// reconcileLinkedFolders makes Navidrome agree with the hub's list once it's up: a library for every
// folder (a fresh music-server data folder has none) and every playback user given each one. It never
// removes a Navidrome library the hub didn't make. Retries while Navidrome is starting.
func reconcileLinkedFolders(state *SidecarState) {
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	if len(folders) == 0 || navidromeAdmin == "" {
		return
	}
	var token string
	for i := 0; i < 60; i++ {
		t, err := navidromeAdminLogin(navidromeAdmin)
		if err == nil {
			token = t
			break
		}
		time.Sleep(5 * time.Second)
	}
	if token == "" {
		log.Printf("folders: Navidrome never answered; the folders Cassette reads are checked again next start")
		return
	}
	followMovedDrives(state)
	stateMu.Lock()
	folders = append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	libs, err := navidromeLibraries(token)
	if err != nil {
		log.Printf("folders: can't list Navidrome's libraries: %v", err)
		return
	}
	byPath := map[string]int{}
	for _, l := range libs {
		byPath[filepath.Clean(l.Path)] = l.ID
	}
	changed := false
	for i, f := range folders {
		id, ok := byPath[filepath.Clean(f.Path)]
		if !ok {
			if !linkedFolderHere(f.Path) {
				continue // made when it's back; Navidrome refuses a folder it can't read
			}
			nid, err := navidromeAddLibrary(token, folderDisplayName(f.Path), f.Path)
			if err != nil {
				log.Printf("folders: can't give %q back to Navidrome: %v", f.Path, err)
				continue
			}
			id = nid
		}
		if id != f.LibraryID {
			folders[i].LibraryID = id
			changed = true
		}
		if err := grantLibraryToPlayers(token, id); err != nil {
			log.Printf("folders: can't give the phones %q: %v", f.Path, err)
		}
	}
	if changed {
		stateMu.Lock()
		state.LinkedFolders = folders
		stateMu.Unlock()
		if err := saveState(state); err != nil {
			log.Printf("folders: couldn't save: %v", err)
		}
	}
}

func folderDisplayName(path string) string {
	name := filepath.Base(filepath.Clean(path))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return path
	}
	return name
}

// ─── Adding and removing a folder ─────────────────────────────────────────────

var foldersMu sync.Mutex // one add, remove or move at a time

// checkLinkable says why path can't be a folder Cassette reads, or returns its clean real form.
func checkLinkable(state *SidecarState, raw string) (string, error) {
	p := strings.TrimSpace(raw)
	if p == "" || !filepath.IsAbs(p) {
		return "", errors.New("Choose a folder.")
	}
	p = filepath.Clean(p)
	if real, err := filepath.EvalSymlinks(p); err == nil {
		p = real
	}
	info, err := os.Stat(p)
	if err != nil || !info.IsDir() {
		return "", errors.New("That folder can't be opened.")
	}
	home, _ := os.UserHomeDir()
	if p == filepath.VolumeName(p)+string(filepath.Separator) || (home != "" && pathWithin(p, home)) {
		return "", errors.New("Choose the folder your music is in, not a whole disk or your home folder.")
	}
	overlaps := func(other string) bool {
		o := realClean(other)
		return pathWithin(p, o) || pathWithin(o, p)
	}
	if overlaps(sidecarMusicDir) {
		return "", errors.New("That's the Cassette folder, or holds it. Cassette already plays everything in it.")
	}
	if sidecarDataDir != "" && overlaps(sidecarDataDir) {
		return "", errors.New("That folder holds Cassette's own files.")
	}
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	for _, f := range folders {
		if overlaps(f.Path) {
			return "", fmt.Errorf("Cassette already reads %s.", f.Path)
		}
	}
	return p, nil
}

// realClean is p with any links in it followed, so two names for one folder compare equal.
func realClean(p string) string {
	if real, err := filepath.EvalSymlinks(p); err == nil {
		return real
	}
	return filepath.Clean(p)
}

// holdsMusic reports whether there's a song anywhere under dir, stopping at the first.
func holdsMusic(dir string) bool {
	found := errors.New("found")
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() && path != dir && strings.HasPrefix(d.Name(), ".") {
			return filepath.SkipDir
		}
		if !d.IsDir() && isLibraryAudio(path) {
			return found
		}
		return nil
	})
	return errors.Is(err, found)
}

type folderPathRequest struct {
	Path string `json:"path"`
}

func readFolderRequest(r *http.Request) (folderPathRequest, error) {
	var req folderPathRequest
	err := json.NewDecoder(io.LimitReader(r.Body, 1<<14)).Decode(&req)
	return req, err
}

// handleLibraryFoldersAdd is POST /api/library/folders/add {path}: read a folder where it is.
func handleLibraryFoldersAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlaybackJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	state := liveState
	req, err := readFolderRequest(r)
	if err != nil || state == nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Choose a folder."})
		return
	}
	if !foldersMu.TryLock() {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "Cassette is already changing your folders. Try again in a moment."})
		return
	}
	defer foldersMu.Unlock()

	p, err := checkLinkable(state, req.Path)
	if err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	if !holdsMusic(p) {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "There's no music in that folder."})
		return
	}
	token, err := navidromeAdminLogin(navidromeAdmin)
	if err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "Cassette's music server isn't answering. Try again in a moment."})
		return
	}
	id, err := navidromeAddLibrary(token, folderDisplayName(p), p)
	if err != nil {
		log.Printf("folders: add %q: %v", p, err)
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "Cassette couldn't read that folder. On a Mac, check Cassette may use files on that drive (System Settings, Privacy & Security)."})
		return
	}
	if err := grantLibraryToPlayers(token, id); err != nil {
		log.Printf("folders: give the phones %q: %v (the next start tries again)", p, err)
	}
	added := linkedFolder{Path: p, LibraryID: id, AddedAt: time.Now()}
	if serial, rel, ok := driveOf(p); ok {
		added.Drive, added.OnDrive = serial, rel
	}
	stateMu.Lock()
	state.LinkedFolders = append(state.LinkedFolders, added)
	stateMu.Unlock()
	publishLinkedRoots(state)
	if err := saveState(state); err != nil {
		log.Printf("folders: couldn't save: %v", err)
	}
	startLinkedWatch(p)
	log.Printf("folders: now reading %s (library %d)", p, id)
	go func() {
		// Navidrome scans the new library itself; the ingest waits for that scan and sends it up.
		time.Sleep(3 * time.Second)
		signalIngest()
	}()
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "path": p})
}

// handleLibraryFoldersRemove is POST /api/library/folders/remove {path}: stop reading a folder. Its files
// aren't touched; its songs leave the library (and the phones) on the next sync.
func handleLibraryFoldersRemove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlaybackJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	state := liveState
	req, err := readFolderRequest(r)
	if err != nil || state == nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Which folder?"})
		return
	}
	if !foldersMu.TryLock() {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "Cassette is already changing your folders. Try again in a moment."})
		return
	}
	defer foldersMu.Unlock()

	stateMu.Lock()
	idx := -1
	for i, f := range state.LinkedFolders {
		if filepath.Clean(f.Path) == filepath.Clean(req.Path) {
			idx = i
			break
		}
	}
	var gone linkedFolder
	if idx >= 0 {
		gone = state.LinkedFolders[idx]
	}
	stateMu.Unlock()
	if idx < 0 {
		writePlaybackJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "Cassette isn't reading that folder."})
		return
	}
	if gone.LibraryID > 1 { // never library 1, the Cassette folder
		if err := navidromeAdminDo(http.MethodDelete, "/api/library/"+strconv.Itoa(gone.LibraryID), nil, nil); err != nil {
			log.Printf("folders: remove library %d: %v", gone.LibraryID, err)
			writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "Cassette's music server isn't answering. Try again in a moment."})
			return
		}
	}
	stateMu.Lock()
	kept := state.LinkedFolders[:0]
	for _, f := range state.LinkedFolders {
		if filepath.Clean(f.Path) != filepath.Clean(gone.Path) {
			kept = append(kept, f)
		}
	}
	state.LinkedFolders = kept
	stateMu.Unlock()
	publishLinkedRoots(state)
	if err := saveState(state); err != nil {
		log.Printf("folders: couldn't save: %v", err)
	}
	log.Printf("folders: stopped reading %s", gone.Path)
	go func() {
		time.Sleep(3 * time.Second)
		signalIngest()
	}()
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── The list ─────────────────────────────────────────────────────────────────

type folderView struct {
	Path    string `json:"path"`
	Here    bool   `json:"here"`
	Network bool   `json:"network,omitempty"`
}

// handleLibraryFolders is GET /api/library/folders: the Cassette folder, the folders Cassette reads, and a
// move in progress or just finished.
func handleLibraryFolders(w http.ResponseWriter, r *http.Request) {
	state := liveState
	if state != nil {
		followMovedDrives(state)
	}
	out := map[string]any{
		"ok":       true,
		"cassette": folderView{Path: sidecarMusicDir, Here: musicFolderHere(), Network: musicFolderHere() && isNetworkFolder(sidecarMusicDir)},
		"linked":   []folderView{},
	}
	if state != nil {
		stateMu.Lock()
		folders := append([]linkedFolder(nil), state.LinkedFolders...)
		movedFrom := state.MovedFrom
		stateMu.Unlock()
		views := make([]folderView, 0, len(folders))
		for _, f := range folders {
			here := linkedFolderHere(f.Path)
			views = append(views, folderView{Path: f.Path, Here: here, Network: here && isNetworkFolder(f.Path)})
		}
		out["linked"] = views
		if movedFrom != "" {
			if _, err := os.Stat(movedFrom); err == nil {
				out["movedFrom"] = movedFrom
			}
		}
	}
	if m := currentMove(); m != nil {
		out["move"] = m
	}
	writePlaybackJSON(w, http.StatusOK, out)
}

// ─── Watching the folders Cassette reads ──────────────────────────────────────

const linkedLookInterval = 15 * time.Minute

var linkedEvents = make(chan struct{}, 1)

func noteLinkedFolderChanged() {
	select {
	case linkedEvents <- struct{}{}:
	default:
	}
}

var watchedLinked sync.Map // path → true once a change-notice watch runs on it

// startLinkedWatch asks for change notices on a folder on this computer's own disks (macOS). A network
// folder gets none: notices there only report this computer's own changes.
func startLinkedWatch(path string) {
	if isNetworkFolder(path) {
		return
	}
	if _, done := watchedLinked.LoadOrStore(filepath.Clean(path), true); done {
		return
	}
	if !watchLinkedFolder(path) {
		watchedLinked.Delete(filepath.Clean(path))
	}
}

// linkedSignature changes when a song folder is added, removed or renamed, or a song is added to or
// removed from one, in any linked folder that's here, or when a folder comes or goes. It reads folder
// dates three levels down (folder, artist, album) and no file, so a NAS isn't kept awake by it.
func linkedSignature(state *SidecarState) string {
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	h := fnv.New64a()
	for _, f := range folders {
		_, _ = h.Write([]byte(f.Path))
		if !linkedFolderHere(f.Path) {
			_, _ = h.Write([]byte{0})
			continue
		}
		hashDirDates(h, f.Path, 3)
	}
	return string(h.Sum(nil))
}

func hashDirDates(h io.Writer, dir string, depth int) {
	info, err := os.Stat(dir)
	if err != nil {
		return
	}
	var buf [8]byte
	m := info.ModTime().UnixNano()
	for i := range buf {
		buf[i] = byte(m >> (8 * i))
	}
	_, _ = h.Write([]byte(dir))
	_, _ = h.Write(buf[:])
	if depth <= 1 {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
			hashDirDates(h, filepath.Join(dir, e.Name()), depth-1)
		}
	}
}

// watchHereLinked starts change notices on every linked folder that's here (a drive that came back gets
// its notices again) and returns how many folders there are. Reads the disks outside the state lock: a
// sleeping NAS can take a while to answer.
func watchHereLinked(state *SidecarState) int {
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	for _, f := range folders {
		if linkedFolderHere(f.Path) {
			startLinkedWatch(f.Path)
		}
	}
	return len(folders)
}

// linkedWatcher looks at the linked folders after a change notice, and every 15 minutes regardless (for
// network folders, and for a drive coming back). A change runs the same ingest the Cassette folder's
// watcher does: Navidrome scans every library, then the library goes up to the cloud.
func linkedWatcher(state *SidecarState) {
	time.Sleep(30 * time.Second) // after the startup sync
	watchHereLinked(state)
	last := linkedSignature(state)
	ticker := time.NewTicker(linkedLookInterval)
	defer ticker.Stop()
	for {
		select {
		case <-linkedEvents:
			time.Sleep(ingestSettleWait)
		case <-ticker.C:
		}
		followMovedDrives(state)
		if watchHereLinked(state) == 0 || ripActive.Load() {
			continue
		}
		sig := linkedSignature(state)
		if sig == last {
			continue
		}
		last = sig
		log.Printf("folders: a folder Cassette reads changed (or came back): scanning")
		signalIngest()
	}
}

// ─── Moving the Cassette folder ───────────────────────────────────────────────

type moveProgress struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Phase  string `json:"phase"` // "copying" | "switching" | "error"
	Done   int64  `json:"doneBytes"`
	Total  int64  `json:"totalBytes"`
	Error  string `json:"error,omitempty"`
	Copied int    `json:"files"`
}

var (
	moveMu   sync.Mutex
	moveNow  *moveProgress
	moveBusy atomic.Bool
)

// folderMoveActive: the Cassette folder is being moved. Rips and adds wait for it.
func folderMoveActive() bool { return moveBusy.Load() }

func currentMove() *moveProgress {
	moveMu.Lock()
	defer moveMu.Unlock()
	if moveNow == nil {
		return nil
	}
	c := *moveNow
	return &c
}

func setMove(fn func(m *moveProgress)) {
	moveMu.Lock()
	defer moveMu.Unlock()
	if moveNow != nil {
		fn(moveNow)
	}
}

// moveDestination is where the Cassette folder goes when the person picks `chosen`: the folder itself when
// it's empty (or doesn't exist yet), otherwise a "Cassette" folder inside it. A copy left part-done by an
// earlier try (state.MovingTo) is picked up where it stopped.
func moveDestination(chosen, resuming string) (string, error) {
	dest := filepath.Clean(chosen)
	if real, err := filepath.EvalSymlinks(dest); err == nil {
		dest = real
	}
	empty := func(p string) bool {
		entries, err := os.ReadDir(p)
		if os.IsNotExist(err) {
			return true
		}
		if err != nil {
			return false
		}
		for _, e := range entries {
			if e.Name() != ".DS_Store" {
				return false
			}
		}
		return true
	}
	if resuming != "" && filepath.Clean(resuming) == dest {
		return dest, nil
	}
	if empty(dest) {
		return dest, nil
	}
	inner := filepath.Join(dest, "Cassette")
	if (resuming != "" && filepath.Clean(resuming) == inner) || empty(inner) {
		return inner, nil
	}
	return "", errors.New("There's already a Cassette folder there with things in it. Choose another place.")
}

// handleLibraryFoldersMove is POST /api/library/folders/move {path}: move the Cassette folder. Returns at
// once; GET /api/library/folders carries the progress. On another disk it copies, checks, switches and
// leaves the old folder where it was; on the same disk it's one rename.
func handleLibraryFoldersMove(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlaybackJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "POST only"})
		return
	}
	state := liveState
	req, err := readFolderRequest(r)
	if err != nil || state == nil || !filepath.IsAbs(strings.TrimSpace(req.Path)) {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "Choose where the Cassette folder goes."})
		return
	}
	fail := func(code int, msg string) {
		writePlaybackJSON(w, code, map[string]any{"ok": false, "error": msg})
	}
	if ripActive.Load() {
		fail(http.StatusConflict, "A disc is ripping. Move the folder when it's done.")
		return
	}
	if !musicFolderHere() {
		fail(http.StatusConflict, "The Cassette folder's drive isn't connected.")
		return
	}
	if !foldersMu.TryLock() {
		fail(http.StatusConflict, "Cassette is already changing your folders.")
		return
	}
	// foldersMu stays held by the move job until it finishes or fails.
	stateMu.Lock()
	resuming := state.MovingTo
	stateMu.Unlock()
	dest, err := moveDestination(strings.TrimSpace(req.Path), resuming)
	if err != nil {
		foldersMu.Unlock()
		fail(http.StatusBadRequest, err.Error())
		return
	}
	from := realClean(sidecarMusicDir)
	switch {
	case pathWithin(from, dest):
		foldersMu.Unlock()
		fail(http.StatusBadRequest, "That's inside the Cassette folder.")
		return
	case pathWithin(dest, from):
		foldersMu.Unlock()
		fail(http.StatusBadRequest, "That's where the Cassette folder already is.")
		return
	case inLinkedFolder(dest):
		foldersMu.Unlock()
		fail(http.StatusBadRequest, "That's inside a folder Cassette only reads, and Cassette never writes there.")
		return
	}
	if info, err := os.Stat(filepath.Dir(dest)); err != nil || !info.IsDir() {
		foldersMu.Unlock()
		fail(http.StatusBadRequest, "That place can't be opened.")
		return
	}

	moveMu.Lock()
	moveNow = &moveProgress{From: from, To: dest, Phase: "copying"}
	moveMu.Unlock()
	moveBusy.Store(true)
	stateMu.Lock()
	state.MovingTo = dest
	stateMu.Unlock()
	_ = saveState(state)
	goSafe("move the Cassette folder", func() {
		defer foldersMu.Unlock()
		if err := moveMusicFolder(state, from, dest); err != nil {
			log.Printf("folders: move to %s failed: %v", dest, err)
			setMove(func(m *moveProgress) { m.Phase, m.Error = "error", err.Error() })
			moveBusy.Store(false)
		}
	})
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "to": dest})
}

func moveMusicFolder(state *SidecarState, from, dest string) error {
	movedAcross := false
	if sameVolume(from, filepath.Dir(dest)) {
		// One rename: instant, nothing copied, nothing left behind. An empty folder the person picked is
		// taken away first so the rename can take its place.
		if entries, err := os.ReadDir(dest); err == nil {
			for _, e := range entries {
				if e.Name() == ".DS_Store" {
					_ = os.Remove(filepath.Join(dest, e.Name()))
				}
			}
			_ = os.Remove(dest) // only ever succeeds on an empty folder
		}
		if err := os.Rename(from, dest); err != nil {
			return fmt.Errorf("couldn't move the folder: %w", err)
		}
	} else {
		total, err := treeBytes(from)
		if err != nil {
			return fmt.Errorf("couldn't read the Cassette folder: %w", err)
		}
		setMove(func(m *moveProgress) { m.Total = total })
		if free := diskFreeBytes(filepath.Dir(dest)); free >= 0 && free < total+(1<<30) {
			return fmt.Errorf("There isn't room there: the Cassette folder needs %s.", humanBytes(total))
		}
		if err := os.MkdirAll(dest, 0o755); err != nil {
			return fmt.Errorf("couldn't make the folder there: %w", err)
		}
		// Twice: the second pass picks up anything that arrived while the first ran.
		for pass := 0; pass < 2; pass++ {
			setMove(func(m *moveProgress) { m.Done = 0 })
			if err := copyTree(from, dest); err != nil {
				return err
			}
		}
		if err := checkCopied(from, dest); err != nil {
			return err
		}
		movedAcross = true
	}
	setMove(func(m *moveProgress) { m.Phase = "switching" })

	stateMu.Lock()
	state.LibraryDir = dest
	state.LibraryDrive, state.LibraryOnDrive = "", ""
	if serial, rel, ok := driveOf(dest); ok {
		state.LibraryDrive, state.LibraryOnDrive = serial, rel
	}
	state.MovingTo = ""
	if movedAcross {
		state.MovedFrom = from
	} else {
		state.MovedFrom = ""
	}
	// Folder pictures go only into folders that arrive after this moment. A copy can give every
	// folder a new date, and the hub would otherwise take the whole moved library for new music and
	// start writing pictures into it.
	state.FolderArtSince = time.Now()
	// What the hub remembers per file moves with the files.
	if len(state.MBIDResolutionState) > 0 {
		moved := make(map[string]*MBIDFileState, len(state.MBIDResolutionState))
		for k, v := range state.MBIDResolutionState {
			moved[rebase(k, from, dest)] = v
		}
		state.MBIDResolutionState = moved
	}
	stateMu.Unlock()
	if err := saveState(state); err != nil {
		return fmt.Errorf("moved, but couldn't save where to: %w", err)
	}
	log.Printf("folders: the Cassette folder is now %s (was %s); starting again over it", dest, from)
	// The music server's song ids come from the tags, not the place, so every song keeps its id.
	restartHub(true)
	return nil
}

func rebase(p, from, to string) string {
	if !pathWithin(from, p) {
		return p
	}
	rel, err := filepath.Rel(from, p)
	if err != nil {
		return p
	}
	return filepath.Join(to, rel)
}

func treeBytes(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total, err
}

// copyTree copies every file under from into to, keeping names, dates and permissions. A file already
// there with the same size and date is left alone, so a second pass (or a retry) only copies what's new.
// Each file is written beside its place and renamed in, so nothing ever sees half a song.
func copyTree(from, to string) error {
	return filepath.WalkDir(from, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return fmt.Errorf("couldn't read %s: %w", path, err)
		}
		rel, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		target := filepath.Join(to, rel)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		switch {
		case d.IsDir():
			return os.MkdirAll(target, info.Mode().Perm()|0o700)
		case info.Mode()&fs.ModeSymlink != 0:
			link, err := os.Readlink(path)
			if err != nil {
				return err
			}
			if _, err := os.Lstat(target); err == nil {
				return nil
			}
			return os.Symlink(link, target)
		case !info.Mode().IsRegular():
			return nil
		}
		if have, err := os.Stat(target); err == nil && have.Size() == info.Size() && have.ModTime().Equal(info.ModTime()) {
			setMove(func(m *moveProgress) { m.Done += info.Size() })
			return nil
		}
		if err := copyOneFile(path, target, info); err != nil {
			return fmt.Errorf("couldn't copy %s: %w", rel, err)
		}
		setMove(func(m *moveProgress) { m.Done += info.Size(); m.Copied++ })
		return nil
	})
}

func copyOneFile(src, dst string, info os.FileInfo) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + ".cassette-moving"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm()|0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		_ = os.Remove(tmp) // our own half-written copy, never the person's file
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Chmod(tmp, info.Mode().Perm())
	_ = os.Chtimes(tmp, info.ModTime(), info.ModTime())
	return os.Rename(tmp, dst)
}

// checkCopied confirms every file in from is in to at the same size before the switch.
func checkCopied(from, to string) error {
	return filepath.WalkDir(from, func(path string, d fs.DirEntry, err error) error {
		if err != nil || !d.Type().IsRegular() {
			return nil
		}
		rel, _ := filepath.Rel(from, path)
		src, err := d.Info()
		if err != nil {
			return nil
		}
		dst, err := os.Stat(filepath.Join(to, rel))
		if err != nil || dst.Size() != src.Size() {
			return fmt.Errorf("the copy of %s didn't check out, so nothing was switched", rel)
		}
		return nil
	})
}

func humanBytes(n int64) string {
	const gb = 1 << 30
	if n >= gb {
		return fmt.Sprintf("%.1f GB", float64(n)/gb)
	}
	return fmt.Sprintf("%.0f MB", float64(n)/(1<<20))
}

// musicFolderReady is for a door that writes into the Cassette folder (a rip, an upload, a cover): it
// waits while the folder is being moved, and refuses while its drive is away, so nothing lands on this
// computer's own disk under the drive's name.
func musicFolderReady(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if folderMoveActive() {
			writePlaybackJSON(w, http.StatusConflict, map[string]any{
				"ok": false, "error": "MOVING", "message": "The Cassette folder is moving. Try again when it's done.",
			})
			return
		}
		if !musicFolderHere() {
			writePlaybackJSON(w, http.StatusConflict, map[string]any{
				"ok": false, "error": "AWAY", "message": "The Cassette folder's drive isn't connected.",
			})
			return
		}
		next(w, r)
	}
}

// ─── A drive that comes back under another letter ─────────────────────────────

var followMu sync.Mutex

// lookForDrive is findOnDrive, a variable so a test can stand in for Windows' drive letters.
var lookForDrive = findOnDrive

// followMovedDrives finds each away folder whose drive is back under another letter (Windows hands an
// external drive whichever letter is free) and points Cassette at its new place: the hub's list, the
// music server's library (song ids come from the tags and the library, so every song keeps its id), and
// what the hub remembers per file. A folder that's here and doesn't yet know its drive learns it. Reports
// whether anything moved.
func followMovedDrives(state *SidecarState) bool {
	if !followMu.TryLock() {
		return false
	}
	defer followMu.Unlock()
	stateMu.Lock()
	folders := append([]linkedFolder(nil), state.LinkedFolders...)
	stateMu.Unlock()
	moved, learned := false, false
	for i, f := range folders {
		if linkedFolderHere(f.Path) {
			if f.Drive == "" {
				if serial, rel, ok := driveOf(f.Path); ok {
					folders[i].Drive, folders[i].OnDrive = serial, rel
					learned = true
				}
			}
			continue
		}
		if f.Drive == "" {
			continue
		}
		now, ok := lookForDrive(f.Drive, f.OnDrive)
		if !ok || pathWithin(now, f.Path) {
			continue
		}
		if f.LibraryID > 1 {
			if err := navidromeRepointLibrary(f.LibraryID, now); err != nil {
				log.Printf("folders: %s is back at %s, but the music server didn't take it: %v", f.Path, now, err)
				continue
			}
		}
		log.Printf("folders: %s is back at %s (its drive has a new letter); following it", f.Path, now)
		stateMu.Lock()
		if len(state.MBIDResolutionState) > 0 {
			re := make(map[string]*MBIDFileState, len(state.MBIDResolutionState))
			for k, v := range state.MBIDResolutionState {
				re[rebase(k, f.Path, now)] = v
			}
			state.MBIDResolutionState = re
		}
		stateMu.Unlock()
		folders[i].Path = now
		moved = true
	}
	if !moved && !learned {
		return false
	}
	stateMu.Lock()
	// keep anything added meanwhile: write back only the folders this pass looked at, by library
	for i := range state.LinkedFolders {
		for _, f := range folders {
			if f.LibraryID == state.LinkedFolders[i].LibraryID && f.AddedAt.Equal(state.LinkedFolders[i].AddedAt) {
				state.LinkedFolders[i] = f
			}
		}
	}
	stateMu.Unlock()
	publishLinkedRoots(state)
	if err := saveState(state); err != nil {
		log.Printf("folders: couldn't save: %v", err)
	}
	if moved {
		go signalIngest()
	}
	return moved
}

// navidromeRepointLibrary moves a Navidrome library to its folder's new place, keeping everything else
// about it (read whole, changed, written back whole).
func navidromeRepointLibrary(id int, path string) error {
	token, err := navidromeAdminLogin(navidromeAdmin)
	if err != nil {
		return err
	}
	var lib map[string]any
	if err := navidromeDo(token, http.MethodGet, "/api/library/"+strconv.Itoa(id), nil, &lib); err != nil {
		return err
	}
	lib["path"] = path
	return navidromeDo(token, http.MethodPut, "/api/library/"+strconv.Itoa(id), lib, nil)
}

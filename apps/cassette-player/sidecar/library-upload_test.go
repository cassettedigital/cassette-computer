package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSanitizeRelPath(t *testing.T) {
	bad := []string{
		"../etc/passwd", "/../../etc/passwd", "a/../../b", "..", "foo/../../bar",
		"x/\x00/y", "", "/", "   ",
	}
	for _, b := range bad {
		if got, err := sanitizeRelPath(b); err == nil {
			t.Errorf("sanitizeRelPath(%q) = %q, nil err — want rejection", b, got)
		}
	}
	good := map[string]string{
		"Album/01 - Track.flac": filepath.Join("Album", "01 - Track.flac"),
		"track.mp3":             "track.mp3",
		"A/B/c.flac":            filepath.Join("A", "B", "c.flac"),
		"./x.flac":              "x.flac",
		"/leading/slash.flac":   filepath.Join("leading", "slash.flac"), // absolute → neutralized under music
	}
	for in, want := range good {
		got, err := sanitizeRelPath(in)
		if err != nil || got != want {
			t.Errorf("sanitizeRelPath(%q) = (%q,%v), want (%q,nil)", in, got, err, want)
		}
	}
}

func TestSniffAudio(t *testing.T) {
	cases := []struct {
		head []byte
		want bool
	}{
		{[]byte("fLaC\x00\x00\x00\x00"), true},    // FLAC
		{[]byte("ID3\x04\x00\x00\x00\x00"), true}, // ID3v2 (MP3)
		{[]byte{0xFF, 0xFB, 0x90, 0x00}, true},    // MPEG frame sync
		{[]byte("MZ\x90\x00"), false},             // PE/exe
		{[]byte("not audio at all"), false},       // text
		{[]byte("PK\x03\x04"), false},             // zip
		{[]byte(""), false},                       // empty
	}
	for _, c := range cases {
		if got := sniffAudio(c.head); got != c.want {
			t.Errorf("sniffAudio(%q) = %v, want %v", c.head, got, c.want)
		}
	}
}

func TestSniffAudioFor(t *testing.T) {
	ftyp := func(brand string) []byte { return []byte("\x00\x00\x00\x20ftyp" + brand) }
	cases := []struct {
		ext  string
		head []byte
		want bool
	}{
		{".m4a", ftyp("M4A "), true},             // iTunes Store AAC / ALAC
		{".m4a", ftyp("mp42"), true},             // other encoders
		{".m4a", ftyp("M4P "), false},            // copy-protected
		{".m4a", ftyp("M4V "), false},            // video
		{".m4a", []byte("fLaC\x00\x00\x00\x00"), false}, // FLAC renamed .m4a
		{".aac", []byte{0xFF, 0xF1, 0x50, 0x80}, true},     // ADTS
		{".aac", []byte{0xFF, 0xFB, 0x90, 0x00}, false},    // MP3 frame renamed .aac
		{".flac", []byte("fLaC\x00\x00\x00\x00"), true},
		{".mp3", ftyp("M4A "), false},
	}
	for _, c := range cases {
		if got := sniffAudioFor(c.ext, c.head); got != c.want {
			t.Errorf("sniffAudioFor(%s, %q) = %v, want %v", c.ext, c.head, got, c.want)
		}
	}
}

func TestSafeUploadDest_StaysUnderMusic(t *testing.T) {
	tmp := t.TempDir()
	old := sidecarMusicDir
	sidecarMusicDir = tmp
	defer func() { sidecarMusicDir = old }()
	rel, err := sanitizeRelPath("Album/x.flac")
	if err != nil {
		t.Fatal(err)
	}
	dest, err := safeUploadDest(rel)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(dest, filepath.Clean(tmp)+string(filepath.Separator)) {
		t.Errorf("dest %q not under music dir %q", dest, tmp)
	}
}

func uploadReq(relPath, content string) *http.Request {
	return httptest.NewRequest(
		http.MethodPost,
		"/api/library/upload?path="+url.QueryEscape(relPath),
		strings.NewReader(content),
	)
}

// The security gate end-to-end: a valid FLAC lands; bad magic, unsupported ext,
// and a traversal path are each rejected (400) and nothing escapes the music dir.
func TestHandleLibraryUpload_Safety(t *testing.T) {
	tmp := t.TempDir()
	old := sidecarMusicDir
	sidecarMusicDir = tmp
	defer func() { sidecarMusicDir = old }()
	drain := func() {
		select {
		case <-ingestTrigger:
		default:
		}
	}
	drain()

	// 1. valid FLAC → 200, lands at its sanitized path, fires ingest
	rec := httptest.NewRecorder()
	handleLibraryUpload(rec, uploadReq("Bon Iver - 22/01 - 22.flac", "fLaC"+strings.Repeat("a", 200)))
	if rec.Code != http.StatusOK {
		t.Fatalf("valid upload status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(tmp, "Bon Iver - 22", "01 - 22.flac")); err != nil {
		t.Errorf("valid FLAC did not land: %v", err)
	}
	select {
	case <-ingestTrigger:
	default:
		t.Error("valid upload did not trigger ingest")
	}

	// 2-4: each must be rejected (non-200) and must NOT land.
	rejects := map[string]string{
		"junk.flac":               "this is plainly not audio data", // bad magic
		"song.m4a":                "ftyp and more bytes here",       // not a real MP4
		"bought.m4p":              "\x00\x00\x00\x20ftypM4P " + strings.Repeat("c", 50), // copy-protected
		"song.wav":                "RIFF" + strings.Repeat("d", 50), // unsupported ext
		"../../../etc/evil.flac":  "fLaC" + strings.Repeat("b", 50), // path traversal
	}
	for relPath, content := range rejects {
		drain()
		rec := httptest.NewRecorder()
		handleLibraryUpload(rec, uploadReq(relPath, content))
		if rec.Code == http.StatusOK {
			t.Errorf("upload %q was accepted (status 200) — want rejection", relPath)
		}
	}

	// Exactly one .flac landed anywhere under the music dir; nothing escaped.
	count := 0
	_ = filepath.WalkDir(tmp, func(p string, d os.DirEntry, e error) error {
		if e == nil && !d.IsDir() && strings.HasSuffix(p, ".flac") {
			count++
		}
		return nil
	})
	if count != 1 {
		t.Errorf("expected exactly 1 landed .flac, got %d", count)
	}

	// 5. a real iTunes-style M4A → 200, lands byte-for-byte, fires ingest
	drain()
	m4a := string(buildM4A(false))
	rec = httptest.NewRecorder()
	handleLibraryUpload(rec, uploadReq("Bon Iver - For Emma/03 - Re- Stacks.m4a", m4a))
	if rec.Code != http.StatusOK {
		t.Fatalf("m4a upload status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	landed, err := os.ReadFile(filepath.Join(tmp, "Bon Iver - For Emma", "03 - Re- Stacks.m4a"))
	if err != nil || string(landed) != m4a {
		t.Errorf("m4a did not land unchanged (err %v)", err)
	}
	select {
	case <-ingestTrigger:
	default:
		t.Error("m4a upload did not trigger ingest")
	}
}

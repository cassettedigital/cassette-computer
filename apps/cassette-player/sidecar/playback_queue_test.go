package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeUpcoming stands in for the output engine: it records what setUpcoming is
// handed and reports a fixed transport index.
type fakeUpcoming struct {
	got        []resolvedTrack
	calls      int
	err        error
	queueIndex int
}

func (f *fakeUpcoming) play([]resolvedTrack, int, string) error { return nil }
func (f *fakeUpcoming) setUpcoming(items []resolvedTrack) error {
	f.calls++
	f.got = items
	return f.err
}
func (f *fakeUpcoming) pause() error                    { return nil }
func (f *fakeUpcoming) resume() error                   { return nil }
func (f *fakeUpcoming) next() error                     { return nil }
func (f *fakeUpcoming) prev() error                     { return nil }
func (f *fakeUpcoming) seek(float64) error              { return nil }
func (f *fakeUpcoming) setRepeat(string) error          { return nil }
func (f *fakeUpcoming) setVolume(float64) error         { return nil }
func (f *fakeUpcoming) writeLevels(http.ResponseWriter) {}
func (f *fakeUpcoming) shutdown()                       {}
func (f *fakeUpcoming) state() (playbackState, error) {
	return playbackState{QueueIndex: f.queueIndex}, nil
}

func withFakeEngine(t *testing.T, f *fakeUpcoming, queue []queueTrack) {
	t.Helper()
	prevOut := playbackOut
	queueMu.Lock()
	prevQueue := currentQueue
	queueMu.Unlock()
	playbackOut = f
	setCurrentQueue(queue)
	t.Cleanup(func() {
		playbackOut = prevOut
		setCurrentQueue(prevQueue)
	})
}

func postQueue(t *testing.T, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/playback/queue", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handlePlaybackQueue(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

// The songs after the current one are resolved like /play's (an implausible id is
// skipped) and handed over in order; the play-logging metadata keeps the current
// song and follows it with the new ones, so a logged play still finds its metadata.
func TestPlaybackQueue_ReplacesWhatComesNext(t *testing.T) {
	f := &fakeUpcoming{queueIndex: 1}
	withFakeEngine(t, f, []queueTrack{
		{SubsonicTrackID: "a", Title: "A"},
		{SubsonicTrackID: "b", Title: "B"},
		{SubsonicTrackID: "c", Title: "C"},
	})
	rec, out := postQueue(t, `{"queue":[{"subsonicTrackId":"x","title":"X"},{"subsonicTrackId":"bad id"},{"subsonicTrackId":" y ","title":"Y"}]}`)
	if rec.Code != http.StatusOK || out["ok"] != true || out["count"] != float64(2) {
		t.Fatalf("got %d %v, want 200 ok count 2", rec.Code, out)
	}
	if len(f.got) != 2 || f.got[0].TrackID != "x" || f.got[1].TrackID != "y" || !strings.Contains(f.got[0].URL, "id=x") {
		t.Fatalf("engine got %+v, want x then y with stream URLs", f.got)
	}
	want := []string{"a", "b", "x", "y"}
	queueMu.Lock()
	got := make([]string, len(currentQueue))
	for i, q := range currentQueue {
		got[i] = q.SubsonicTrackID
	}
	queueMu.Unlock()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("metadata queue = %v, want %v", got, want)
	}
	if meta, ok := queueTrackAt(1, "b"); !ok || meta.Title != "B" {
		t.Fatalf("the current song's metadata was lost: %+v %v", meta, ok)
	}
	if meta, ok := queueTrackAt(2, "x"); !ok || meta.Title != "X" {
		t.Fatalf("the first new song's metadata is missing: %+v %v", meta, ok)
	}
}

// An empty queue clears what's next: the engine is handed an empty list, not null.
func TestPlaybackQueue_EmptyClearsWhatsNext(t *testing.T) {
	f := &fakeUpcoming{queueIndex: 0}
	withFakeEngine(t, f, []queueTrack{{SubsonicTrackID: "a"}, {SubsonicTrackID: "b"}})
	rec, out := postQueue(t, `{"queue":[]}`)
	if rec.Code != http.StatusOK || out["count"] != float64(0) {
		t.Fatalf("got %d %v, want 200 count 0", rec.Code, out)
	}
	if f.calls != 1 || f.got == nil || len(f.got) != 0 {
		t.Fatalf("engine got %#v after %d calls, want one call with an empty list", f.got, f.calls)
	}
	if b, _ := json.Marshal(map[string]any{"queue": f.got}); string(b) != `{"queue":[]}` {
		t.Fatalf("the engine body would be %s, want an empty list", b)
	}
}

// With nothing loaded the engine keeps nothing, and neither does the metadata.
func TestPlaybackQueue_NothingLoadedKeepsMetadata(t *testing.T) {
	f := &fakeUpcoming{queueIndex: -1}
	withFakeEngine(t, f, []queueTrack{{SubsonicTrackID: "a"}})
	if rec, _ := postQueue(t, `{"queue":[{"subsonicTrackId":"x"}]}`); rec.Code != http.StatusOK {
		t.Fatalf("got %d, want 200", rec.Code)
	}
	if _, ok := queueTrackAt(0, "a"); !ok {
		t.Fatal("metadata changed although the engine had nothing loaded")
	}
}

func TestPlaybackQueue_BadBodyAndEngineFailure(t *testing.T) {
	f := &fakeUpcoming{queueIndex: 0}
	withFakeEngine(t, f, nil)
	for _, body := range []string{`{}`, `not json`, `{"queue":null}`} {
		if rec, _ := postQueue(t, body); rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: got %d, want 400", body, rec.Code)
		}
	}
	if f.calls != 0 {
		t.Fatalf("a bad body reached the engine %d times", f.calls)
	}
	f.err = errors.New("swift host down")
	rec, out := postQueue(t, `{"queue":[{"subsonicTrackId":"x"}]}`)
	if rec.Code != http.StatusBadGateway || out["error"] != "could not reach the native player" {
		t.Fatalf("got %d %v, want 502 could not reach the native player", rec.Code, out)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/playback/queue", nil)
	get := httptest.NewRecorder()
	handlePlaybackQueue(get, req)
	if get.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET got %d, want 405", get.Code)
	}
}

// BUG-791: a song the engine could not play is logged once, with its file, and
// a restarted helper (its count back at 1) is still heard.
func TestLogEngineFailures(t *testing.T) {
	var out strings.Builder
	prevOut, prevFlags, prevAdmin := log.Writer(), log.Flags(), navidromeAdmin
	log.SetOutput(&out)
	log.SetFlags(0)
	navidromeAdmin = "s3cret-admin-pw"
	t.Cleanup(func() { log.SetOutput(prevOut); log.SetFlags(prevFlags); navidromeAdmin = prevAdmin })

	lookups := 0
	pathOf := func(id string) (string, error) {
		lookups++
		if id == "gone" {
			return "", errors.New("not found")
		}
		return "/Music/Band/Album/" + id + ".flac", nil
	}
	failures := []playbackFailure{
		{Seq: 1, TrackID: "a", Error: "Cannot Open (AVFoundationErrorDomain -11849)"},
		{Seq: 2, TrackID: "gone", Error: "failed near u=cassette&p=s3cret-admin-pw"},
	}
	seen := logEngineFailures(failures, 0, pathOf)
	if seen != 2 {
		t.Fatalf("seen = %d, want 2", seen)
	}
	got := out.String()
	if !strings.Contains(got, `could not play "/Music/Band/Album/a.flac" (track a), skipped it: Cannot Open`) {
		t.Errorf("first failure not logged with its file:\n%s", got)
	}
	if !strings.Contains(got, "could not play track gone, skipped it") {
		t.Errorf("a failure whose file can't be found must still be logged:\n%s", got)
	}
	if strings.Contains(got, "s3cret-admin-pw") {
		t.Errorf("the stream password reached the log:\n%s", got)
	}

	// The next poll sees the same list: nothing new, nothing logged or looked up.
	out.Reset()
	lookups = 0
	if seen = logEngineFailures(failures, seen, pathOf); seen != 2 || out.Len() != 0 || lookups != 0 {
		t.Fatalf("a repeat poll logged again (seen=%d, lookups=%d):\n%s", seen, lookups, out.String())
	}

	// The helper restarted: its first failure is seq 1 again.
	seen = logEngineFailures([]playbackFailure{{Seq: 1, TrackID: "b", Error: "x"}}, seen, pathOf)
	if seen != 1 || !strings.Contains(out.String(), "(track b)") {
		t.Fatalf("a restarted helper's failure was missed (seen=%d):\n%s", seen, out.String())
	}

	// The state the helper sends decodes into the same shape.
	var st playbackState
	if err := json.Unmarshal([]byte(`{"currentTrackId":null,"queueIndex":-1,"queueLength":0,"failures":[{"seq":3,"trackId":"c","error":"e"}]}`), &st); err != nil {
		t.Fatal(err)
	}
	if len(st.Failures) != 1 || st.Failures[0].Seq != 3 || st.Failures[0].TrackID != "c" {
		t.Fatalf("decoded failures = %+v", st.Failures)
	}
}

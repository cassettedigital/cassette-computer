package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type seenSync struct {
	gzip    bool
	payload librarySyncPayload
}

func fakeLibraryCloud(t *testing.T, understandsGzip bool) (*httptest.Server, *[]seenSync) {
	var mu sync.Mutex
	var seen []seenSync
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body io.Reader = r.Body
		gz := r.Header.Get("Content-Encoding") == "gzip"
		if gz {
			if !understandsGzip {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"Invalid JSON body"}`))
				return
			}
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				t.Error(err)
				return
			}
			body = zr
		}
		var p librarySyncPayload
		if err := json.NewDecoder(body).Decode(&p); err != nil {
			t.Error(err)
			return
		}
		mu.Lock()
		seen = append(seen, seenSync{gz, p})
		mu.Unlock()
		_, _ = w.Write([]byte(`{"synced":0}`))
	}))
	t.Cleanup(srv.Close)
	return srv, &seen
}

func manyTracks(n int) []librarySyncTrack {
	out := make([]librarySyncTrack, n)
	for i := range out {
		out[i] = librarySyncTrack{SubsonicTrackID: fmt.Sprintf("t%d", i), TrackTitle: "x"}
	}
	return out
}

// TestLibrarySyncPagesABigLibrary (BUG-789): a big library goes up as compressed
// pages that only add, then one final page with every id that may remove.
func TestLibrarySyncPagesABigLibrary(t *testing.T) {
	srv, seen := fakeLibraryCloud(t, true)
	prev := cassetteBase
	cassetteBase = srv.URL
	t.Cleanup(func() { cassetteBase = prev })

	n := librarySyncPageTracks*2 + 5
	if err := postLibrarySync("tok", librarySyncPayload{Tracks: manyTracks(n), SyncMode: "full"}); err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 4 {
		t.Fatalf("want 3 pages + a final, got %d requests", len(*seen))
	}
	sent := 0
	for i, s := range (*seen)[:3] {
		if !s.gzip || s.payload.SyncMode != "delta" || s.payload.Page == nil || s.payload.Page.Final || s.payload.Page.Index != i {
			t.Errorf("page %d: %+v gzip=%v; pages must be compressed adds only", i, s.payload.Page, s.gzip)
		}
		sent += len(s.payload.Tracks)
	}
	final := (*seen)[3]
	if final.payload.SyncMode != "full" || final.payload.Page == nil || !final.payload.Page.Final {
		t.Errorf("final page wrong: %+v", final.payload.Page)
	}
	if sent != n || len(final.payload.AllTrackIDs) != n || len(final.payload.Tracks) != 0 {
		t.Errorf("sent %d tracks, final listed %d ids and %d tracks; want %d, %d, 0", sent, len(final.payload.AllTrackIDs), len(final.payload.Tracks), n, n)
	}
}

// TestLibrarySyncFallsBackForAnOlderCloud: an older cloud turns the first
// compressed page away before writing anything; the hub then sends the one
// uncompressed request it understands, never a partial "full".
func TestLibrarySyncFallsBackForAnOlderCloud(t *testing.T) {
	srv, seen := fakeLibraryCloud(t, false)
	prev := cassetteBase
	cassetteBase = srv.URL
	t.Cleanup(func() { cassetteBase = prev })

	n := librarySyncPageTracks + 1
	if err := postLibrarySync("tok", librarySyncPayload{Tracks: manyTracks(n), SyncMode: "full"}); err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 {
		t.Fatalf("want one accepted request, got %d", len(*seen))
	}
	s := (*seen)[0]
	if s.gzip || s.payload.Page != nil || s.payload.SyncMode != "full" || len(s.payload.Tracks) != n {
		t.Errorf("fallback should be the old single full request: gzip=%v page=%+v mode=%s tracks=%d", s.gzip, s.payload.Page, s.payload.SyncMode, len(s.payload.Tracks))
	}
}

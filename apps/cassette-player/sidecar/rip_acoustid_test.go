package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestGnudbHelloString(t *testing.T) {
	oldName, oldMail := gnudbClientName, gnudbContactMail
	t.Cleanup(func() { gnudbClientName, gnudbContactMail = oldName, oldMail })

	gnudbClientName, gnudbContactMail = "cassette", "fork@cassette.digital"
	if got, want := gnudbHelloString(), "fork cassette.digital cassette 1.0"; got != want {
		t.Errorf("hello = %q, want %q", got, want)
	}
	// No '@' → safe defaults for user/host, client name still applied.
	gnudbContactMail = "notanemail"
	if got, want := gnudbHelloString(), "cassette cassette.digital cassette 1.0"; got != want {
		t.Errorf("hello (bad email) = %q, want %q", got, want)
	}
}

// AcoustID's score is acoustic only; we gate results below acoustidMinScore and
// dedupe release MBIDs best-first.
func TestAcoustidReleasesFromResp(t *testing.T) {
	raw := `{
	  "status": "ok",
	  "results": [
	    {"id":"aid-1","score":0.97,"recordings":[
	      {"id":"rec-a","releases":[{"id":"rel-1"},{"id":"rel-2"}]},
	      {"id":"rec-b","releases":[{"id":"rel-2"}]}
	    ]},
	    {"id":"aid-2","score":0.30,"recordings":[
	      {"id":"rec-c","releases":[{"id":"rel-LOWSCORE"}]}
	    ]},
	    {"id":"aid-3","score":0.55,"recordings":[
	      {"id":"rec-d","releases":[{"id":"rel-3"}]}
	    ]}
	  ]
	}`
	var ar acoustIDResp
	if err := json.Unmarshal([]byte(raw), &ar); err != nil {
		t.Fatal(err)
	}
	got := acoustidReleasesFromResp(ar)
	want := []string{"rel-1", "rel-2", "rel-3"} // rel-2 deduped; rel-LOWSCORE gated out
	if !reflect.DeepEqual(got, want) {
		t.Errorf("release MBIDs = %v, want %v", got, want)
	}
}

func TestAcoustidResp_ErrorStatus(t *testing.T) {
	var ar acoustIDResp
	_ = json.Unmarshal([]byte(`{"status":"error","error":{"message":"invalid API key"}}`), &ar)
	if ar.Status != "error" || ar.Error == nil || ar.Error.Message != "invalid API key" {
		t.Errorf("error response not parsed: %+v", ar)
	}
	if got := acoustidReleasesFromResp(ar); len(got) != 0 {
		t.Errorf("error response should yield no releases, got %v", got)
	}
}

func TestAcoustidEnabled(t *testing.T) {
	t.Setenv("ACOUSTID_API_KEY", "")
	if acoustidEnabled() {
		t.Error("expected disabled with empty key")
	}
	t.Setenv("ACOUSTID_API_KEY", "abc123")
	if !acoustidEnabled() {
		t.Error("expected enabled with a key set")
	}
}

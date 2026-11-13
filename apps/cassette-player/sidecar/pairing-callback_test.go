package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// BUG-776: /callback only signs the hub in when the request came from this
// computer's own pairing, and never once it is paired.

// hit calls /callback and reports the status and whether it got as far as
// trying to register (which always leaves a result on the channel).
func hitCallback(t *testing.T, h *pairingHandler, results chan pairingResult, target string, key string) (int, bool) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if key != "" {
		req.Header.Set(localKeyHeader, key)
	}
	rec := httptest.NewRecorder()
	h.serveCallback(rec, req)
	select {
	case <-results:
		return rec.Code, true
	default:
		return rec.Code, false
	}
}

func TestCallbackRefusesStrangers(t *testing.T) {
	prevKey, prevSnap, prevAdmin := localKey, currentSnapshot.Load(), navidromeAdmin
	t.Cleanup(func() { localKey = prevKey; currentSnapshot.Store(prevSnap); navidromeAdmin = prevAdmin })
	localKey = "launch-key"
	navidromeAdmin = "" // a request that gets through stops at the first step, never the cloud
	currentSnapshot.Store(&statusSnapshot{Paired: false})

	results := make(chan pairingResult, 1)
	h := &pairingHandler{state: "wizard-code-0123456789", results: results}

	// A web page's <img src=...>: no key, no code.
	if code, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X", ""); tried || code != http.StatusForbidden {
		t.Fatalf("a token with no proof must be refused, got %d (tried=%v)", code, tried)
	}
	// A guessed code or a wrong key.
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=guess", "wrong"); tried {
		t.Fatal("a wrong code and key must be refused")
	}
	// DNS rebinding arrives with the attacker's own host name, even with the key.
	if code, tried := hitCallback(t, h, results, "http://evil.example:5173/callback?token=X", "launch-key"); tried || code != http.StatusForbidden {
		t.Fatalf("a foreign Host must be refused, got %d", code)
	}
	// BUG-857: the app started this hub, so the wizard's code is no proof, even a
	// correct one a rebinding page read off the first-run page.
	if code, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=wizard-code-0123456789", ""); tried || code != http.StatusForbidden {
		t.Fatalf("with the launch key set, the wizard's code must be refused, got %d (tried=%v)", code, tried)
	}
	// The app's own sign-in gets through.
	if _, tried := hitCallback(t, h, results, "http://localhost/callback?token=X", "launch-key"); !tried {
		t.Fatal("the app's key must be accepted")
	}
}

// A hub run without the app (no launch key) is signed in by the wizard's own
// round trip, and by nothing else.
func TestCallbackWizardRoundTripWithoutTheApp(t *testing.T) {
	prevKey, prevSnap, prevAdmin := localKey, currentSnapshot.Load(), navidromeAdmin
	t.Cleanup(func() { localKey = prevKey; currentSnapshot.Store(prevSnap); navidromeAdmin = prevAdmin })
	localKey = ""
	navidromeAdmin = ""
	currentSnapshot.Store(&statusSnapshot{Paired: false})

	results := make(chan pairingResult, 1)
	h := &pairingHandler{state: "wizard-code-0123456789", results: results}

	if code, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X", ""); tried || code != http.StatusForbidden {
		t.Fatalf("a token with no code must be refused, got %d (tried=%v)", code, tried)
	}
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=guess", ""); tried {
		t.Fatal("a guessed code must be refused")
	}
	// Any header claiming to be the key means nothing when no key was handed out.
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X", "anything"); tried {
		t.Fatal("a key header must not count when the hub has no key")
	}
	if code, tried := hitCallback(t, h, results, "http://evil.example:5173/callback?token=X&state=wizard-code-0123456789", ""); tried || code != http.StatusForbidden {
		t.Fatalf("a foreign Host must be refused even with the right code, got %d", code)
	}
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=wizard-code-0123456789", ""); !tried {
		t.Fatal("the wizard's own code must be accepted")
	}

	// An empty code (the hub could not mint one) never matches an empty state.
	h.state = ""
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=", ""); tried {
		t.Fatal("an empty code must never be accepted")
	}
}

// BUG-857: the first-run page, its status poll and the rip station check the
// Host like every other route, so a DNS-rebinding page can't read the sign-in
// code or the hub's state off them.
func TestNavigatedPagesRefuseForeignHost(t *testing.T) {
	prevSnap := currentSnapshot.Load()
	t.Cleanup(func() { currentSnapshot.Store(prevSnap) })
	currentSnapshot.Store(&statusSnapshot{Paired: false})

	authURL := buildAuthURL("wizard-code-0123456789")
	mux := newLocalMux(authURL, &pairingHandler{state: "wizard-code-0123456789", results: make(chan pairingResult, 1)})
	for _, path := range []string{"/", "/status.json", "/rip", "/anything-else"} {
		for _, host := range []string{"evil.test", "evil.test:5173", "localhost.evil.test:5173"} {
			req := httptest.NewRequest(http.MethodGet, "http://"+host+path, nil)
			req.Host = host
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Errorf("GET %s with Host %s = %d, want 403", path, host, rec.Code)
			}
			if strings.Contains(rec.Body.String(), "wizard-code-0123456789") {
				t.Errorf("GET %s with Host %s leaked the sign-in code", path, host)
			}
		}
		req := httptest.NewRequest(http.MethodGet, "http://localhost:5173"+path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s on localhost = %d, want 200", path, rec.Code)
		}
	}
}

// A hub the app started puts no sign-in link on its first-run page.
func TestWizardWithoutLinkOffersNoSignIn(t *testing.T) {
	page := wizardHTML("")
	if strings.Contains(page, "href=") || strings.Contains(page, "state=") {
		t.Fatal("the first-run page of an app-started hub must carry no sign-in link")
	}
	if !strings.Contains(wizardHTML(buildAuthURL("c0de")), "state=c0de") {
		t.Fatal("a hand-run hub's first-run page must still carry its sign-in link")
	}
}

func TestCallbackOncePairedOnlyTheAppCanChangeIt(t *testing.T) {
	prevKey, prevSnap, prevAdmin, prevDir, prevLive := localKey, currentSnapshot.Load(), navidromeAdmin, sidecarDataDir, liveState
	t.Cleanup(func() {
		localKey = prevKey
		currentSnapshot.Store(prevSnap)
		navidromeAdmin = prevAdmin
		sidecarDataDir = prevDir
		liveState = prevLive
	})
	localKey = "launch-key"
	navidromeAdmin = ""
	sidecarDataDir = t.TempDir() // never a real hub's saved sign-in
	// A fresh process (registered=false) running on a sign-in it holds in memory (BUG-859: none on disk).
	liveState = &SidecarState{BearerToken: "held"}
	if err := saveState(liveState); err != nil {
		t.Fatal(err)
	}

	results := make(chan pairingResult, 1)
	h := &pairingHandler{state: "wizard-code-0123456789", results: results}
	// A web page, even with the wizard's code: nothing changes.
	if code, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=X&state=wizard-code-0123456789", ""); tried || code != http.StatusOK {
		t.Fatalf("a paired hub must ignore everyone but the app, got %d (tried=%v)", code, tried)
	}
	// The app with the sign-in the hub already holds: nothing to do.
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=held", "launch-key"); tried {
		t.Fatal("the same sign-in must not register again")
	}
	// The app with a new sign-in (after Sign out, or another account): re-register.
	if _, tried := hitCallback(t, h, results, "http://localhost:5173/callback?token=new", "launch-key"); !tried {
		t.Fatal("the app's new sign-in must re-register the hub")
	}
}

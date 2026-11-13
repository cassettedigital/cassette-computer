package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestUsbTierParamsFollowTheDevicePageLabels(t *testing.T) {
	if tr, _, _ := usbTierParams("lossless"); tr {
		t.Fatal("lossless copies the original, never transcodes")
	}
	if tr, kbps, ext := usbTierParams("high"); !tr || kbps != 256 || ext != "mp3" {
		t.Fatalf("high = %v %d %s, want MP3 256", tr, kbps, ext)
	}
	if tr, kbps, ext := usbTierParams("efficient"); !tr || kbps != 128 || ext != "mp3" {
		t.Fatalf("efficient = %v %d %s, want MP3 128", tr, kbps, ext)
	}
	if tr, _, _ := usbTierParams("garbage"); tr {
		t.Fatal("an unknown tier must fall back to copying the original")
	}
}

func TestUsbEstimateBytes(t *testing.T) {
	four := 240
	// 128 kbps × 240 s = 3.84 MB, plus a tenth.
	if got := usbEstimateBytes(128, &four); got != 4_224_000 {
		t.Fatalf("estimate = %d", got)
	}
	if got := usbEstimateBytes(128, nil); got != 128*1000/8*300*11/10 {
		t.Fatalf("unknown duration must assume five minutes, got %d", got)
	}
}

func TestUsbTranscodeURLAsksNavidromeForTheTier(t *testing.T) {
	u := usbTranscodeURL("abc", "mp3", 128)
	for _, want := range []string{"/rest/stream?", "id=abc", "format=mp3", "maxBitRate=128"} {
		if !strings.Contains(u, want) {
			t.Fatalf("url %q lacks %q", u, want)
		}
	}
}

func TestStreamToFileAtomicKeepsAudioAndRefusesEnvelopes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("ID3mp3bytes"))
		case "/envelope":
			// Navidrome reports a transcoding failure as a 200 XML envelope.
			w.Header().Set("Content-Type", "text/xml")
			_, _ = w.Write([]byte(`<subsonic-response status="failed"/>`))
		case "/empty":
			w.Header().Set("Content-Type", "audio/mpeg")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	dir := t.TempDir()

	dst := filepath.Join(dir, "Cassette", "A", "B", "01 - Song.mp3")
	n, err := streamToFileAtomic(srv.URL+"/ok", dst)
	if err != nil || n != int64(len("ID3mp3bytes")) {
		t.Fatalf("ok stream: n=%d err=%v", n, err)
	}
	if b, _ := os.ReadFile(dst); string(b) != "ID3mp3bytes" {
		t.Fatalf("wrong bytes on card: %q", b)
	}
	if _, err := os.Stat(dst + usbPartialExt); !os.IsNotExist(err) {
		t.Fatal("partial left behind")
	}

	dst2 := filepath.Join(dir, "Cassette", "A", "B", "02 - Song.mp3")
	if _, err := streamToFileAtomic(srv.URL+"/envelope", dst2); err == nil {
		t.Fatal("an XML error envelope must not be kept as a track")
	}
	if _, err := os.Stat(dst2); !os.IsNotExist(err) {
		t.Fatal("envelope must leave no file")
	}
	if _, err := streamToFileAtomic(srv.URL+"/empty", dst2); err == nil {
		t.Fatal("an empty stream must not be kept as a track")
	}
	if _, err := streamToFileAtomic(srv.URL+"/missing", dst2); err == nil {
		t.Fatal("a 404 must fail")
	}
}

// A full card holds adds and lifts only once free space has grown past where
// it stalled by at least the reserve, or on a re-plug.
func TestUsbTickHoldsAFullCardUntilRoomAppears(t *testing.T) {
	card := t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "ECHO MINI", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-full", Label: "ECHO MINI"}); err != nil {
		t.Fatal(err)
	}
	liveState.UsbDevices = map[string]*usbDeviceRecord{"usb-full": {DeviceID: "usb-full", Label: "ECHO MINI"}}

	// Mount it (first tick), then mark it full at 1 MB free.
	usbTick(liveState)
	usbPasses.Wait()
	usbMu.Lock()
	live := usbLive["usb-full"]
	live.Syncing = false // the tick launched a pass; pretend it finished
	usbMu.Unlock()
	usbSetFull("usb-full", 1<<20)

	// fakeUSB reports 10 GB free, far past 1 MB + the reserve: the hold lifts.
	usbTick(liveState)
	usbPasses.Wait()
	usbMu.Lock()
	lifted := live.fullAtFree == 0
	usbMu.Unlock()
	if !lifted {
		t.Fatal("room came back but the hold did not lift")
	}

	// Full at MORE than the fake's free space: stays held, and the tick must
	// not ask for a reconcile pass.
	usbSetFull("usb-full", 20<<30)
	usbMu.Lock()
	live.Syncing = false
	live.lastReconcile = time.Time{}
	live.lastIntentPoll = time.Time{}
	usbMu.Unlock()
	usbTick(liveState)
	usbPasses.Wait()
	usbMu.Lock()
	stillHeld := live.fullAtFree > 0
	usbMu.Unlock()
	if !stillHeld {
		t.Fatal("hold lifted without room appearing")
	}

	// A re-plug earns a fresh attempt.
	withFakeUSB(t, nil)
	liveState.UsbDevices = map[string]*usbDeviceRecord{"usb-full": {DeviceID: "usb-full", Label: "ECHO MINI"}}
	usbMu.Lock()
	usbLive["usb-full"] = live
	usbMu.Unlock()
	usbTick(liveState) // unplugged
	usbPasses.Wait()
	usbOS = fakeUSB{vols: []usbVolume{{MountPath: card, Name: "ECHO MINI", Writable: true}}}
	usbSetFull("usb-full", 20<<30)
	usbMu.Lock()
	live.Syncing = false
	usbMu.Unlock()
	usbTick(liveState) // plugged back in
	usbPasses.Wait()
	usbMu.Lock()
	fresh := live.fullAtFree == 0
	usbMu.Unlock()
	if !fresh {
		t.Fatal("a re-plug must clear the hold")
	}
}

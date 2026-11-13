// Disc detection + TOC read (Chunk 3) — THE ONE DISC-PENDING SEAM.
//
// Everything else in the rip pipeline is fixture-verified without a disc. This
// file is the only part that needs a physical drive + audio CD: it shells out
// to libcdio's `cd-paranoia -Q` and parses the track table into a TOC.
//
// Offset convention: cd-paranoia reports each track's "begin" sector 0-based
// (track 1 begins at 0). MusicBrainz Disc IDs use absolute CD frames where
// track 1 sits at 150 (the 2-second pregap), so we add LEADIN_FRAMES (150) to
// every begin sector and to the leadout. This is the one assumption that can
// only be confirmed against a real disc — the rip orchestrator self-checks it
// by looking the computed Disc ID up on MusicBrainz; a wrong convention yields
// a not-found, which surfaces immediately on the first real rip.

package main

import (
	"fmt"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const leadInFrames = 150

// Right after a disc is inserted, cd-paranoia's device scan can race the mount and
// miss a disc macOS already sees. When macOS confirms a readable disc is present,
// re-probe a few times before giving up rather than flashing a false "no disc".
const (
	maxProbeRetries = 3
	probeRetryDelay = 1200 * time.Millisecond
)

// cd-paranoia -Q track rows look like:
//
//	"  1.    19377 [04:18.27]        0 [00:00.00]    no   no  2"
//
// groups: track number, length(sectors), begin(sectors)
var paranoiaTrackRe = regexp.MustCompile(`^\s*(\d+)\.\s+(\d+)\s+\[[\d:.]+\]\s+(\d+)\s+\[`)

// DiscDetectError distinguishes "no disc / no drive" (expected, retryable)
// from real failures, so the UI can say "insert a disc" vs "rip failed".
type DiscDetectError struct{ msg string }

func (e *DiscDetectError) Error() string { return e.msg }

// DriveProbe is the structured outcome of a TOC-read attempt (Job 3). It carries
// explicit drive/disc/permission state so the status payload — and the hosted
// panel — can render the right rung of the ladder by reading booleans instead
// of string-matching a human-readable message.
type DriveProbe struct {
	DrivePresent    bool
	DiscPresent     bool
	PermissionState string // "granted" | "denied" | "unknown"
	Message         string // human-readable, for logs and the panel's prose line
	TOC             *TOC   // non-nil only when a readable audio CD was parsed
}

// macTruth is macOS's own answer to "is there a drive / a disc?", independent of
// cd-paranoia — so detection never reports "no drive" when the OS plainly has one.
type macTruth struct {
	drivePresent bool
	discPresent  bool
}

// (macOSDriveTruth, opticalMediaPresent, and mountedAudioCDPresent — the macOS
// drive/disc presence probes — moved behind the disc platform seam in
// rip_platform_darwin.go. The OS-neutral parsers/classifiers they feed stay here.
// opticalMediaPresentCached, the TTL wrapper, moved to rip_platform.go so it can
// call discOS.opticalMediaPresent regardless of OS.)

// parseIORegOptical pulls (present, bsdName) from `ioreg -c IOCDMedia/IODVDMedia`.
// Presence requires a WHOLE media node (`"Whole" = Yes`); the BSD name is the
// whole-disk device (e.g. "disk14"). Split out so it's testable without a drive.
func parseIORegOptical(text string) (bool, string) {
	if !strings.Contains(text, `"Whole" = Yes`) {
		return false, ""
	}
	const key = `"BSD Name" = "`
	if i := strings.Index(text, key); i >= 0 {
		if j := strings.IndexByte(text[i+len(key):], '"'); j >= 0 {
			return true, text[i+len(key) : i+len(key)+j]
		}
	}
	return true, "" // loaded, but the BSD line was unreadable
}

// parseDrutilStatus reads `drutil status` text into a macTruth. Split out so it is
// unit-testable without a drive. A device line (vendor/product) means a drive
// exists; a real medium type ("Type: CD-ROM", not "Type: No Media") means a disc
// is loaded.
func parseDrutilStatus(text string) macTruth {
	low := strings.ToLower(strings.TrimSpace(text))
	if low == "" || strings.Contains(low, "no optical") {
		return macTruth{}
	}
	t := macTruth{drivePresent: true}
	if strings.Contains(low, "type:") && !strings.Contains(low, "no media") {
		t.discPresent = true
	}
	return t
}

// classifyDriveFailure maps a failed `cd-paranoia -Q` invocation to explicit
// drive/disc/permission state, with macOS's own `truth` (drutil + mounted audio CD)
// winning on PRESENCE — so we never tell the user "no drive/disc" when the OS plainly
// has them. cd-paranoia's text is still used for the permission signal and for the
// genuinely-no-drive case macOS couldn't confirm either way.
func classifyDriveFailure(text string, runErr error, truth macTruth) DriveProbe {
	low := strings.ToLower(text)
	if runErr != nil {
		low += "\n" + strings.ToLower(runErr.Error())
	}
	has := func(subs ...string) bool {
		for _, s := range subs {
			if strings.Contains(low, s) {
				return true
			}
		}
		return false
	}
	deniedByText := has("permission denied", "operation not permitted", "not permitted", "eacces", "authorization")

	// macOS confirms a DISC is loaded → it's physically there; cd-paranoia just
	// hasn't read it. Surface it as present (so the UI shows the disc, not "no
	// drive") and distinguish a permission wall from a transient/unreadable miss.
	if truth.discPresent {
		if deniedByText {
			return DriveProbe{
				DrivePresent: true, DiscPresent: true,
				PermissionState: "denied",
				Message:         "Cassette needs permission to read the disc drive.",
			}
		}
		return DriveProbe{
			DrivePresent: true, DiscPresent: true,
			PermissionState: "granted",
			Message:         "Disc detected — couldn't read it yet. Re-insert to retry.",
		}
	}
	// macOS confirms a DRIVE but no disc → ask for one, regardless of cd-paranoia.
	if truth.drivePresent {
		return DriveProbe{
			DrivePresent: true, DiscPresent: false,
			PermissionState: "granted",
			Message:         "Insert an audio CD to rip.",
		}
	}

	// macOS couldn't confirm a drive — fall back to cd-paranoia's own text.
	switch {
	// macOS gates raw optical-device reads; the device opens but the read is
	// denied. This is the trigger for Job 6's attempt-driven permission gate.
	case deniedByText:
		return DriveProbe{
			DrivePresent: true, DiscPresent: false,
			PermissionState: "denied",
			Message:         "Cassette needs permission to read the disc drive.",
		}
	// Drive present but empty / unreadable medium.
	case has("no medium found", "unable to open disc", "no audio tracks", "medium not present", "no tracks"):
		return DriveProbe{
			DrivePresent: true, DiscPresent: false,
			PermissionState: "granted",
			Message:         "Insert an audio CD to rip.",
		}
	// No optical drive at all — nothing to open.
	case has("could not find a way to read audio", "unable to open cdrom",
		"no such file", "no cd-rom", "no device", "no drive"):
		return DriveProbe{
			DrivePresent: false, DiscPresent: false,
			PermissionState: "unknown",
			Message:         "No disc drive detected. Attach a CD drive.",
		}
	default:
		// Unrecognized failure: don't assert drive/permission state we can't
		// substantiate. Surface the raw first line so the panel shows the real
		// reason rather than a confident-but-wrong label.
		msg := "Couldn't read the disc drive."
		if t := firstNonEmptyLine(text); t != "" {
			msg = t
		} else if runErr != nil {
			msg = runErr.Error()
		}
		return DriveProbe{
			DrivePresent: false, DiscPresent: false,
			PermissionState: "unknown",
			Message:         msg,
		}
	}
}

// firstNonEmptyLine returns the first non-blank, trimmed line of s (for surfacing
// an unrecognized cd-paranoia error without dumping the whole banner).
func firstNonEmptyLine(s string) string {
	for _, line := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			return t
		}
	}
	return ""
}

// parseParanoiaTOC turns cd-paranoia -Q output into a TOC. Split out so the
// parser itself is unit-testable with a captured sample (rip_toc_test.go),
// independent of any drive. rawBegins holds cd-paranoia's 0-based begin sectors
// before the +150 MusicBrainz adjustment (for TEMP TOC diagnostics).
func parseParanoiaTOC(text string) (*TOC, []int, error) {
	type row struct{ num, begin, length int }
	var rows []row
	for _, line := range strings.Split(text, "\n") {
		m := paranoiaTrackRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		num, _ := strconv.Atoi(m[1])
		length, _ := strconv.Atoi(m[2])
		begin, _ := strconv.Atoi(m[3])
		rows = append(rows, row{num: num, begin: begin, length: length})
	}
	if len(rows) == 0 {
		return nil, nil, &DiscDetectError{msg: "no audio tracks found in cd-paranoia output"}
	}

	toc := &TOC{FirstTrack: rows[0].num, LastTrack: rows[len(rows)-1].num}
	rawBegins := make([]int, 0, len(rows))
	for _, r := range rows {
		rawBegins = append(rawBegins, r.begin)
		toc.TrackOffsets = append(toc.TrackOffsets, r.begin+leadInFrames)
	}
	last := rows[len(rows)-1]
	toc.LeadoutOffset = last.begin + last.length + leadInFrames
	return toc, rawBegins, nil
}

// logTemporaryTOC prints a one-shot diagnostic bundle for disc-ID / pregap
// investigation. Remove once the real-drive TOC is captured and verified.
func logTemporaryTOC(rawParanoia string, rawBegins []int, toc *TOC, discID string) {
	log.Printf("TEMP TOC-DIAG: ── cd-paranoia -Q raw output ──")
	for _, line := range strings.Split(rawParanoia, "\n") {
		if strings.TrimSpace(line) != "" {
			log.Printf("TEMP TOC-DIAG: | %s", line)
		}
	}
	log.Printf("TEMP TOC-DIAG: raw begin sectors (before +%d): %v", leadInFrames, rawBegins)
	log.Printf("TEMP TOC-DIAG: parsed first=%d last=%d leadout=%d (+150 convention)",
		toc.FirstTrack, toc.LastTrack, toc.LeadoutOffset)
	log.Printf("TEMP TOC-DIAG: parsed track offsets (+150): %v", toc.TrackOffsets)
	log.Printf("TEMP TOC-DIAG: computed disc ID=%q", discID)
	log.Printf("TEMP TOC-DIAG: MusicBrainz TOC lookup URL=%s", mbTOCLookupURL(toc))
}

// mbTOCLookupURL builds https://musicbrainz.org/ws/2/discid/-?toc=… for diagnostics.
func mbTOCLookupURL(toc *TOC) string {
	parts := fmt.Sprintf("%d+%d+%d", toc.FirstTrack, toc.LastTrack, toc.LeadoutOffset)
	for _, o := range toc.TrackOffsets {
		parts += fmt.Sprintf("+%d", o)
	}
	return "https://musicbrainz.org/ws/2/discid/-?toc=" + parts + "&fmt=json"
}

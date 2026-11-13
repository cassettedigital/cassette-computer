package main

import "testing"

// parseIORegOptical reads physical optical-media presence from IOKit — the signal
// that survives a drive spin-down (when Disk Arbitration has dropped the volume).
func TestParseIORegOptical(t *testing.T) {
	loaded := `+-o ASUS SDRW-08D2S-U Media  <class IOCDMedia, id 0x10016941a, registered>
    {
      "Whole" = Yes
      "BSD Name" = "disk14"
      "Type" = "CD-ROM"
    }`
	if ok, bsd := parseIORegOptical(loaded); !ok || bsd != "disk14" {
		t.Errorf("loaded disc: ok=%v bsd=%q, want true/disk14", ok, bsd)
	}
	if ok, _ := parseIORegOptical(""); ok {
		t.Error("no ioreg output (drive empty) must read as no media")
	}
	// A partition / non-whole node is not a loaded whole disc.
	if ok, _ := parseIORegOptical(`"Whole" = No` + "\n" + `"BSD Name" = "disk14s1"`); ok {
		t.Error("a non-whole node must not count as present")
	}
}

// parseDrutilStatus reads macOS's optical status into drive/disc presence.
func TestParseDrutilStatus(t *testing.T) {
	withDisc := ` Vendor   Product           Rev
 ASUS     SDRW-08D2S-U      A814

           Type: CD-ROM               Name: /dev/disk14
       Sessions: 1                  Tracks: 12`
	noDisc := ` Vendor   Product           Rev
 ASUS     SDRW-08D2S-U      A814

           Type: No Media`
	noDrive := "No optical devices found.\n"

	cases := []struct {
		name             string
		text             string
		wantDrive, wantD bool
	}{
		{"drive + disc", withDisc, true, true},
		{"drive, empty", noDisc, true, false},
		{"no drive", noDrive, false, false},
		{"empty output", "", false, false},
	}
	for _, c := range cases {
		got := parseDrutilStatus(c.text)
		if got.drivePresent != c.wantDrive || got.discPresent != c.wantD {
			t.Errorf("%s: got drive=%v disc=%v, want drive=%v disc=%v",
				c.name, got.drivePresent, got.discPresent, c.wantDrive, c.wantD)
		}
	}
}

// The crux of the fix: macOS truth wins on PRESENCE, so a cd-paranoia miss never
// reads as "no drive" when the OS plainly has a disc.
func TestClassifyDriveFailure_MacTruthWins(t *testing.T) {
	discThere := macTruth{drivePresent: true, discPresent: true}
	driveOnly := macTruth{drivePresent: true}
	nothing := macTruth{}

	t.Run("disc mounted + cd-paranoia silent → disc present (retryable), NOT no-drive", func(t *testing.T) {
		// cd-paranoia emitted a 'no drive' style line, but macOS has the disc.
		p := classifyDriveFailure("Unable to open cdrom device", nil, discThere)
		if !p.DrivePresent || !p.DiscPresent {
			t.Fatalf("disc is mounted; must report present, got %+v", p)
		}
		if p.PermissionState == "denied" {
			t.Errorf("non-permission miss must not be 'denied': %+v", p)
		}
	})

	t.Run("disc mounted + permission denied → denied but still present", func(t *testing.T) {
		p := classifyDriveFailure("open (/dev/rdisk5): Permission denied", nil, discThere)
		if !p.DiscPresent || p.PermissionState != "denied" {
			t.Fatalf("want disc present + denied, got %+v", p)
		}
	})

	t.Run("drive but no disc (macOS) → insert a disc", func(t *testing.T) {
		p := classifyDriveFailure("garbage output", nil, driveOnly)
		if !p.DrivePresent || p.DiscPresent {
			t.Fatalf("want drive present, no disc, got %+v", p)
		}
	})

	t.Run("macOS blind + genuine no-drive text → no drive", func(t *testing.T) {
		p := classifyDriveFailure("Could not find a way to read audio from the cdrom", nil, nothing)
		if p.DrivePresent || p.DiscPresent {
			t.Fatalf("want no drive, got %+v", p)
		}
	})

	t.Run("macOS blind + permission denied → denied", func(t *testing.T) {
		p := classifyDriveFailure("Permission denied", nil, nothing)
		if p.PermissionState != "denied" {
			t.Fatalf("want denied, got %+v", p)
		}
	})
}

// retryable is the predicate probeDrive loops on: a present disc that isn't a
// permission wall. (Mirrors the inline check, pinned here so it can't silently drift.)
func TestProbeRetryPredicate(t *testing.T) {
	cases := []struct {
		p    DriveProbe
		want bool
	}{
		{DriveProbe{DiscPresent: true, PermissionState: "granted"}, true},
		{DriveProbe{DiscPresent: true, PermissionState: "denied"}, false},
		{DriveProbe{DiscPresent: false, PermissionState: "granted"}, false},
	}
	for _, c := range cases {
		got := c.p.DiscPresent && c.p.PermissionState != "denied"
		if got != c.want {
			t.Errorf("%+v: retryable=%v, want %v", c.p, got, c.want)
		}
	}
}

// parseParanoiaTOC turns real cd-paranoia -Q text into a TOC (the file referenced
// this test; it now exists).
func TestParseParanoiaTOC(t *testing.T) {
	sample := `cdparanoia III release 10.2 libcdio 2.2.0
Table of contents (audio tracks only):
track        length               begin        copy pre ch
===========================================================
  1.    14325 [03:11.00]        0 [00:00.00]    no   no  2
  2.    21767 [04:50.17]    14325 [03:11.00]    no   no  2
  3.    23331 [05:11.06]    36092 [08:01.17]    no   no  2
TOTAL  59423 [13:12.23]    (audio only)`
	toc, rawBegins, err := parseParanoiaTOC(sample)
	if err != nil {
		t.Fatalf("parse failed: %v", err)
	}
	if toc.FirstTrack != 1 || toc.LastTrack != 3 {
		t.Errorf("track range = %d..%d, want 1..3", toc.FirstTrack, toc.LastTrack)
	}
	// +150 lead-in convention.
	if toc.TrackOffsets[0] != 150 || toc.TrackOffsets[1] != 14475 {
		t.Errorf("offsets = %v, want [150 14475 36242]", toc.TrackOffsets)
	}
	if toc.LeadoutOffset != 36092+23331+150 {
		t.Errorf("leadout = %d, want %d", toc.LeadoutOffset, 36092+23331+150)
	}
	if len(rawBegins) != 3 || rawBegins[0] != 0 {
		t.Errorf("rawBegins = %v", rawBegins)
	}
}

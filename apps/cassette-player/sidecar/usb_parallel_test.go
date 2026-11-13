package main

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// Jobs run a few at a time, every result reaches onDone exactly once, and
// onDone is never running twice at the same moment (the manifest's guarantee).
func TestUsbRunCopiesBoundsWorkersAndSerialisesOnDone(t *testing.T) {
	jobs := make([]usbCopyJob, 20)
	for i := range jobs {
		jobs[i] = usbCopyJob{localID: string(rune('a' + i))}
	}
	var inFlight, peak, insideDone, doneCount int32
	do := func(j usbCopyJob) (int64, usbCoverOutcome, error) {
		n := atomic.AddInt32(&inFlight, 1)
		for {
			p := atomic.LoadInt32(&peak)
			if n <= p || atomic.CompareAndSwapInt32(&peak, p, n) {
				break
			}
		}
		time.Sleep(3 * time.Millisecond)
		atomic.AddInt32(&inFlight, -1)
		if j.localID == "c" {
			return 0, usbCoverOutcome{}, errors.New("boom")
		}
		return 7, usbCoverOutcome{settled: true}, nil
	}
	seen := map[string]bool{}
	failures := 0
	usbRunCopies(jobs, 3, do, func(r usbCopyResult) {
		if atomic.AddInt32(&insideDone, 1) != 1 {
			t.Error("onDone ran concurrently")
		}
		time.Sleep(time.Millisecond)
		atomic.AddInt32(&insideDone, -1)
		atomic.AddInt32(&doneCount, 1)
		if seen[r.job.localID] {
			t.Errorf("job %s reported twice", r.job.localID)
		}
		seen[r.job.localID] = true
		if r.err != nil {
			failures++
		}
	})
	if doneCount != 20 || len(seen) != 20 {
		t.Fatalf("reported %d of 20 jobs", doneCount)
	}
	if peak > 3 {
		t.Fatalf("peak in-flight %d exceeded the 3-worker bound", peak)
	}
	if peak < 2 {
		t.Fatalf("peak in-flight %d: jobs did not actually overlap", peak)
	}
	if failures != 1 {
		t.Fatalf("failures = %d, want the one deliberate failure", failures)
	}
	// Degenerate inputs: no jobs, and more workers than jobs.
	usbRunCopies(nil, 3, do, func(usbCopyResult) { t.Fatal("onDone with no jobs") })
	count := 0
	usbRunCopies(jobs[:1], 8, do, func(usbCopyResult) { count++ })
	if count != 1 {
		t.Fatalf("single job reported %d times", count)
	}
}

func TestUsbCopyWorkersIsBounded(t *testing.T) {
	n := usbCopyWorkers()
	if n < 1 || n > usbCopyWorkersMax {
		t.Fatalf("workers = %d", n)
	}
}

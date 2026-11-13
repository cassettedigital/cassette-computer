"use client";

/**
 * Rip status transport — the lean seam between the hosted app and the local
 * Cassette Player sidecar. Extracted from CdDrivePanel so light consumers
 * (the dashboard rail's disc slot) can poll without pulling the whole drive
 * panel into the shell bundle. CdDrivePanel re-exports everything here, so
 * existing importers are unchanged.
 *
 * useRipStatus owns ALL transport. To move from polling to Server-Sent Events
 * later, replace this hook's body with an EventSource against a sidecar /events
 * stream and keep the same return shape - consumers never change.
 */

import { useEffect, useState } from "react";

// The hub, where this page can reach one (lib/hub-origin): on the website in a regular browser the
// drive reads offline from the start and nothing is asked.
import { HUB_IN_REACH, hubFetch } from "@/lib/hub-origin";

export const POLL_MS = 2500;

// ── Status shape (mirrors the sidecar's RipProgress) ─────────────────────────

export type RipState =
  | "idle"
  | "detecting"
  | "matched"
  | "confirm"
  | "ripping"
  | "registering"
  | "done"
  | "incomplete"
  | "error";
export type PermissionState = "granted" | "denied" | "unknown";
export type TrackState = "pending" | "ripping" | "encoding" | "done" | "error";

export interface TrackStatus {
  position: number;
  title: string;
  state: TrackState;
  attempts?: number;
  error?: string;
  // The user already owns this track (matched against the local library by the
  // sidecar) - the detect card shows "In your library" instead of "Queued".
  inLibrary?: boolean;
}

// One scored release in the "confirm" pick-list (mirrors the sidecar's
// RipCandidate). releaseMbid is what we post back to /api/rip/confirm.
export interface RipCandidateTrack {
  position: number;
  title: string;
  lengthMs?: number;
}

// The inline-naming payload posted to /api/rip/name for a "Just rip it" album.
export interface NameOverride {
  album?: string;
  albumArtist?: string;
  tracks?: { position: number; title: string; artist?: string }[];
}

export interface RipCandidate {
  // Stable handle posted back to /api/rip/confirm. Required because gnudb
  // candidates carry no MBID - selecting by releaseMbid alone would misread them.
  id: string;
  releaseMbid?: string;
  album: string;
  albumArtist: string;
  date?: string;
  trackCount: number;
  // Disc position within a multi-disc release (from the matched MB medium) - lets the
  // card show "Disc 2 of 2". Absent for a single-disc release.
  mediumPos?: number;
  mediumCount?: number;
  mediumTitle?: string;
  confidence: number;
  // Which source identified this candidate (gnudb / musicbrainz / cd_text / …),
  // for the optional per-result source indicator.
  source?: string;
  // The candidate's tracklist, for the compare-and-confirm view (JOB 6). For an
  // aligned (manual-search) candidate this is in DISC order; a gap track (one the
  // disc has but this release couldn't name) has a blank title.
  tracks?: RipCandidateTrack[];
  // gaps: disc track positions the release had no slot for - the name-first flow
  // collects a name for each before ripping. flagged: tracks named by position but
  // with a loose duration (a gentle second-look mark). droppedTitles: release
  // tracks the disc LACKS (e.g. an interlude this edition omits), shown so the
  // difference is explained. All absent for an exact, clean match.
  gaps?: number[];
  flagged?: number[];
  droppedTitles?: string[];
}

export interface RipStatus {
  state: RipState;
  message?: string;
  drivePresent: boolean;
  discPresent: boolean;
  permissionState: PermissionState;
  // MusicBrainz identity the sidecar already emits on detect - used to resolve a
  // real cover for the tile (see resolveDiscCoverClient).
  discId?: string;
  releaseMbid?: string;
  album?: string;
  albumArtist?: string;
  date?: string;
  trackCount?: number;
  // Disc position within a multi-disc release, so the detect card shows "Disc 2 of 2"
  // at insert. Absent for a single-disc release (card renders it only when count > 1).
  mediumPos?: number;
  mediumCount?: number;
  mediumTitle?: string;
  completedTracks: number;
  tracks?: TrackStatus[];
  // Album-level ownership, computed by the sidecar at detect time. ownedTrackCount
  // is how many of the disc's tracks are already in the local library;
  // alreadyInLibrary means the user already has THIS album (by release MBID or
  // normalized album+artist - true even for a compilation whose per-track MBIDs
  // differ from the library copy). Both absent on an older sidecar → the panel
  // falls back to aggregating the per-track `inLibrary` flags below.
  ownedTrackCount?: number;
  alreadyInLibrary?: boolean;
  // A DIFFERENT disc of this same album has already been ripped - the "part of a set"
  // signal. Gates the disc label (below) and disambiguates alreadyInLibrary's album-name
  // collision across a set's discs.
  otherDiscInLibrary?: boolean;
  // Multi-signal identification: confidence is the resolver's score for the
  // chosen/best release; candidates is the "confirm" pick-list; unidentified +
  // needsNaming mark an import-anyway rip (no MusicBrainz identity).
  confidence?: number;
  candidates?: RipCandidate[];
  unidentified?: boolean;
  needsNaming?: boolean;
  // The disc's per-track durations (ms, from the TOC) for the compare view; and
  // whether the AcoustID "Figure it out" scan is set up on this sidecar.
  tocDurations?: number[];
  acoustidAvailable?: boolean;
  landedDir?: string;
  registered?: boolean;
  etaSeconds?: number;
  // Sidecar build stamp (main.buildVersion), echoed on every status poll. Shown
  // in the card corner so the founder can confirm at a glance which sidecar code
  // is live - and its mere presence proves this (new) panel is the one rendering.
  version?: string;
  // A PREVIOUS rip never finished (the app was killed/quit mid-rip). Surfaced on
  // every poll until dismissed, so a half-ripped album isn't lost silently.
  interruptedRip?: { album: string; albumArtist?: string; trackCount?: number };
  // The hub's OS (Go's runtime.GOOS: "darwin" | "windows" | "linux"), echoed on
  // every status poll. Used to pick the right fix instructions when
  // permissionState is "denied" (BUG-247) - a Linux hub needs the cdrom-group
  // fix, a Windows hub needs a Group Policy/Remote Desktop note, and neither
  // should be told to open macOS System Settings. Absent on an older sidecar
  // that predates this field; treat that as "unknown platform" (generic copy).
  hubOS?: string;
}

export type Reachability = "checking" | "online" | "offline";

/**
 * Count the tracks a rip has actually finished. The sidecar's completedTracks
 * counter is laggy - it can read 0 while the per-track states already show
 * "done" (the bug that froze the shelf's progress header at "Track 1 of N").
 * The tracks array is the truth when present; the counter is the fallback.
 */
export function ripDoneCount(status: RipStatus): number {
  const tracks = status.tracks ?? [];
  return tracks.length
    ? tracks.filter((t) => t.state === "done").length
    : (status.completedTracks ?? 0);
}

/** Shared by the Devices shelf intake, the Mac card panel, and the rail slot. */
export function useRipStatus(pollMs = POLL_MS): {
  status: RipStatus | null;
  reachability: Reachability;
} {
  const [status, setStatus] = useState<RipStatus | null>(null);
  const [reachability, setReachability] = useState<Reachability>(HUB_IN_REACH ? "checking" : "offline");

  useEffect(() => {
    if (!HUB_IN_REACH) return; // the website: no drive to ask, so no poll
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      // a hidden window asks nothing: the drive is watched while someone can see it, and the first
      // look back asks at once (below)
      if (document.hidden) {
        if (!cancelled) timer = setTimeout(tick, pollMs);
        return;
      }
      try {
        const r = await hubFetch(`/api/rip/status.json`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as RipStatus;
        if (!cancelled) {
          setStatus(d);
          setReachability("online");
        }
      } catch {
        if (!cancelled) setReachability("offline");
      } finally {
        if (!cancelled) timer = setTimeout(tick, pollMs);
      }
    }

    const onShow = () => {
      if (document.hidden || cancelled) return;
      if (timer) clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onShow);
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [pollMs]);

  return { status, reachability };
}

// ── Disc cover resolution (hosted app, NOT the sidecar) ──────────────────────
//
// The sidecar's detect payload already carries the MusicBrainz release MBID, so
// the disc's cover is resolved by the hosted app (catalog → Cover Art Archive →
// placeholder), reusing the find-album resolution. Non-blocking: callers render
// without it first and the cover swaps in. Module-level promise cache keyed by
// release MBID (or name) so re-polls and remounts never refetch. Shared by the
// drive panel and the desktop app's disc row and page.

const discCoverCache = new Map<string, Promise<string | null>>();

export function resolveDiscCover(
  key: string,
  q: { releaseMbid?: string; album?: string; artist?: string },
): Promise<string | null> {
  let p = discCoverCache.get(key);
  if (!p) {
    const params = new URLSearchParams();
    if (q.releaseMbid) params.set("releaseMbid", q.releaseMbid);
    if (q.album) params.set("album", q.album);
    if (q.artist) params.set("artist", q.artist);
    p = fetch(`/api/catalog/disc-cover?${params.toString()}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { coverUrl: null }))
      .then((d: { coverUrl: string | null }) => d.coverUrl ?? null)
      .catch(() => null);
    discCoverCache.set(key, p);
  }
  return p;
}

/**
 * GET JSON from the local sidecar, fail-soft: null when the hub is unreachable
 * from this browser (a different machine, the hub asleep) or answers non-2xx.
 * The Pair pane's "plugged into this Mac" list rides this.
 */
export async function getSidecar<T>(path: string): Promise<T | null> {
  try {
    const r = await hubFetch(`${path}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function postSidecar(
  path: string,
  payload?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  try {
    const init: RequestInit = { method: "POST" };
    if (payload !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(payload);
    }
    const r = await hubFetch(`${path}`, init);
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

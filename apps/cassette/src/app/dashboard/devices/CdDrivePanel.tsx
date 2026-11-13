"use client";

/**
 * The CD drive - a quiet component of the Mac card (CD-Rip Jobs 4–6).
 *
 * Talks to the person's own hub where this page can reach one (lib/hub-origin):
 * the desktop app through its own route, or local development. On the website
 * in a regular browser it never asks; it says discs rip in the app. Polling
 * lives behind useRipStatus() so it can be swapped for SSE later without
 * touching the render.
 *
 * The visual is split out as `DriveComponent`, a pure function of a RipStatus —
 * the live `CdDrivePanel` just feeds it polled data + action handlers, and
 * `/styleguide` feeds it fixtures. Footprint scales to state: a single calm line
 * when idle, a working strip while it rips. Never an alarm.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Disc3,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Lock,
  ChevronRight,
  ChevronLeft,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/app/components/Button";
import { TextLink } from "@/app/components/TextLink";
import { AlbumCover } from "@/app/components/AlbumCover";
import { LoadingDots } from "@/app/components/LoadingDots";
import { LedMeter } from "./_parts/LedMeter";
import styles from "./CdDrivePanel.module.css";
import { HUB_IN_REACH, SIDECAR_SAME_ORIGIN } from "@/lib/playback-remote";

/**
 * When the drive's program doesn't answer. In the Mac app it is the app's own, reached through its own
 * route, so it's a blip: never "open Cassette Player" inside Cassette (the BUG-607 family). In a
 * browser it is Cassette on the person's computer, which may simply not be open.
 */
function couldntReach(to?: string): string {
  if (SIDECAR_SAME_ORIGIN) return to ? `Couldn't ${to}: the CD drive didn't answer. Try again in a moment.` : "The CD drive didn't answer. Try again in a moment.";
  return `Couldn't reach Cassette on your computer${to ? ` to ${to}` : ""}.`;
}

// Transport + status shape live in the lean seam module (lib/rip-status) so
// light consumers (the rail's disc slot) can poll without pulling this whole
// panel into their bundle. Re-exported below so existing importers hold.
import {
  postSidecar,
  resolveDiscCover,
  ripDoneCount,
  useRipStatus,
  type NameOverride,
  type Reachability,
  type RipCandidate,
  type RipCandidateTrack,
  type RipStatus,
  type TrackState,
  type TrackStatus,
} from "@/lib/rip-status";

export {
  postSidecar,
  useRipStatus,
  type NameOverride,
  type Reachability,
  type RipCandidate,
  type RipCandidateTrack,
  type RipStatus,
};

// The disc's cover: resolved by the hosted app (lib/rip-status resolveDiscCover, shared with the
// desktop app's disc row and page).

// ── Live wrapper ─────────────────────────────────────────────────────────────

export function CdDrivePanel({ connected }: { connected: boolean }) {
  const { status, reachability } = useRipStatus();
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discCover, setDiscCover] = useState<string | null>(null);

  // No-drive capability invite is dismissible; the choice persists locally so a
  // driveless user isn't nagged every visit. Read once on mount (client-only).
  const [inviteDismissed, setInviteDismissed] = useState(false);
  useEffect(() => {
    try {
      setInviteDismissed(localStorage.getItem("cs-cd-invite-dismissed") === "1");
    } catch {
      /* private mode / no storage → just show the invite */
    }
  }, []);
  const dismissInvite = useCallback(() => {
    setInviteDismissed(true);
    try {
      localStorage.setItem("cs-cd-invite-dismissed", "1");
    } catch {
      /* best-effort; the in-memory flag still hides it this session */
    }
  }, []);

  // Acknowledge the "a previous rip didn't finish" notice: hide it immediately and
  // tell the sidecar to clear its marker (so it doesn't resurface on next launch).
  const [interruptedDismissed, setInterruptedDismissed] = useState(false);
  const dismissInterrupted = useCallback(async () => {
    setInterruptedDismissed(true);
    await postSidecar("/api/rip/dismiss-interrupted");
  }, []);

  // Resolve the disc cover when the detected disc's identity changes (not on
  // every poll). Bounded to one disc; cached; cover swaps in when it arrives.
  const releaseMbid = status?.releaseMbid;
  const album = status?.album;
  const albumArtist = status?.albumArtist;
  useEffect(() => {
    if (!releaseMbid && !album) {
      setDiscCover(null);
      return;
    }
    const key = releaseMbid || `${album}|${albumArtist ?? ""}`;
    let cancelled = false;
    void resolveDiscCover(key, { releaseMbid, album, artist: albumArtist }).then(
      (url) => {
        if (!cancelled) setDiscCover(url);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [releaseMbid, album, albumArtist]);

  // Clear a stale action note once a fresh rip actually starts moving.
  useEffect(() => {
    if (status?.state === "ripping" || status?.state === "detecting") {
      setActionMsg(null);
    }
  }, [status?.state]);

  const detect = useCallback(async () => {
    setBusy(true);
    setActionMsg(null);
    const res = await postSidecar("/api/rip/detect");
    if (!res.ok && res.status === 0) {
      setActionMsg(couldntReach());
    }
    setBusy(false);
  }, []);

  // Shared post-action handler: starts/confirms a rip and surfaces the only
  // user-facing failure (already-ripping or can't-reach). The disc lands either
  // way, so there's nothing else to alarm about.
  const startAction = useCallback(
    async (path: string, payload?: Record<string, unknown>) => {
      setBusy(true);
      setActionMsg(null);
      const res = await postSidecar(path, payload);
      if (res.status === 409 && res.body.alreadyRipping) {
        setActionMsg("A rip is already in progress.");
      } else if (res.status === 0) {
        setActionMsg(couldntReach("start the rip"));
      } else if (!res.ok) {
        setActionMsg(
          (res.body.error as string) ?? `Couldn't start the rip (HTTP ${res.status}).`,
        );
      }
      setBusy(false);
    },
    [],
  );

  // Job 5: surface the already-ripping case rather than a silent success.
  const rip = useCallback(() => startAction("/api/rip/start"), [startAction]);
  // J4: stop an in-progress rip - cancels the job and kills cd-paranoia, returning
  // the drive to idle. Job A: pend while in flight + surface failure (was silent).
  const stopRip = useCallback(async () => {
    setBusy(true);
    setActionMsg(null);
    const res = await postSidecar("/api/rip/stop");
    if (res.status === 0) {
      setActionMsg(couldntReach("stop the rip"));
    } else if (!res.ok) {
      setActionMsg(
        (res.body.error as string) ?? `Couldn’t stop the rip (HTTP ${res.status}).`,
      );
    }
    setBusy(false);
  }, []);
  // Job A: clear/reset a wedged or failed rip back to idle. Uses the sidecar's
  // existing /api/rip/reset (re-probes the drive and publishes `idle` when no rip
  // is active) - the only server-side way out of a stuck detecting / registering /
  // error state. A client-only reset would be overwritten by the next status poll,
  // so this resets the source of truth. Surfaces failure instead of stranding.
  const clearJob = useCallback(async () => {
    setBusy(true);
    setActionMsg(null);
    const res = await postSidecar("/api/rip/reset");
    if (res.status === 0) {
      setActionMsg(couldntReach("clear this"));
    } else if (!res.ok) {
      setActionMsg(
        (res.body.error as string) ?? `Couldn’t clear this (HTTP ${res.status}).`,
      );
    }
    setBusy(false);
  }, []);
  // Eject the disc from inside Cassette (sidecar `drutil tray eject`) - so a dead
  // physical button or an external tool isn't required. The sidecar refuses mid-rip.
  const eject = useCallback(async () => {
    setBusy(true);
    setActionMsg(null);
    const res = await postSidecar("/api/rip/eject");
    if (res.status === 0) {
      setActionMsg(couldntReach("eject"));
    } else if (res.status === 409) {
      setActionMsg("Can’t eject while a rip is running.");
    } else if (!res.ok) {
      setActionMsg((res.body.error as string) ?? "Couldn’t eject the disc.");
    }
    setBusy(false);
  }, []);
  // Confirm: rip the release the user picked (by stable candidate id), or import
  // the disc as unknown.
  const confirmRelease = useCallback(
    (candidateId: string, trackNames?: Record<string, string>) =>
      startAction("/api/rip/confirm", {
        candidateId,
        ...(trackNames && Object.keys(trackNames).length > 0 ? { trackNames } : {}),
      }),
    [startAction],
  );
  const importUnknown = useCallback(
    () => startAction("/api/rip/confirm", { importUnknown: true }),
    [startAction],
  );
  // JOB 4: free-text album search. Returns the candidate list for the inline
  // pick-list; selection flows back through confirmRelease (by candidate id).
  const searchAlbum = useCallback(async (query: string): Promise<RipCandidate[]> => {
    const res = await postSidecar("/api/rip/search", { query });
    if (res.ok && Array.isArray(res.body.candidates)) {
      return res.body.candidates as RipCandidate[];
    }
    return [];
  }, []);
  // JOB 5c: "Figure it out" → the deliberate AcoustID audio scan. Result arrives
  // via the next status poll (a confident match or fresh guesses).
  const figureItOut = useCallback(async () => {
    setBusy(true);
    setActionMsg(null);
    const res = await postSidecar("/api/rip/acoustid");
    if (res.body?.unavailable) {
      setActionMsg("Audio identification isn’t set up yet (no AcoustID key).");
    } else if (res.status === 0) {
      setActionMsg(couldntReach());
    } else if (!res.ok) {
      setActionMsg((res.body.error as string) ?? "Couldn’t start the scan.");
    }
    setBusy(false);
  }, []);
  // JOB 5d: inline naming of a just-ripped unknown album. Best-effort; re-tags the
  // landed files. Returns how many tracks were named.
  const submitNames = useCallback(async (payload: NameOverride): Promise<number> => {
    const res = await postSidecar("/api/rip/name", payload as unknown as Record<string, unknown>);
    return res.ok && typeof res.body.applied === "number" ? (res.body.applied as number) : 0;
  }, []);
  // A4: re-rip a single failed track from the "incomplete" state.
  const retryTrack = useCallback(
    (position: number) => startAction("/api/rip/retry", { position }),
    [startAction],
  );

  return (
    <>
      {status?.interruptedRip && !interruptedDismissed && (
        <InterruptedRipBanner
          info={status.interruptedRip}
          onDismiss={() => void dismissInterrupted()}
        />
      )}
      <DriveComponent
        reachability={reachability}
        connected={connected}
        status={status}
        busy={busy}
        actionMsg={actionMsg}
        coverUrl={discCover}
        onDetect={detect}
        onRip={rip}
        onStop={stopRip}
        onClear={clearJob}
        onEject={eject}
        onConfirm={confirmRelease}
        onImportUnknown={importUnknown}
        onSearch={searchAlbum}
        onAcoustId={figureItOut}
        onSubmitNames={submitNames}
        onRetryTrack={retryTrack}
        inviteDismissed={inviteDismissed}
        onDismissInvite={dismissInvite}
      />
    </>
  );
}

// Surfaced when the sidecar reports a rip that never finished (the app was killed
// mid-rip). One quiet, dismissible line so a half-ripped album isn't lost silently.
function InterruptedRipBanner({
  info,
  onDismiss,
}: {
  info: NonNullable<RipStatus["interruptedRip"]>;
  onDismiss: () => void;
}) {
  const n = info.trackCount ? ` (${info.trackCount} tracks)` : "";
  return (
    <div className={styles.interrupted} role="status">
      <span className={styles.interruptedText}>
        Your rip of <strong>{info.album}</strong>
        {info.albumArtist ? ` by ${info.albumArtist}` : ""} didn’t finish{n}. Re-insert the
        disc to rip it again.
      </span>
      <button
        type="button"
        className={styles.interruptedDismiss}
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

// ── Presentational component (fixture-friendly; showcased in /styleguide) ──────

export function DriveComponent({
  reachability,
  connected,
  status,
  busy = false,
  actionMsg = null,
  coverUrl = null,
  onDetect,
  onRip,
  onStop,
  onClear,
  onEject,
  onConfirm,
  onImportUnknown,
  onSearch,
  onAcoustId,
  onSubmitNames,
  onRetryTrack,
  inviteDismissed = false,
  onDismissInvite,
}: {
  reachability: Reachability;
  connected: boolean;
  status: RipStatus | null;
  busy?: boolean;
  actionMsg?: string | null;
  /** Resolved disc cover; null → AlbumCover falls back to initials. */
  coverUrl?: string | null;
  onDetect?: () => void;
  onRip?: () => void;
  /** J4: stop the active rip (cancel + kill cd-paranoia). */
  onStop?: () => void;
  /** Job A: reset a wedged/failed rip back to idle (sidecar /api/rip/reset). */
  onClear?: () => void;
  /** Eject the disc from the drive (sidecar `drutil tray eject`). */
  onEject?: () => void;
  /** Confirm a specific release from the "confirm" pick-list. */
  onConfirm?: (candidateId: string, trackNames?: Record<string, string>) => void;
  /** "None of these" / no-candidate path → import the disc as unknown. */
  onImportUnknown?: () => void;
  /** Free-text album search; resolves to the candidate pick-list. */
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  /** "Figure it out" → the AcoustID audio scan. */
  onAcoustId?: () => void;
  /** Inline naming of a just-ripped unknown album → tracks named. */
  onSubmitNames?: (payload: NameOverride) => Promise<number>;
  /** A4: re-rip a single failed track by position (from the incomplete state). */
  onRetryTrack?: (position: number) => void;
  /** Job 5: the no-drive invite is dismissible; the choice persists in the wrapper. */
  inviteDismissed?: boolean;
  onDismissInvite?: () => void;
}) {
  return (
    <section className={styles.drive}>
      {/* the computer's own HTTPS name is how a browser reaches the drive; the app goes through its own
          route and never uses it, so the warning is a browser's alone (BUG-414) */}
      <Ladder
        reachability={reachability}
        connected={connected}
        status={status}
        busy={busy}
        actionMsg={actionMsg}
        coverUrl={coverUrl}
        onDetect={onDetect}
        onRip={onRip}
        onStop={onStop}
        onClear={onClear}
        onEject={onEject}
        onConfirm={onConfirm}
        onImportUnknown={onImportUnknown}
        onSearch={onSearch}
        onAcoustId={onAcoustId}
        onSubmitNames={onSubmitNames}
        onRetryTrack={onRetryTrack}
        inviteDismissed={inviteDismissed}
        onDismissInvite={onDismissInvite}
      />
    </section>
  );
}

// ── The state ladder ─────────────────────────────────────────────────────────

function Ladder({
  reachability,
  connected,
  status,
  busy,
  actionMsg,
  coverUrl = null,
  onDetect,
  onRip,
  onStop,
  onClear,
  onEject,
  onConfirm,
  onImportUnknown,
  onSearch,
  onAcoustId,
  onSubmitNames,
  onRetryTrack,
  inviteDismissed = false,
  onDismissInvite,
}: {
  reachability: Reachability;
  connected: boolean;
  status: RipStatus | null;
  busy: boolean;
  actionMsg: string | null;
  coverUrl?: string | null;
  onDetect?: () => void;
  onRip?: () => void;
  /** J4: stop the active rip. */
  onStop?: () => void;
  /** Job A: reset a wedged/failed rip back to idle (sidecar /api/rip/reset). */
  onClear?: () => void;
  /** Eject the disc from the drive (sidecar `drutil tray eject`). */
  onEject?: () => void;
  onConfirm?: (candidateId: string, trackNames?: Record<string, string>) => void;
  onImportUnknown?: () => void;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onSubmitNames?: (payload: NameOverride) => Promise<number>;
  /** A4: re-rip a single failed track by position (from the incomplete state). */
  onRetryTrack?: (position: number) => void;
  inviteDismissed?: boolean;
  onDismissInvite?: () => void;
}) {
  // Routing: a confident match (≥ CONFIDENT_THRESHOLD) rips on a single tap —
  // ConfidentMatch's "Rip to library" calls onRip directly. Every OTHER path (a
  // correction pick, a search/AcoustID result, the ambiguous chooser) sets
  // `pending` and routes through CompareConfirm first.
  const [pending, setPending] = useState<PendingRip | null>(null);

  // The website in a regular browser never reaches the drive (lib/hub-origin, the founder 2026-10-29):
  // discs rip in the app, so it says so rather than "isn't running" about a computer that may be on.
  if (!HUB_IN_REACH) {
    return <Notice title="Discs rip in the Cassette app" body="Open Cassette on the computer with the drive." />;
  }
  if (reachability === "checking" && !status) {
    return <Notice title="Connecting…" />;
  }
  // in the app the drive's program is its own, reached through its own route: no setup to finish and
  // nothing to open, only a moment to wait (desk/network.ts offlineWords says the same)
  if (reachability === "offline" && SIDECAR_SAME_ORIGIN) {
    return <Notice title="Reconnecting to the CD drive…" />;
  }
  // local development: its hub on this computer isn't running
  if (reachability === "offline") {
    return (
      <Notice
        title="Cassette isn’t running on your computer"
        body="Open Cassette there, and your discs will show up here."
      />
    );
  }

  const s = status;
  if (!s) return <Muted>Checking for the CD drive…</Muted>;

  // Job 6: attempt-driven permission gate. macOS prompts at rip/read time, not
  // at drive-attach time - so this only appears once a read is actually denied.
  if (s.permissionState === "denied") {
    const { body, link } = permissionDeniedCopy(s.hubOS);
    return (
      <div className={styles.stack}>
        <div className={styles.line}>
          <Lock size={14} />
          <span>Cassette needs permission to read the disc drive.</span>
        </div>
        <div className={styles.muted}>{body}</div>
        <div className={styles.row}>
          <Button onClick={onDetect} disabled={busy} variant="secondary">
            Check again
          </Button>
          {/* Only macOS gets a deep link today (a documented URI scheme into
              Privacy & Security); Linux/Windows/unknown get instructions only. */}
          {link && (
            <TextLink href={link.href} variant="accent">
              {link.label}
            </TextLink>
          )}
        </div>
        {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
      </div>
    );
  }

  // No drive. A calm capability line - never an alarm.
  // NOTE: `drivePresent` is reported by the sidecar from `cd-paranoia -Q`, which
  // can read false-negative when a drive is attached but the read fails - see the
  // sidecar detection bug flagged in the redesign handoff. Copy assumes the
  // corrected meaning ("no drive") on purpose.
  if (!s.drivePresent) {
    // No drive · first run → the one time we invite, dismissible. Once dismissed
    // it stays gone (persisted in the wrapper) so a driveless user isn't nagged.
    if (inviteDismissed) return null;
    return (
      <div className={styles.invite}>
        <div className={styles.inviteIcon}>
          <HardDrive size={18} strokeWidth={1.6} />
        </div>
        <div className={styles.inviteBody}>
          <div className={styles.inviteTitle}>Got a CD drive?</div>
          <div className={styles.inviteText}>Connect one and rip your CDs straight in.</div>
        </div>
        <TextLink href="/help/adding-music" variant="quiet" className={styles.helpLink}>
          How it works
        </TextLink>
        {onDismissInvite && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={onDismissInvite}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
    );
  }

  // Selecting any candidate (guess / search result / AcoustID result) or the
  // confident "Rip to library" opens the compare view - never an immediate rip.
  const pickCandidate = (c: RipCandidate) =>
    setPending({ candidate: c, commit: (names) => onConfirm?.(c.id, names) });

  // BUG-277: post-rip recovery. A searched-and-picked release applied to the
  // already-landed FLACs IN PLACE (album/artist + per-position titles) via the name
  // endpoint - not a re-rip, so nothing duplicates on disk. Reversible; the manual
  // name fields stay for anything the picked release can't fill.
  const applyIdentityInPlace = (c: RipCandidate) => {
    const tracks = (c.tracks ?? [])
      .filter((t) => t.title && t.title.trim())
      .map((t) => ({ position: t.position, title: t.title.trim() }));
    void onSubmitNames?.({
      album: c.album || undefined,
      albumArtist: c.albumArtist && c.albumArtist !== "Unknown Artist" ? c.albumArtist : undefined,
      tracks,
    });
  };

  // JOB 6: the universal pre-rip gate.
  if (pending) {
    return (
      <CompareConfirm
        pending={pending}
        coverUrl={coverUrl}
        busy={busy}
        onConfirm={(names) => {
          pending.commit(names);
          setPending(null);
        }}
        onBack={() => setPending(null)}
      />
    );
  }

  const confident = !s.unidentified && (s.confidence ?? 0) >= CONFIDENT_THRESHOLD;

  // Each state fades in on change (keyed on s.state). The pick/compare state lives
  // above this (pending), so it isn't remounted - only the state machine animates.
  const stateView = (() => {
    switch (s.state) {
    case "detecting":
      return (
        <div className={styles.stack}>
          <div className={styles.line}>
            <Spinner />
            <span>
              {s.message?.includes("Listening")
                ? "Listening to the disc…"
                : s.message?.includes("Match")
                  ? "Matching…"
                  : "Reading disc…"}
            </span>
          </div>
          {/* Job A: escape hatch if detection wedges (resets the sidecar to idle). */}
          {onClear && (
            <div className={styles.row}>
              <Button onClick={onClear} disabled={busy} variant="secondary">
                Cancel
              </Button>
            </div>
          )}
          {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
        </div>
      );

    case "matched":
      // A confident auto-match → the cover-left card. Its "Rip to library" rips via
      // /api/rip/start, which re-detects and lands on the SAME confident identity, so
      // the title sticks. Anything else under "matched" is an unidentified import
      // preview → the picker.
      return !s.unidentified && confident ? (
        <MatchCard
          s={s}
          coverUrl={coverUrl}
          confident={confident}
          busy={busy}
          actionMsg={actionMsg}
          onRip={onRip}
          onPick={pickCandidate}
          onSearch={onSearch}
          onAcoustId={onAcoustId}
          onImportUnknown={onImportUnknown}
        />
      ) : (
        <UnidentifiedChooser
          s={s}
          coverUrl={coverUrl}
          busy={busy}
          actionMsg={actionMsg}
          onPick={pickCandidate}
          onSearch={onSearch}
          onAcoustId={onAcoustId}
          onImportUnknown={onImportUnknown}
        />
      );

    case "confirm":
      // Ambiguous OR just-searched → ALWAYS the picker (real options). The user's pick
      // commits through /api/rip/confirm, which carries the chosen identity into the
      // rip. A single card here would rip via /api/rip/start - which re-detects the
      // disc and drops the pick → "Unknown disc". That was the bug.
      return (
        <UnidentifiedChooser
          s={s}
          coverUrl={coverUrl}
          busy={busy}
          actionMsg={actionMsg}
          onPick={pickCandidate}
          onSearch={onSearch}
          onAcoustId={onAcoustId}
          onImportUnknown={onImportUnknown}
        />
      );

    case "ripping":
      return (
        <div className={styles.stack}>
          <RippingStrip status={s} coverUrl={coverUrl} />
          {/* JOB 5d: name an unknown album as it rips. */}
          {s.unidentified && onSubmitNames && (
            <InlineNameFields status={s} busy={busy} onSubmitNames={onSubmitNames} />
          )}
          {/* Stop lives in the disc card's top-right control slot (see Ladder). */}
          {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
        </div>
      );

    case "registering":
      return (
        <div className={styles.stack}>
          <AlbumHeader status={s} coverUrl={coverUrl} />
          <div className={styles.line}>
            <Spinner />
            <span>{s.message ?? "Adding to your library…"}</span>
          </div>
          {/* Job A: escape hatch if registration wedges. */}
          {onClear && (
            <div className={styles.row}>
              <Button onClick={onClear} disabled={busy} variant="secondary">
                Cancel
              </Button>
            </div>
          )}
          {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
        </div>
      );

    case "done": {
      // Job 1: claim library presence ONLY when the sidecar confirmed it
      // (registered). Otherwise the rip landed on disk but isn't queryable yet.
      const total = s.trackCount ?? s.tracks?.length ?? s.completedTracks;
      const doneText = !s.registered
        ? (s.message ?? "Ripped to your computer. It’ll appear in your library shortly.")
        : s.unidentified
          ? `Imported as unknown · ${s.completedTracks} of ${total}`
          : `Copied from disc · ${s.completedTracks} of ${total}`;
      return (
        <div className={styles.stack}>
          <div className={styles.done}>
            <span className={styles.doneIcon}>
              {s.registered ? (
                <CheckCircle2 size={18} strokeWidth={1.7} />
              ) : (
                <Disc3 size={18} strokeWidth={1.7} color="var(--cs-orange)" />
              )}
            </span>
            <span className={styles.doneText}>{doneText}</span>
            {s.registered && (
              <TextLink href="/dashboard/library/albums" variant="accent">
                View in library
              </TextLink>
            )}
          </div>
          {/* BUG-277: recovery stays alive after an unknown rip - search the exact
              match and apply it to the landed files in place (no re-rip). */}
          {s.unidentified && (
            <RecoverIdentity
              s={s}
              busy={busy}
              lead="This album isn’t identified yet."
              showAcoustId={false}
              onSearch={onSearch}
              onPick={applyIdentityInPlace}
            />
          )}
          {/* JOB 5d: still nameable by hand after an unknown rip finishes. */}
          {s.unidentified && onSubmitNames && (
            <InlineNameFields status={s} busy={busy} onSubmitNames={onSubmitNames} />
          )}
        </div>
      );
    }

    case "incomplete":
      // A3/A4 - a partial rip never says "done". Surface what's missing
      // prominently (not behind a disclosure) and offer a one-tap retry per
      // failed track.
      return (
        <IncompleteRip
          status={s}
          busy={busy}
          onRetryTrack={onRetryTrack}
          onClear={onClear}
          actionMsg={actionMsg}
        />
      );

    case "error":
      return (
        <div className={styles.stack}>
          <div className={styles.line}>
            <AlertTriangle size={14} color="var(--cs-red)" />
            {/* Clean human copy; the raw match detail (MusicBrainz disc id, etc.)
                is tucked into the tooltip, never in the visible string (§7,§13). */}
            <span title={s.message ?? undefined}>Couldn&apos;t identify this disc.</span>
          </div>
          <div className={styles.row}>
            <Button onClick={onDetect} disabled={busy} variant="secondary">
              Try again
            </Button>
            {/* Job A: a way out of a dead-end error, not just "Try again". */}
            {onClear && (
              <Button onClick={onClear} disabled={busy} variant="secondary">
                Start over
              </Button>
            )}
          </div>
          {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
        </div>
      );

    case "idle":
    default:
      // Disc just inserted → a calm reading line. Otherwise the compact "insert a
      // disc" card - the standby light says ready, so the copy stays minimal.
      if (s.discPresent) {
        return (
          <div className={styles.stack}>
            <div className={styles.calm}>
              <span className={styles.standby} aria-hidden="true" />
              <Disc3 size={18} strokeWidth={1.5} />
              <span className={styles.calmReady}>Reading disc…</span>
            </div>
            {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
          </div>
        );
      }
      return (
        <div className={styles.stack}>
          <div className={styles.emptyCard}>
            <div className={styles.emptyThumb}>
              <Disc3 size={26} strokeWidth={1.5} />
              <span className={styles.standbyThumb} aria-hidden="true" />
            </div>
            <div className={styles.emptyBody}>
              <div className={styles.emptyTitle}>Insert a disc</div>
              <div className={styles.emptyText}>It&apos;ll rip straight into your library.</div>
            </div>
          </div>
          {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
        </div>
      );
    }
  })();

  // One disc control, vertically centered beside the card content: Stop while
  // a rip is running, Eject whenever a disc is in and the drive isn't
  // mid-operation (reading/registering would break on an eject). So the user
  // never needs Finder or the dead physical button, and the control sits in
  // one place.
  const discControl = (() => {
    if (s.state === "ripping") {
      return onStop ? (
        <button type="button" className={styles.discCtl} onClick={onStop} disabled={busy}>
          <Square size={12} strokeWidth={2} /> Stop
        </button>
      ) : null;
    }
    const ejectable =
      !!s.discPresent && s.state !== "detecting" && s.state !== "registering";
    return ejectable && onEject ? (
      <button type="button" className={styles.discCtl} onClick={onEject} disabled={busy}>
        <EjectGlyph /> Eject
      </button>
    ) : null;
  })();

  return (
    <div className={styles.discRow}>
      <div className={styles.stateView} key={s.state}>
        {stateView}
      </div>
      {discControl && <div className={styles.discCtlSlot}>{discControl}</div>}
    </div>
  );
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function AlbumHeader({ status, coverUrl = null }: { status: RipStatus; coverUrl?: string | null }) {
  const title = displayAlbum(status);
  // Show-don't-tell: artist · year · N tracks only - never a source/confidence label.
  const meta = [status.albumArtist, status.date, `${status.trackCount ?? 0} tracks`]
    .filter(Boolean)
    .join(" · ");
  const disc = discLabel(status);
  return (
    <div className={styles.album}>
      <AlbumCover imageUrl={coverUrl} title={title} size={52} sizes="52px" className={styles.cover} />
      <div className={styles.albumMeta}>
        <div className={styles.albumTitle}>{title}</div>
        <div className={styles.albumSub}>{meta}</div>
        {disc && <div className={styles.discTag}>{disc}</div>}
      </div>
    </div>
  );
}

// discLabel surfaces which disc of a multi-disc set this is - "Disc 2 of 2" (or
// "Disc 2: Extras" when the MB medium is titled) - the moment the disc is in the drive,
// the way iTunes does. It describes the PHYSICAL disc, so it shows for any disc whose
// release has more than one medium, regardless of what's already in the library. (Set
// COMPLETENESS is a separate, library concern - the library only sections into "Disc N"
// once more than one disc is actually present, so a lone disc never looks incomplete.)
function discLabel(s: { mediumPos?: number; mediumCount?: number; mediumTitle?: string }): string | null {
  const pos = s.mediumPos ?? 0;
  const count = s.mediumCount ?? 0;
  if (count < 2 || pos < 1) return null;
  return s.mediumTitle ? `Disc ${pos}: ${s.mediumTitle}` : `Disc ${pos} of ${count}`;
}

// displayAlbum hides the synthetic disc suffix on an unnamed import: the sidecar
// keeps each unknown disc's ALBUM tag unique (so Navidrome never merges two), but
// the user just sees "Unknown album" until they name it.
function displayAlbum(s: { album?: string; needsNaming?: boolean }): string {
  return s.needsNaming ? "Unknown album" : (s.album ?? "Unknown album");
}

// permissionDeniedCopy (BUG-247): the fix for a denied disc-drive read is
// different per hub OS, so the body text - and whether there's even a deep
// link worth offering - branches on hubOS (the sidecar's own runtime.GOOS,
// echoed on every status poll). hubOS is absent on an older sidecar that
// predates this field; that falls through to the generic case below rather
// than guessing a platform.
function permissionDeniedCopy(hubOS: string | undefined): {
  body: string;
  link?: { href: string; label: string };
} {
  switch (hubOS) {
    case "darwin":
      return {
        body: "Grant access in System Settings → Privacy & Security, then check again.",
        link: {
          href: "x-apple.systempreferences:com.apple.preference.security?Privacy",
          label: "Open System Settings",
        },
      };
    case "linux":
      return {
        body: 'Your account needs to be in the "cdrom" group to read the disc drive. Run sudo usermod -aG cdrom $USER in a terminal, log out and back in, then check again.',
      };
    case "windows":
      return {
        body: "Windows is blocking disc access - usually a Group Policy restriction on removable storage, or a Remote Desktop session (ripping needs a direct desktop session, not a remote one). Check with whoever manages this PC, then check again.",
      };
    default:
      return {
        body: "Check this app's permission to access removable storage on this computer, then check again.",
      };
  }
}

function RippingStrip({ status, coverUrl = null }: { status: RipStatus; coverUrl?: string | null }) {
  const tracks = status.tracks ?? [];
  const total = status.trackCount ?? tracks.length ?? 0;
  // Real progress: count the tracks actually marked done - not the laggy
  // completedTracks counter (which read 0 while tracks already showed "Ripped").
  const done = ripDoneCount(status);
  const eta =
    status.etaSeconds != null && status.etaSeconds > 0 ? ` · ~${formatEta(status.etaSeconds)} left` : "";
  return (
    <div className={styles.album}>
      <AlbumCover imageUrl={coverUrl} title={displayAlbum(status)} size={52} sizes="52px" className={styles.cover} />
      <div className={styles.progress}>
        <div className={styles.albumTitle}>{displayAlbum(status)}</div>
        {/* Segmented LED meter - one cell per track when they fit, all-or-nothing. */}
        <div className={styles.ledRow}>
          <LedMeter value={done} total={total} />
        </div>
        {/* The "x of n tracks" line IS the disclosure - tap to expand the per-track list. */}
        <TracksDisclosure tracks={status.tracks} label={`${done} of ${total} tracks${eta}`} />
      </div>
    </div>
  );
}

// Per-state status word + hue. The hue is a semantic status color (like
// StatusPill), applied inline; layout/typography come from the module.
const TRACK_LABEL: Record<TrackState, string> = {
  pending: "Queued",
  ripping: "Ripping",
  encoding: "Encoding",
  done: "Ripped",
  error: "Failed",
};
const TRACK_COLOR: Record<TrackState, string> = {
  pending: "var(--cs-ink3)",
  ripping: "var(--cs-orange)",
  encoding: "var(--cs-orange)",
  done: "var(--cs-green)",
  error: "var(--cs-red)",
};

// An owned track reads "In your library" ONLY in the pre-rip preview (state
// pending); once a rip starts the live state (Ripping/Ripped) takes over.
function trackLabel(t: TrackStatus): string {
  if (t.error) return `Failed: ${t.error}`;
  if (t.inLibrary && t.state === "pending") return "In your library";
  return TRACK_LABEL[t.state];
}
function trackColor(t: TrackStatus): string {
  if (t.inLibrary && t.state === "pending" && !t.error) return "var(--cs-green)";
  return TRACK_COLOR[t.state];
}

function TracksDisclosure({ tracks, label }: { tracks?: TrackStatus[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (!tracks?.length) return null;
  return (
    <>
      <button
        type="button"
        className={`${styles.disclosure} ${open ? styles.disclosureOpen : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={13} strokeWidth={2} />
        {label}
      </button>
      {open && (
        <div className={styles.tracks}>
          {tracks.map((t) => (
            <div key={t.position} className={styles.track}>
              <span className={styles.trackNum}>
                {String(t.position).padStart(2, "0")}
              </span>
              <span className={styles.trackName}>{t.title}</span>
              <span className={styles.trackState} style={{ color: trackColor(t) }}>
                {trackLabel(t)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// CandidateList renders a tappable pick-list of releases (shared by the chooser
// guesses and the search results). onPick passes the whole candidate so the
// caller can open the compare-and-confirm view (JOB 6) - selection never rips.
function CandidateList({
  items,
  busy,
  onPick,
}: {
  items: RipCandidate[];
  busy: boolean;
  onPick?: (candidate: RipCandidate) => void;
}) {
  if (!items.length) return null;
  return (
    <div className={styles.confirmList}>
      {items.map((c) => (
        <button
          key={c.id}
          type="button"
          className={styles.candidate}
          disabled={busy}
          onClick={() => onPick?.(c)}
        >
          <span className={styles.candidateText}>
            <span className={styles.candidateAlbum}>{c.album || "Unknown album"}</span>
            <span className={styles.candidateMeta}>
              {[c.albumArtist, c.date?.slice(0, 4), `${c.trackCount} tracks`]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <ChevronRight size={15} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}

// CoverGrid (JOB 3): the disc's candidate releases shown as tappable COVERS - the
// "not this album?" picker. Each tile self-resolves its own cover (module-cached,
// the display path - never the import path). Selection routes through CompareConfirm.
function CoverGrid({
  items,
  busy,
  onPick,
}: {
  items: RipCandidate[];
  busy: boolean;
  onPick?: (candidate: RipCandidate) => void;
}) {
  if (!items.length) return null;
  return (
    <div className={styles.coverGrid}>
      {items.map((c) => (
        <CoverTile key={c.id} candidate={c} busy={busy} onPick={onPick} />
      ))}
    </div>
  );
}

function CoverTile({
  candidate,
  busy,
  onPick,
}: {
  candidate: RipCandidate;
  busy: boolean;
  onPick?: (candidate: RipCandidate) => void;
}) {
  const [cover, setCover] = useState<string | null>(null);
  const { releaseMbid, album, albumArtist } = candidate;
  useEffect(() => {
    if (!releaseMbid && !album) return;
    const key = releaseMbid || `${album}|${albumArtist ?? ""}`;
    let cancelled = false;
    void resolveDiscCover(key, { releaseMbid, album, artist: albumArtist }).then((url) => {
      if (!cancelled) setCover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [releaseMbid, album, albumArtist]);
  const titleText = candidate.album || "Unknown album";
  const sub = [candidate.albumArtist, candidate.date?.slice(0, 4)].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className={styles.coverTile}
      disabled={busy}
      onClick={() => onPick?.(candidate)}
    >
      <AlbumCover imageUrl={cover} title={titleText} size={76} sizes="76px" className={styles.coverTileImg} />
      <span className={styles.coverTileTitle}>{titleText}</span>
      {sub && <span className={styles.coverTileSub}>{sub}</span>}
    </button>
  );
}

// SearchAlbum - JOB 4. A text box (pre-filled from any signal) that searches
// MusicBrainz + iTunes and shows the results as a pick-list. Selecting one rips
// it named. No-op render when onSearch isn't wired (e.g. styleguide fixtures).
function SearchAlbum({
  initialQuery = "",
  busy,
  onSearch,
  onPick,
}: {
  initialQuery?: string;
  busy: boolean;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onPick?: (candidate: RipCandidate) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<RipCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  if (!onSearch) return null;

  const run = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setResults(null);
    try {
      setResults(await onSearch(q));
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className={styles.search}>
      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          type="text"
          value={query}
          placeholder="Search by album or artist…"
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <Button onClick={() => void run()} disabled={busy || searching || !query.trim()} variant="secondary">
          {searching ? "Searching…" : "Search"}
        </Button>
      </div>
      {results !== null && results.length === 0 && !searching && (
        <div className={styles.muted}>No matches found. You can still import it as unknown.</div>
      )}
      {results && results.length > 0 && <CandidateList items={results} busy={busy} onPick={onPick} />}
    </div>
  );
}

// searchPrefill seeds the search box from whatever the disc gave us - but never
// the synthetic "Unknown Album <id>" name of an unidentified disc.
function searchPrefill(s: RipStatus): string {
  if (s.needsNaming) return s.albumArtist && s.albumArtist !== "Unknown Artist" ? s.albumArtist : "";
  return [s.albumArtist, s.album].filter((v) => v && v !== "Unknown Artist").join(" ").trim();
}

// ── Confident / not-confident / compare-confirm (JOB 4/5/6) ───────────────────

const CONFIDENT_THRESHOLD = 0.8;

// What "Rip again" actually does, in plain terms (surfaced as a help hint). Grounded
// in the sidecar: albumDir is deterministic and already-landed tracks are skipped, so
// a re-rip only fills gaps - it never duplicates the folder or overwrites good files.
const RIP_AGAIN_HELP =
  "Re-reads the disc and fills in any tracks you're missing. Anything already in your library is skipped, so nothing gets duplicated or overwritten.";

// libraryOwnership resolves the album-level "do I already own this?" signal for the
// detected disc. It prefers the sidecar's album-level fields (which stay correct for
// a compilation whose per-track MBIDs differ), and falls back to aggregating the
// per-track `inLibrary` flags so the panel still answers correctly against an older
// sidecar that only sends the per-row hints.
type LibraryOwnership = { owned: number; total: number; state: "none" | "partial" | "full" };

function libraryOwnership(s: RipStatus): LibraryOwnership {
  const total = s.trackCount ?? s.tracks?.length ?? 0;
  const owned = s.ownedTrackCount ?? (s.tracks?.filter((t) => t.inLibrary).length ?? 0);
  // The album-level flag is authoritative when present (a fully-owned compilation can
  // report ownedTrackCount 0 when per-track MBIDs differ, so it must win over the count)
  // - EXCEPT when it only matches a DIFFERENT disc of the same set (otherDiscInLibrary):
  // the album name collides across a set's discs ("Hozier" disc 1 vs disc 2), so a
  // genuinely new disc falls through to the per-disc count and reads as a fresh rip.
  if (s.alreadyInLibrary && !s.otherDiscInLibrary) return { owned, total, state: "full" };
  if (total <= 0 || owned <= 0) return { owned, total, state: "none" };
  return { owned, total, state: owned >= total ? "full" : "partial" };
}

// A chosen rip, held pending the compare-and-confirm step. candidate is the
// release to compare against (undefined for a pure unknown import); commit fires
// the real rip.
export type PendingRip = { candidate?: RipCandidate; commit: (trackNames?: Record<string, string>) => void };

function fmtDur(ms?: number): string {
  if (ms == null || ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// MatchCard (JOB 1/2/3): the identified-disc card. The cover IS the disc —
// cover-LEFT and compact, with title, "Artist · Year", and the tracklist
// disclosure stacked beside it; actions beneath. One card, two faces: the match,
// and the "not this album?" picker it flips to IN PLACE (no second pane, no void).
// The escape is a quiet link when confident (≥0.80), a pronounced button when not.
function MatchCard({
  s,
  coverUrl,
  confident,
  busy,
  actionMsg,
  onRip,
  onPick,
  onSearch,
  onAcoustId,
  onImportUnknown,
}: {
  s: RipStatus;
  coverUrl: string | null;
  confident: boolean;
  busy: boolean;
  actionMsg: string | null;
  onRip?: () => void;
  onPick?: (c: RipCandidate) => void;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onImportUnknown?: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const title = displayAlbum(s);
  const meta = [s.albumArtist, s.date?.slice(0, 4)].filter(Boolean).join(" · ");
  const ownership = libraryOwnership(s);
  const disc = discLabel(s);

  // The picker face - flips in place, same card. Pick a cover, search, or just
  // rip it; "back to the match" flips home.
  if (flipped) {
    return (
      <div className={`${styles.stack} ${styles.grow}`}>
        <button type="button" className={styles.backLink} onClick={() => setFlipped(false)}>
          <ChevronLeft size={14} strokeWidth={1.8} />
          Back to the match
        </button>
        <div className={styles.pickerHead}>Which one is it?</div>
        <ChooserOptions
          s={s}
          busy={busy}
          omitGuessId={s.candidates?.[0]?.id}
          onPick={onPick}
          onSearch={onSearch}
          onAcoustId={onAcoustId}
          onImportUnknown={onImportUnknown}
        />
        {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
      </div>
    );
  }

  // The "not this album?" escape - a quiet link when confident, a pronounced button
  // when not. Shared by both the fresh-rip and the already-owned action rows.
  const notThisEscape = confident ? (
    <button
      type="button"
      className={styles.notThis}
      disabled={busy}
      onClick={() => setFlipped(true)}
    >
      Not this album?
    </button>
  ) : (
    <Button onClick={() => setFlipped(true)} disabled={busy} variant="secondary">
      Not this album?
    </Button>
  );

  // The match face - compact, cover-left, top-aligned. When the disc is already in the
  // library there's no rip to push: the "In library" seal on the cover doubles as the
  // (quiet) link to the library, and the action row carries only the two edge cases —
  // re-rip to fill gaps, or correct the match.
  const owned = ownership.state === "full";
  return (
    <div className={`${styles.stack} ${styles.grow}`}>
      <div className={styles.matchRow}>
        <div className={styles.coverSeat}>
          <AlbumCover imageUrl={coverUrl} title={title} size={96} sizes="96px" className={styles.matchCover} />
          {owned && (
            <Link href="/dashboard/library/albums" className={styles.coverBadge}>
              In library
            </Link>
          )}
        </div>
        <div className={styles.matchInfo}>
          <div className={styles.matchTitle}>{title}</div>
          {meta && <div className={styles.matchMeta}>{meta}</div>}
          {disc && <div className={styles.discTag}>{disc}</div>}
          {ownership.state === "partial" && (
            <span className={styles.ownedPartial}>
              {ownership.owned} of {ownership.total} already in your library
            </span>
          )}
          <TracksDisclosure tracks={s.tracks} label={`${s.trackCount ?? s.tracks?.length ?? 0} tracks`} />
        </div>
      </div>
      <div className={styles.matchActions}>
        {owned ? (
          <>
            <span className={styles.ripAgainWrap}>
              <button
                type="button"
                className={styles.notThis}
                onClick={onRip}
                disabled={busy}
              >
                Rip again
              </button>
              <span
                className={styles.help}
                tabIndex={0}
                aria-label={`Rip again: ${RIP_AGAIN_HELP}`}
              >
                <HelpCircle size={13} strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span className={styles.helpBubble} role="tooltip" aria-hidden="true">
                {RIP_AGAIN_HELP}
              </span>
            </span>
            {notThisEscape}
          </>
        ) : (
          <>
            <Button onClick={onRip} disabled={busy} variant="primary">
              Rip to library
            </Button>
            {notThisEscape}
          </>
        )}
      </div>
      {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
    </div>
  );
}

// InlineLink (BUG-277): a text hyperlink that fires an action, for the recovery
// prompt's inline "figure it out" / "search for the exact match" escapes.
function InlineLink({
  onClick,
  busy,
  children,
}: {
  onClick?: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className={styles.inlineLink} disabled={busy || !onClick} onClick={onClick}>
      {children}
    </button>
  );
}

// RecoverIdentity (BUG-277): the two machine-assisted escapes for a disc we
// couldn't name, written as one plain sentence with inline links instead of a
// competing button row - "figure it out" (the AcoustID audio scan) and "search for
// the exact match" (free text). The search box unfolds in place. Shared by the
// pre-rip Unknown card and the post-rip unknown-album state, so identity is never a
// dead end. `onPick` decides what a chosen result does: pre-rip it routes through
// the compare-and-confirm gate (then rips under that identity); post-rip it re-tags
// the already-landed files in place (no re-rip). `showAcoustId` is off post-rip,
// because re-running the audio scan there would mean re-ripping.
export function RecoverIdentity({
  s,
  busy,
  lead,
  showAcoustId,
  onSearch,
  onAcoustId,
  onPick,
}: {
  s: RipStatus;
  busy: boolean;
  lead: string;
  showAcoustId: boolean;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onPick?: (c: RipCandidate) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const canAcoust = showAcoustId && !!s.acoustidAvailable && !!onAcoustId;
  const canSearch = !!onSearch;
  if (!canAcoust && !canSearch) return null;
  const searchLink = (
    <InlineLink busy={busy} onClick={() => setSearchOpen(true)}>
      search for the exact match
    </InlineLink>
  );
  return (
    <div className={styles.stack}>
      <p className={styles.unknownPrompt}>
        {lead}{" "}
        {canAcoust && canSearch && (
          <>
            We can try to <InlineLink busy={busy} onClick={onAcoustId}>figure it out</InlineLink>, or you can{" "}
            {searchLink}.
          </>
        )}
        {canAcoust && !canSearch && (
          <>
            We can try to <InlineLink busy={busy} onClick={onAcoustId}>figure it out</InlineLink>.
          </>
        )}
        {!canAcoust && canSearch && <>You can {searchLink}.</>}
      </p>
      {searchOpen && onSearch && (
        <SearchAlbum initialQuery={searchPrefill(s)} busy={busy} onSearch={onSearch} onPick={onPick} />
      )}
    </div>
  );
}

// UnknownDiscCard (BUG-277): the true no-match card, given the same shape as the
// matched card - cover + "Unknown album" + a "View tracks" disclosure - so a disc we
// can't name still reads as a real record, not an error. The recovery lives in a
// plain sentence (RecoverIdentity), with "Just rip it" as the quiet fallback.
function UnknownDiscCard({
  s,
  coverUrl,
  busy,
  actionMsg,
  onSearch,
  onAcoustId,
  onImportUnknown,
  onPick,
}: {
  s: RipStatus;
  coverUrl: string | null;
  busy: boolean;
  actionMsg: string | null;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onImportUnknown?: () => void;
  onPick?: (c: RipCandidate) => void;
}) {
  const title = "Unknown album";
  const artist = s.albumArtist && s.albumArtist !== "Unknown Artist" ? s.albumArtist : null;
  const meta = [artist, `${s.trackCount ?? s.tracks?.length ?? 0} tracks`].filter(Boolean).join(" · ");
  return (
    <div className={`${styles.stack} ${styles.grow}`}>
      <div className={styles.matchRow}>
        <div className={styles.coverSeat}>
          <AlbumCover imageUrl={coverUrl} title={title} size={96} sizes="96px" className={styles.matchCover} />
        </div>
        <div className={styles.matchInfo}>
          <div className={styles.matchTitle}>{title}</div>
          {meta && <div className={styles.matchMeta}>{meta}</div>}
          <TracksDisclosure tracks={s.tracks} label="View tracks" />
        </div>
      </div>
      <RecoverIdentity
        s={s}
        busy={busy}
        lead="We couldn’t identify this album."
        showAcoustId
        onSearch={onSearch}
        onAcoustId={onAcoustId}
        onPick={onPick}
      />
      {onImportUnknown && (
        <div className={styles.row}>
          <Button variant="ghost" disabled={busy} onClick={onImportUnknown}>
            Just rip it
          </Button>
        </div>
      )}
      {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
    </div>
  );
}

// UnidentifiedChooser (JOB 5): with guesses, the cover-grid pick-list ("which
// release is this?"). With NO guesses, the reframed Unknown card (BUG-277) - a real
// card with the two inline recovery links instead of a bare button row.
function UnidentifiedChooser({
  s,
  coverUrl,
  busy,
  actionMsg,
  onPick,
  onSearch,
  onAcoustId,
  onImportUnknown,
}: {
  s: RipStatus;
  coverUrl?: string | null;
  busy: boolean;
  actionMsg: string | null;
  onPick?: (c: RipCandidate) => void;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onImportUnknown?: () => void;
}) {
  const hasGuesses = (s.candidates?.length ?? 0) > 0;
  if (!hasGuesses) {
    return (
      <UnknownDiscCard
        s={s}
        coverUrl={coverUrl ?? null}
        busy={busy}
        actionMsg={actionMsg}
        onSearch={onSearch}
        onAcoustId={onAcoustId}
        onImportUnknown={onImportUnknown}
        onPick={onPick}
      />
    );
  }
  return (
    <div className={styles.stack}>
      <div className={styles.confirmHead}>Which release is this?</div>
      <ChooserOptions
        s={s}
        busy={busy}
        onPick={onPick}
        onSearch={onSearch}
        onAcoustId={onAcoustId}
        onImportUnknown={onImportUnknown}
      />
      {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
    </div>
  );
}

// ChooserOptions renders the four options (shared by the chooser + the confident
// correction menu). a) Guesses, b) Search, c) Figure it out, d) Just rip it.
function ChooserOptions({
  s,
  busy,
  omitGuessId,
  onPick,
  onSearch,
  onAcoustId,
  onImportUnknown,
}: {
  s: RipStatus;
  busy: boolean;
  omitGuessId?: string;
  onPick?: (c: RipCandidate) => void;
  onSearch?: (query: string) => Promise<RipCandidate[]>;
  onAcoustId?: () => void;
  onImportUnknown?: () => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const guesses = (s.candidates ?? []).filter((c) => c.id !== omitGuessId);
  return (
    <div className={styles.stack}>
      {guesses.length > 0 && <CoverGrid items={guesses} busy={busy} onPick={onPick} />}
      {searchOpen && onSearch && (
        <SearchAlbum initialQuery={searchPrefill(s)} busy={busy} onSearch={onSearch} onPick={onPick} />
      )}
      {/* Two real affordances - search, or just rip it - plus AcoustID when it's set up. */}
      <div className={styles.pickerFoot}>
        {onSearch && !searchOpen && (
          <Button onClick={() => setSearchOpen(true)} disabled={busy} variant="secondary">
            <Search size={14} strokeWidth={1.8} style={{ marginRight: 6 }} />
            Search for it
          </Button>
        )}
        {s.acoustidAvailable && onAcoustId && (
          <Button onClick={onAcoustId} disabled={busy} variant="secondary">
            <Sparkles size={14} strokeWidth={1.8} style={{ marginRight: 6 }} />
            Figure it out
          </Button>
        )}
        {onImportUnknown && (
          <Button variant="ghost" disabled={busy} onClick={onImportUnknown}>
            Just rip it
          </Button>
        )}
      </div>
    </div>
  );
}

// CompareConfirm (JOB 6): the universal pre-rip gate. Shows ONE resolved list —
// the disc's tracks with the names we'll give them. A track the release had no
// slot for is a name field (name-first); a track named by position but with an
// off duration is flagged. The matching detail (what we matched against, what
// differs) lives in an optional unfold - the disc is the single point of
// reference, not a disc-vs-release diff. Nothing rips until "This is it".
// Exported so the Devices page's hub card gates a picked result the same way (BUG-541).
export function CompareConfirm({
  pending,
  busy,
  coverUrl,
  onConfirm,
  onBack,
}: {
  pending: PendingRip;
  busy: boolean;
  coverUrl: string | null;
  onConfirm: (trackNames?: Record<string, string>) => void;
  onBack: () => void;
}) {
  const c = pending.candidate;
  const tracks = c?.tracks ?? [];

  // A gap is a disc track the release had no slot for - we collect a name for it
  // before ripping (name-first). Nothing is forced; names can be changed later.
  const gapSet = new Set(c?.gaps ?? []);
  const flagSet = new Set(c?.flagged ?? []);
  const [names, setNames] = useState<Record<number, string>>({});
  const matched = tracks.length - gapSet.size;

  const commit = () => {
    const trackNames: Record<string, string> = {};
    for (const [pos, name] of Object.entries(names)) {
      if (name.trim()) trackNames[pos] = name.trim();
    }
    onConfirm(trackNames);
  };

  const flaggedNums = [...flagSet].sort((a, b) => a - b);
  const hasDetail = (c?.droppedTitles?.length ?? 0) > 0 || flaggedNums.length > 0;

  return (
    <div className={styles.stack}>
      <button type="button" className={styles.backLink} onClick={onBack} disabled={busy}>
        <ChevronLeft size={14} strokeWidth={2} /> Back
      </button>
      {c ? (
        <>
          <div className={styles.album}>
            <AlbumCover imageUrl={coverUrl} title={c.album || "Disc"} size={52} sizes="52px" className={styles.cover} />
            <div className={styles.albumMeta}>
              <div className={styles.albumTitle}>{c.album || "Unknown album"}</div>
              <div className={styles.albumSub}>
                {[c.albumArtist, c.date?.slice(0, 4), `${tracks.length || c.trackCount} tracks`]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>
          {gapSet.size > 0 && (
            <div className={styles.gapNote}>
              We named {matched} of {tracks.length} tracks. Name the {gapSet.size === 1 ? "one" : gapSet.size} we
              couldn’t place, or skip - you can always rename later.
            </div>
          )}
          {tracks.length > 0 && (
            <div className={styles.tracklist}>
              {tracks.map((t) => {
                const isGap = gapSet.has(t.position) || !t.title;
                return (
                  <div key={t.position} className={styles.trackRow}>
                    <span className={styles.trackNum}>{String(t.position).padStart(2, "0")}</span>
                    {isGap ? (
                      <input
                        className={styles.gapInput}
                        placeholder="Name this track"
                        value={names[t.position] ?? ""}
                        onChange={(e) => setNames((p) => ({ ...p, [t.position]: e.target.value }))}
                        disabled={busy}
                        aria-label={`Name for track ${t.position}`}
                      />
                    ) : (
                      <span className={styles.trackTitle}>
                        {t.title}
                        {flagSet.has(t.position) && (
                          <AlertTriangle
                            size={12}
                            color="var(--cs-orange)"
                            aria-label="Duration differs from the reference - double-check"
                          />
                        )}
                      </span>
                    )}
                    <span className={styles.trackDur}>{fmtDur(t.lengthMs)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {hasDetail && (
            <details className={styles.matchDetails}>
              <summary className={styles.matchSummary}>How we matched this</summary>
              <div className={styles.matchBody}>
                Matched to {c.album}
                {c.date ? ` (${c.date.slice(0, 4)})` : ""}.
                {c.droppedTitles && c.droppedTitles.length > 0 && (
                  <>
                    {" "}
                    That release also lists {c.droppedTitles.map((t) => `“${t}”`).join(", ")}, which your disc doesn’t
                    have.
                  </>
                )}
                {flaggedNums.length > 0 && (
                  <>
                    {" "}
                    Track{flaggedNums.length === 1 ? "" : "s"} {flaggedNums.map((n) => String(n).padStart(2, "0")).join(
                      ", ",
                    )}{" "}
                    run a different length than the reference - worth a double-check.
                  </>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <div className={styles.muted}>Rip this disc to your library?</div>
      )}
      <div className={styles.row}>
        <Button onClick={commit} disabled={busy} variant="primary">
          {gapSet.size > 0 ? "Name & rip" : "This is it - rip it"}
        </Button>
        <Button onClick={onBack} disabled={busy} variant="secondary">
          Back
        </Button>
      </div>
    </div>
  );
}

// InlineNameFields (JOB 5d): name an unknown album as it rips. Tag-only on the
// sidecar; the library shows whatever the user types.
function InlineNameFields({
  status,
  busy,
  onSubmitNames,
}: {
  status: RipStatus;
  busy: boolean;
  onSubmitNames: (payload: NameOverride) => Promise<number>;
}) {
  const [album, setAlbum] = useState("");
  const [artist, setArtist] = useState("");
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const tracks = Object.entries(titles)
      .filter(([, t]) => t.trim())
      .map(([p, t]) => ({ position: Number(p), title: t.trim() }));
    try {
      setSaved(await onSubmitNames({ album: album.trim() || undefined, albumArtist: artist.trim() || undefined, tracks }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className={styles.nameFields}>
      <summary className={styles.nameSummary}>Name it as it rips (optional)</summary>
      <div className={styles.nameGrid}>
        <input className={styles.searchInput} placeholder="Album" value={album} onChange={(e) => setAlbum(e.target.value)} disabled={busy} />
        <input className={styles.searchInput} placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} disabled={busy} />
        {(status.tracks ?? []).map((t) => (
          <input
            key={t.position}
            className={styles.searchInput}
            placeholder={`Track ${String(t.position).padStart(2, "0")}`}
            value={titles[t.position] ?? ""}
            onChange={(e) => setTitles((p) => ({ ...p, [t.position]: e.target.value }))}
            disabled={busy}
          />
        ))}
      </div>
      <div className={styles.row}>
        <Button onClick={() => void submit()} disabled={busy || saving} variant="secondary">
          {saving ? "Saving…" : "Save names"}
        </Button>
        {saved !== null && (
          <span className={styles.muted}>{saved > 0 ? `Named ${saved} track${saved === 1 ? "" : "s"}.` : "Saved."}</span>
        )}
      </div>
    </details>
  );
}

// IncompleteRip (A3/A4): a partial rip, surfaced prominently. Lists the tracks
// that couldn't be read, each with a one-tap retry. The friendly "done" copy is
// reserved for complete rips only.
function IncompleteRip({
  status,
  busy,
  onRetryTrack,
  onClear,
  actionMsg,
}: {
  status: RipStatus;
  busy: boolean;
  onRetryTrack?: (position: number) => void;
  /** Job A: leave the incomplete state without retrying (resets to idle). */
  onClear?: () => void;
  actionMsg?: string | null;
}) {
  const failed = (status.tracks ?? []).filter((t) => t.state === "error");
  const total = status.trackCount ?? status.tracks?.length ?? status.completedTracks;
  const kept = status.completedTracks;
  return (
    <div className={styles.stack}>
      <div className={styles.incompleteHead}>
        <AlertTriangle size={15} color="var(--cs-orange)" strokeWidth={1.8} />
        <span>{status.message ?? `Ripped ${kept} of ${total} - some tracks couldn’t be read.`}</span>
      </div>
      <div className={styles.muted}>
        The {kept} {kept === 1 ? "track" : "tracks"} that ripped are already in your library. You can retry the rest
        while the disc is in the drive, or just finish - nothing is lost.
      </div>
      <div className={styles.incompleteList}>
        {failed.map((t) => (
          <div key={t.position} className={styles.incompleteRow}>
            <span className={styles.trackNum}>{String(t.position).padStart(2, "0")}</span>
            <span className={styles.trackName} title={t.error || undefined}>
              {t.title}
            </span>
            <Button variant="secondary" disabled={busy} onClick={() => onRetryTrack?.(t.position)}>
              Retry
            </Button>
          </div>
        ))}
      </div>
      {/* Finishing keeps the ripped tracks (they're already saved) and closes the rip —
          it does NOT discard or re-rip. Primary so it reads as the clear way out, not a
          dead end behind the failing retries. */}
      {onClear && (
        <div className={styles.row}>
          <Button onClick={onClear} disabled={busy} variant="primary">
            Done - keep these {kept}
          </Button>
        </div>
      )}
      {actionMsg && <div className={styles.muted}>{actionMsg}</div>}
    </div>
  );
}

function Notice({ title, body }: { title: string; body?: React.ReactNode }) {
  return (
    <div className={styles.notice}>
      <div className={styles.noticeTitle}>{title}</div>
      {body && <div className={styles.noticeBody}>{body}</div>}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div className={styles.muted}>{children}</div>;
}

function Spinner() {
  // Brand: a gentle warm pulse, never a rotating spinner.
  return <LoadingDots />;
}

// The universal eject glyph (a triangle over a bar). lucide-react@1.18 ships no
// eject icon, so it's inlined - filled for clarity at the small button size.
function EjectGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M6 13 12 6 18 13 Z" />
      <rect x="6" y="15.4" width="12" height="2.4" rx="0.6" />
    </svg>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

// ── FAQ (Job 3) ──────────────────────────────────────────────────────────────
// Shown only where ripping is possible (drive present). Answers the three
// questions truthfully, including the honest crash behavior.


/**
 * Native Playback remote (web lane) — the dashboard is a remote control, not a
 * player. These helpers POST commands to the local Cassette Player sidecar, which
 * resolves stream URLs and drives the hub's native audio engine (AVFoundation on
 * macOS, a bundled headless mpv on Windows/Linux), and poll the engine's live
 * state to drive the transport bar. The browser never streams.
 *
 * Fail-soft by contract: an unreachable / missing sidecar is a quiet console line
 * and a neutral return — never a thrown error or an alarming UI state.
 */

import { hubFetch, hubURL, SIDECAR_SAME_ORIGIN } from "@/lib/hub-origin";
import { IMAGE_RUNGS, type ImageRung } from "@discovery/cassette-kit/images";
import { ladderSrc, picture } from "@/lib/images/picture";
import { coverOrder } from "@/lib/covers/album-tier";

/**
 * Where the hub is, for this page (lib/hub-origin): the desktop app's same-origin route
 * (SIDECAR_SAME_ORIGIN, true in any desktop build), local development's loopback address, or
 * nowhere on the website in a regular browser, where every call below fails soft without a request.
 * Build-time constants, so SSR and client agree (no hydration flip).
 *
 * Cover resolution reads SIDECAR_SAME_ORIGIN to prefer the on-disk ripped cover on desktop: a
 * localhost <img> read beats fetching from R2/CAA and re-encoding through the bundled server's image
 * optimizer. Elsewhere covers stay catalog-first.
 */
export { HUB_IN_REACH, SIDECAR_SAME_ORIGIN } from "@/lib/hub-origin";

/** A track the hub can play: its local id + the metadata the engine reports. */
export type PlayQueueItem = {
  subsonicTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  mbid: string | null;
};

/** Live engine state the transport bar reflects. null when unreachable/idle. */
export type PlaybackState = {
  currentTrackId: string | null;
  positionSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  queueIndex: number;
  queueLength: number;
};

export type RepeatMode = "off" | "all" | "one";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One command attempt. Distinguishes "reached the engine" (ok/err) from
 *  "never reached it" (fetch threw) — the retry below leans on that difference. */
async function postOnce(path: string, body?: unknown): Promise<"ok" | "err" | "unreachable"> {
  try {
    const r = await hubFetch(path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      console.debug("[playback]", path, "→", r.status);
      return "err";
    }
    return "ok";
  } catch (err) {
    console.debug("[playback]", path, "unreachable (fail-soft):", err);
    return "unreachable";
  }
}

/**
 * POST a transport command. Fail-soft, and on the desktop app, crash-tolerant:
 * the local UI server can die and be restarted by the hub watchdog (see
 * cassette-desktop-hub-watchdog), and a press that lands in that ~1-2s window
 * would otherwise be dropped — which is exactly why play/pause + spacebar "stop
 * working" together after a crash. So when the sidecar is same-origin (desktop),
 * we briefly retry, but ONLY while the request is still unreachable (fetch threw,
 * i.e. the command never reached the engine). That guard makes the retry safe
 * even for non-idempotent commands like next/prev: we never resend something that
 * may already have run. A reached-but-errored response is returned as-is (no
 * retry). On the web (remote/absent sidecar) it stays single-shot as before.
 */
async function post(path: string, body?: unknown): Promise<boolean> {
  const first = await postOnce(path, body);
  if (first !== "unreachable" || !SIDECAR_SAME_ORIGIN) return first === "ok";
  // ~2.2s total, matched to the watchdog's restart-and-relisten window.
  for (const delay of [300, 700, 1200]) {
    await sleep(delay);
    const res = await postOnce(path, body);
    if (res !== "unreachable") return res === "ok";
  }
  return false;
}

/** Replace the engine's queue and start at startIndex. */
export function requestPlayQueue(
  queue: PlayQueueItem[],
  startIndex: number,
  repeat: RepeatMode
): Promise<boolean> {
  return post("/api/playback/play", { queue, startIndex, repeat });
}

/**
 * Replace the songs after the one playing, leaving it playing where it is: what the shuffle switch
 * does mid-queue (on mixes up what's left, off puts the list's own order back). An empty queue
 * clears what's next.
 */
export function requestSetUpcoming(queue: PlayQueueItem[]): Promise<boolean> {
  return post("/api/playback/queue", { queue });
}

export const requestPause = () => post("/api/playback/pause");
export const requestResume = () => post("/api/playback/resume");
export const requestNext = () => post("/api/playback/next");
export const requestPrev = () => post("/api/playback/prev");
export const requestSeek = (positionSeconds: number) =>
  post("/api/playback/seek", { positionSeconds });
export const requestSetRepeat = (mode: RepeatMode) =>
  post("/api/playback/repeat", { mode });
/** level is 0..1. Client-authoritative (see shell-context) — no live value to
 *  read back, this only ever pushes. */
export const requestSetVolume = (level: number) =>
  post("/api/playback/volume", { level });

/**
 * The image ladder's size for a request of `px` pixels: the smallest size that holds it, else the largest
 * (120, 240, 480, 800, 1200; docs/reference/CASSETTE_IMAGES.md). Every hub picture address is built at one
 * of these, whatever the caller asks, so one cover has one address per size and the window reuses what it
 * already holds (2026-11-08: callers asked 80, 108, 400, 1400 and twice their box, five rules for one cover).
 */
export function hubRung(px: number): ImageRung {
  return IMAGE_RUNGS.find((r) => r >= px) ?? IMAGE_RUNGS[IMAGE_RUNGS.length - 1]!;
}

/**
 * URL of a track's cover, served by the sidecar proxy (the only component with
 * Navidrome admin creds — the browser never hits :4533 directly). Used as an
 * <img> src keyed on the track id; the sidecar returns a clean 404 when there's
 * no local art yet, so the caller keeps its gradient fallback. size is the
 * pixel edge to request (e.g. 92 for a crisp 46px retina tile).
 *
 * `version` is an opt-in cache-buster for a cover replaced in this window (see
 * `bumpLocalCoverEpoch`): it forces mounted `<img>` tags to refetch when the
 * address is otherwise unchanged.
 *
 * `coverVersion` is the folder cover's own version (lib/dashboard/local-cover-version,
 * the fingerprint the hub syncs), sent as `cv=`. With it the hub keeps the
 * picture for good (`immutable`) once it has checked the version is the cover in
 * the folder now, so the window never asks for that cover again until it changes;
 * without it the hub keeps it an hour (BUG-920).
 */
export function coverArtURL(trackId: string, size: number, version?: number, coverVersion?: string | null): string | null {
  const base = hubURL(`/api/playback/cover?trackId=${encodeURIComponent(trackId)}&size=${hubRung(size)}`);
  if (base === null) return null;
  const cv = coverVersion ? `&cv=${encodeURIComponent(coverVersion)}` : "";
  return `${base}${cv}${version != null ? `&v=${version}` : ""}`;
}

/**
 * The ONE ordered cover-source list for the now-playing surfaces (transport bar,
 * right-rail source header, visualizer). Best source first; the renderer falls
 * through on load error.
 *
 * Desktop app (same-origin sidecar): the on-disk folder cover is the source of
 * truth and already HOLDS the user's pick (a chosen cover is mirrored into
 * cover.jpg), so it goes FIRST — a localhost read that is instant, works offline
 * (the whole point: a laptop in a car with no signal still shows every cover),
 * and never touches R2/CAA. The cloud URLs (override, catalog) sit behind it only
 * to cover the brief window before a just-made pick has mirrored to the folder.
 *
 * Web (no local hub): unchanged — the user's cloud pick first, then the catalog.
 * This mirrors the desktop-local-first flip ArtistPhoto already ships.
 *
 * Each cloud picture comes first at the image ladder's size for `size` (device
 * pixels; docs/reference/CASSETTE_IMAGES.md), then as stored, should the ladder
 * not answer.
 */
export function nowPlayingCoverCandidates(opts: {
  trackId: string | null;
  overrideUrl?: string | null;
  catalogUrl?: string | null;
  size: number;
  /** Cache-bust for the local folder cover after an in-place replace. */
  localCoverVersion?: number;
}): string[] {
  const local = opts.trackId
    ? coverArtURL(opts.trackId, opts.size, opts.localCoverVersion)
    : null;
  const rung = hubRung(opts.size);
  // the ladder's size, then the stored original when it is ours (never Cover Art Archive or a banned host)
  const cloud = (url: string | null | undefined) => (url ? [ladderSrc(url, rung), picture(url, "cover").original] : []);
  // the one order (lib/covers/album-tier): desktop folder cover first, web the person's pick first
  return coverOrder({ local, override: cloud(opts.overrideUrl), catalog: cloud(opts.catalogUrl) });
}

/**
 * URL of an ARTIST's local photo, served by the sidecar — the artist parallel of
 * coverArtURL. `trackId` anchors the artist folder (the sidecar walks two levels
 * up from the track). The sidecar materializes the photo on demand from our
 * catalog and returns a clean 404 when there is none, so the caller keeps its
 * catalog fallback. `version` is the same opt-in cache-buster as coverArtURL —
 * bump it after a local artist-photo replace to bypass the 24h cache.
 */
export function artistPhotoURL(trackId: string, size: number, version?: number): string | null {
  const base = hubURL(`/api/library/artist-photo?trackId=${encodeURIComponent(trackId)}&size=${hubRung(size)}`);
  return base !== null && version != null ? `${base}&v=${version}` : base;
}

/** Poll the engine's live state. Returns null if the sidecar is unreachable. */
export async function getPlaybackState(): Promise<PlaybackState | null> {
  try {
    const r = await hubFetch("/api/playback/state", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as PlaybackState;
  } catch {
    return null;
  }
}

/**
 * One frame of the live audio-levels feed: a spectrum, a short waveform, and an
 * overall level, produced by the hub's read-only tap on the real audio and
 * proxied by the sidecar (GET /api/playback/levels). Arrays are empty and level
 * is 0 when nothing is playing or the hub predates this feature. Consumers derive
 * bass/mid/treble/beat from the bins.
 */
export type RawLevels = { bins: number[]; wave: number[]; level: number };

/** Poll the live audio-levels frame. null when the sidecar is unreachable. */
export async function getPlaybackLevels(): Promise<RawLevels | null> {
  try {
    const r = await hubFetch("/api/playback/levels", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as RawLevels;
  } catch {
    return null;
  }
}

/**
 * The current cover's dominant colors, computed hub-side from the same Navidrome
 * getCoverArt bytes the cover proxy serves (GET /api/playback/palette). This lets
 * a visualizer follow the album's colors WITHOUT a cross-origin canvas pixel read
 * (which the web portal can block). null when there's no readable art.
 */
export type CoverPalette = { bg: string; ink: string; accent: string; accent2: string; palette: string[] };

export async function getCoverPalette(trackId: string): Promise<CoverPalette | null> {
  try {
    const r = await hubFetch(`/api/playback/palette?trackId=${encodeURIComponent(trackId)}`);
    if (!r.ok) return null;
    return (await r.json()) as CoverPalette;
  } catch {
    return null;
  }
}

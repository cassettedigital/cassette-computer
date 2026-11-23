"use client";

/**
 * Shell state — the ONE client provider boundary for the workbench dashboard
 * (Jobs 4–6). Holds Player/Queue state, the rail source + build tabs, the ⌘K
 * palette, and the immersive overlay; wraps everything in a dnd-kit DndContext.
 * Inner /dashboard pages stay SERVER components — they render as {children}
 * inside <DashboardShell>, which mounts this provider.
 *
 * Stage A: state + structure. The drag DROP logic (enqueue / playlist /ops +
 * toast) and the immersive data fetch are wired in Stage C — marked TODO.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { swrRead } from "@/lib/read-cache";
import { announceAudioLane, onOtherAudioLane } from "@/lib/audio-lane";
import { sweepPendingCoverMirrors } from "@/lib/cover-mirror-sweep";
import {
  getPlaybackState,
  requestNext,
  requestPause,
  requestPlayQueue,
  requestSetUpcoming,
  requestPrev,
  requestResume,
  requestSeek,
  requestSetRepeat,
  requestSetVolume,
  HUB_IN_REACH,
  SIDECAR_SAME_ORIGIN,
  type PlayQueueItem,
} from "@/lib/playback-remote";
import { spaceIsTheFocus, watchFocusArrival } from "@/lib/keys";
import { reconcileQueueMirror } from "./queue-mirror";
import { useNoteNowPlaying } from "@/lib/diagnostics/now-playing";
import type {
  LibraryAlbumCard,
  LibraryArtistCard,
} from "@/lib/dashboard/library-card-types";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

// Client-safe mirror of the server's CASSETTE_LOCAL_ID_RE (sync-shapes). The
// /ops endpoint rejects any add whose cassette_local_id isn't 32-hex with a
// 400 — we guard here so a bad id surfaces a toast, never a doomed request.
const LOCAL_ID_RE = /^[0-9a-f]{32}$/;

// How long an optimistic play (~4 polls) is trusted over the engine poll before
// the id-reconcile falls back to engine truth — bounds click-suppression so a
// dropped play command self-heals instead of freezing the mirror forever.
const PENDING_SETTLE_MS = 4000;

function generateUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ShellTrack = {
  title: string;
  artist: string;
  album?: string;
  duration?: string; // formatted "4:21"
  durationSeconds?: number | null;
  cassetteLocalId?: string;
  mbid?: string | null;
  // Local Navidrome track id — present only for library-sourced tracks (the
  // native player needs it to resolve the stream). Absent for catalog-only
  // tracks, which are not locally playable. (Native Playback Slice 2.)
  subsonicTrackId?: string;
  // Which disc this track is on (migration 0043). Present for library-sourced
  // tracks; drives the rail's "Disc N" grouping. Absent/null = single-disc.
  discNumber?: number | null;
  // Album-level cover references, carried per-track so the now-playing bar can
  // resolve art with the SAME precedence as every other surface (override →
  // local → catalog) even after the queue outlives the opened album. Populated on
  // the library-play path (rail source / grid); absent on catalog/playlist paths,
  // which degrade to the local sidecar file. Presentational only — never sent to
  // the native queue (toQueueItem ignores them).
  albumCoverUrl?: string | null;
  albumCoverOverrideUrl?: string | null;
};

export type SourceAlbum = {
  kind: "album";
  slug?: string;
  /** Catalog artist slug — header artist opens the artist rail / immersive. */
  artistSlug?: string;
  /** Owned-artist group key (`catalog-artist:<id>`) when opened from the library. */
  artistGroupKey?: string;
  title: string;
  artist: string;
  coverUrl?: string | null;
  /** The small cover the CLICKED grid card already painted (browser-cached).
   *  The rail keeps it as an instant underlay while the canonical full-size
   *  coverUrl loads, so opening an album never shows a blank cover beat. */
  coverSmallUrl?: string | null;
  /** The user's chosen cover override, already cache-busted. OUTRANKS coverUrl +
   *  local art in the rail (mirrors the grid card), so every surface agrees. */
  coverOverrideUrl?: string | null;
  dominantColor?: string | null;
  /** Effective album metadata (personal override → catalog base) for the rail
   *  header line + edit-pane pre-fill. Null when neither is known. */
  year?: number | null;
  label?: string | null;
  genre?: string | null;
  /** Inherited album group key — set when opened from the library (enables the
   *  manual "Find this album" / "Remove match" actions in the rail). */
  groupKey?: string;
  /** True when this library album is linked via a manual match. */
  manualMatch?: boolean;
  tracks: ShellTrack[];
};

export type SourceArtistAlbum = {
  slug: string;
  title: string;
  coverUrl?: string | null;
  coverOverrideUrl?: string | null;
  localCoverTrackId?: string | null;
  /** Owned album group key — prefer selectAlbumByGroupKey when set. */
  groupKey?: string | null;
  dominantColor?: string | null;
};

export type SourceArtist = {
  kind: "artist";
  slug?: string;
  name: string;
  imageUrl?: string | null;
  /** True when imageUrl is a personal library pick (not catalog). */
  imageIsOverride?: boolean;
  /** Folder-anchor track for the desktop local artist-photo proxy. Seeded from
   *  the library card so the hero never waits on Popular tracks to go local. */
  localArtistPhotoTrackId?: string | null;
  /** Artist card group key — set when opened from the library, so the rail's
   *  overflow menu can Hide / Delete the owned artist. Absent for a catalog
   *  artist opened by slug. */
  groupKey?: string;
  tracks: ShellTrack[];
  albums: SourceArtistAlbum[];
  /** Popular teaser size (≤20). When > tracks.length, remaining songs still loading. */
  trackTotal?: number;
  /** Library album count for the hero meta line. Seeded from the card so the
   *  play row doesn't jump when albums stream in; falls back to albums.length. */
  albumCount?: number;
  /** Library song count for the hero meta line (card / owned total). Distinct
   *  from trackTotal, which is only the Popular teaser size. */
  songCount?: number;
};

/** A freshly-generated Smart Mixtape/Radio/mood-door result — NOT a saved
 * playlist until the listener presses Save (POST /api/mixtape/save). Opens
 * the rail without touching playback (`selectMixtape` never calls
 * play/playFrom) — generating a mixtape should never yank audio out from
 * under whatever's already playing. */
export type SourceMixtape = {
  kind: "mixtape";
  name: string;
  description: string | null;
  /** Procedural motif (MoodTileArt shape + the door's own color) for doors;
   *  null for the whole-library/Radio generators, which render a plain
   *  gradient instead. `cover` is the door's own cover (lib/covers/mix.ts),
   *  shown in place of the motif when it's there. */
  art: { shape: string; color: string; cover?: string | null } | null;
  tracks: ShellTrack[];
  saved: boolean;
  savedPlaylistId: string | null;
  /** Set only for a mood-door mixtape (lib/mixtape/mood-doors.ts key) — drives
   *  the rail's Rebuild action, which re-POSTs /api/mixtape/door with
   *  rebuild:true for this key. null for Smart Mixtape/Radio, which have no
   *  daily-cache concept to rebuild. */
  doorKey: string | null;
};

/** The right-rail source — the "phone view" of whatever was clicked. */
export type Source = SourceAlbum | SourceArtist | SourceMixtape;

export type ImmersiveKind = "album" | "artist";

/**
 * Owner cover context carried into the immersive album modal so its hero renders
 * folder-first (the user's override / their folder cover.jpg via the sidecar),
 * matching the grid card and the right rail instead of a bare catalog cover. The
 * opener (the right rail) already has these resolved; the modal is otherwise
 * slug-only and would fall back to catalog.
 */
export type ImmersiveCover = {
  localCoverTrackId?: string | null;
  coverOverrideUrl?: string | null;
};

export type OpenPlaylist = { id: string; name: string };

export type RepeatMode = "off" | "all" | "one";

export type ToastVariant = "info" | "success" | "error";
export type ToastState = { msg: string; variant: ToastVariant };

/** Fisher–Yates shuffle (returns a new array). */
function shuffleArr<T>(a: T[]): T[] {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** A ShellTrack → native queue item, or null when it has no local file (not
 *  playable on the Mac this slice). Module-level so callbacks stay stable. */
function toQueueItem(t: ShellTrack): PlayQueueItem | null {
  if (!t.subsonicTrackId) return null;
  return {
    subsonicTrackId: t.subsonicTrackId,
    title: t.title,
    artist: t.artist,
    album: t.album ?? "",
    durationSeconds: t.durationSeconds ?? 0,
    mbid: t.mbid ?? null,
  };
}

/** An open playlist page registers one of these so a track dragged from the
 *  rail can land at a chosen slot (not just append). The page owns the geometry
 *  (its own rows) and the write (fractional-position add), so this stays a thin
 *  routing seam — the shell only forwards the pointer and the dropped track. */
export type PlaylistDropTarget = {
  /** Position the page's insertion line for the current pointer Y, or hide it
   *  when null. Imperative + DOM-direct on purpose: this fires on every pointer
   *  move, so it must NOT go through React state (that re-renders the whole app
   *  each tick — the source of the old jerkiness). */
  setPreview: (clientY: number | null) => void;
  /** Persist the dropped track at the page's currently-previewed slot. */
  onDrop: (track: ShellTrack) => void;
};

/** Current pointer Y during a drag: the pointerdown's clientY plus the drag
 *  delta. dnd-kit doesn't hand the live pointer to the drag events, but this
 *  reconstructs it exactly, which is what row hit-testing needs. */
function pointerYFromDrag(e: {
  activatorEvent: Event;
  delta: { y: number };
}): number | null {
  const act = e.activatorEvent as { clientY?: number } | null;
  const baseY = act && typeof act.clientY === "number" ? act.clientY : null;
  return baseY == null ? null : baseY + e.delta.y;
}

type ShellState = {
  // player / queue (presentational — no audio)
  nowPlaying: ShellTrack | null;
  upNext: ShellTrack[];
  /** Play a single track (replaces the queue with just it). */
  play: (t: ShellTrack) => void;
  /**
   * Play a track list from startIndex, the rest after it. Play turns shuffle off; `shuffle: true`
   * (a Shuffle key) turns it on, starts on the chosen song and mixes up the rest, as the phone does.
   */
  playFrom: (tracks: ShellTrack[], startIndex?: number, opts?: { shuffle?: boolean }) => void;
  enqueue: (t: ShellTrack) => void;
  /**
   * The phone's two queue verbs: songs right after the one playing ("Play Next") or at the end of what's
   * coming ("Add to Queue"). The hub swaps the songs after the current one without restarting it
   * (/api/playback/queue, the shuffle switch's command); with nothing playing, the songs simply start.
   * Resolves false when the hub said no (a hub from 0.5.19 or older).
   */
  playNext: (tracks: ShellTrack[]) => Promise<boolean>;
  addToQueue: (tracks: ShellTrack[]) => Promise<boolean>;
  /**
   * Everything after the song playing, replaced in one go (the same hub command). Keep playing keeps
   * its next record at the end of the queue with it. Resolves false when nothing is playing or the
   * hub said no.
   */
  replaceUpcoming: (tracks: ShellTrack[]) => Promise<boolean>;
  removeFromQueue: (i: number) => void;
  next: () => void;
  prev: () => void;
  shuffle: boolean;
  repeat: RepeatMode;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  /** Repeat set straight to `mode` (keep playing turns it off in one step). */
  setRepeatMode: (mode: RepeatMode) => void;
  /** 0..1. Client-authoritative like repeat (no live engine value to poll —
   *  see setVolume): starts full each session, never drifts from what the
   *  user last set here. */
  volume: number;
  setVolume: (level: number) => void;
  /** Real play/paused state, reflected from the native engine (polled). */
  playing: boolean;
  togglePlay: () => void;
  /** Elapsed + total seconds of the current track (polled from the engine). */
  positionSeconds: number;
  durationSeconds: number;
  /** The engine's actual current track id (polled). null when idle/unreachable.
   *  Source of truth for now-playing cover art. */
  currentTrackId: string | null;
  /** Whether the local hub (Cassette Player) is reachable. null until the first
   *  probe resolves; false after a couple of missed polls. The web is a remote
   *  control of the hub, so false means "can't play here" — drives the offline
   *  banner + dimmed/greyed playback affordances. */
  hubReachable: boolean | null;
  /** Seek the current track to an absolute position in seconds. */
  seek: (seconds: number) => void;
  // rail source (clicked album or artist — the "phone view")
  source: Source | null;
  selectAlbum: (a: Source | null) => void;
  /** Open a freshly-generated mixtape in the rail. Auto-open, never
   *  auto-play (see the implementation). */
  selectMixtape: (
    input: Pick<SourceMixtape, "name" | "description" | "art" | "tracks"> &
      Partial<Pick<SourceMixtape, "doorKey">>
  ) => void;
  /** Mark the currently-open mixtape source as saved (after POST /api/mixtape/save succeeds). */
  markMixtapeSaved: (playlistId: string) => void;
  /** Fetch the lean album source by slug and make it the rail source. */
  selectAlbumBySlug: (slug: string) => Promise<void>;
  /** Fetch inherited library tracks by album group key and open the rail.
   *  `optimistic`, when the caller already has the card's own data in hand
   *  (e.g. a grid click), paints the header instantly from that instead of
   *  waiting on the network round trip — tracks stream in moments later. */
  selectAlbumByGroupKey: (
    groupKey: string,
    optimistic?: {
      title: string;
      artist: string;
      coverUrl: string | null;
      /** The exact URL the clicked card's <img> is showing (decoded+cached). */
      paintedCoverUrl?: string | null;
      coverOverrideUrl?: string | null;
      dominantColor: string | null;
    }
  ) => Promise<void>;
  /** Warm the SWR cache for an album's inherited tracklist WITHOUT opening the
   *  rail — call on hover/highlight so a later click paints instantly. Deduped
   *  per session; cheap and safe to call repeatedly. */
  prefetchAlbumByGroupKey: (groupKey: string, coverUrl?: string | null) => void;
  /** Play a whole library album immediately (the hover play button on album
   *  cards). Reuses the same lib-album tracklist cache the grid warms on hover,
   *  so a cache-hot album starts instantly; playFrom(tracks, 0). */
  playAlbumByGroupKey: (groupKey: string) => void;
  /** Fetch the artist phone-view by slug and make it the rail source. */
  selectArtistBySlug: (slug: string) => Promise<void>;
  /** Fetch the user's OWNED albums/tracks for an artist by group key (B1).
   *  `optimistic` — see selectAlbumByGroupKey. */
  selectArtistByGroupKey: (
    groupKey: string,
    optimistic?: {
      name: string;
      imageUrl: string | null;
      imageIsOverride?: boolean;
      localArtistPhotoTrackId?: string | null;
      albumCount?: number;
      songCount?: number;
    }
  ) => Promise<void>;
  /** Warm the SWR cache for an artist's owned source WITHOUT opening the
   *  rail — call on hover/highlight so a later click paints instantly. Deduped
   *  per session; mirrors prefetchAlbumByGroupKey. */
  prefetchArtistByGroupKey: (groupKey: string) => void;
  sourceLoading: boolean;
  // build tabs
  openPlaylists: OpenPlaylist[];
  /** All of the user's playlists — candidates to open as a build target. */
  availablePlaylists: OpenPlaylist[];
  /** Hydrate the playlist list after the sidebar data streams in (the provider
   *  now mounts before that data resolves). See HydrateShellPlaylists. */
  setAvailablePlaylists: (playlists: OpenPlaylist[]) => void;
  activeBuild: string; // "upnext" | playlistId
  openBuild: (p: OpenPlaylist | "upnext") => void;
  setActiveBuild: (id: string) => void;
  closeBuild: (id: string) => void;
  /** Whether the Build region (Up Next / playlist tabs) is revealed. Progressive
   *  disclosure: opening a playlist or the Queue button flips this on. */
  buildOpen: boolean;
  closeBuildRegion: () => void;
  // rail open/collapsed
  railOpen: boolean;
  setRailOpen: (v: boolean) => void;
  // immersive full-page overlay (album or artist)
  immersiveSlug: string | null;
  immersiveKind: ImmersiveKind;
  /** Owner cover context for the current immersive album (null on the public /
   *  artist path). Lets the modal hero render folder-first. */
  immersiveCover: ImmersiveCover | null;
  openImmersive: (slug: string, kind?: ImmersiveKind, cover?: ImmersiveCover | null) => void;
  closeImmersive: () => void;
  /** Visualizer Lab — a full-screen overlay (NOT a route), so opening/closing it
   *  never unmounts the page underneath (no reload, no cover reflash). */
  labOpen: boolean;
  openLab: () => void;
  closeLab: () => void;
  // transient status toast (drag results, library actions, errors). Carries a
  // variant so success/failure read differently and errors linger longer.
  toast: ToastState | null;
  showToast: (msg: string, opts?: { variant?: ToastVariant }) => void;
  /** Add tracks to one of the person's playlists (one request; a record goes in
   *  its order). Toasts the result. */
  /** True when they went on. `already`: how many more were asked for that the playlist has already (the desk
   *  leaves those out, desk/owned.tsx), said in the same note. */
  addTracksToPlaylist: (playlistId: string, playlistName: string, tracks: ShellTrack[], opts?: { already?: number }) => Promise<boolean>;
  // drag state (for sidebar auto-expand + drop-target flash)
  dragging: boolean;
  flashPlaylistId: string | null;
  /** An open playlist page registers itself as a drop target so a dragged
   *  track can land at a chosen slot. Returns an unregister fn. */
  registerPlaylistDropTarget: (
    playlistId: string,
    target: PlaylistDropTarget
  ) => () => void;
  /** Optimistically-Hidden card group keys (Job 3). The library grids filter
   *  these out instantly; a failed hide restores them. The cloud stays the
   *  write-truth — router.refresh() reconciles the server grid after success. */
  optimisticallyRemoved: ReadonlySet<string>;
  removeOptimistically: (groupKey: string) => void;
  restoreOptimistically: (groupKey: string) => void;
  /** Re-pull the warm library-cards snapshot (below) from the server. The grids
   *  render from that CLIENT snapshot, so router.refresh() (which only re-runs
   *  SERVER components) can't update them — call this after a change that alters
   *  card data (e.g. a cover pick) so the grid reflects it without a full reload. */
  refreshLibrary: () => void;
  /** The whole library as cards, loaded ONCE into the persistent shell (SWR from
   *  IndexedDB) so the Albums/Artists views render instantly with no
   *  per-navigation server fetch. null until the first snapshot (cache or fresh)
   *  resolves. */
  libraryAlbums: LibraryAlbumCard[] | null;
  libraryArtists: LibraryArtistCard[] | null;
  /** True once a snapshot (cached or fresh) has painted — drives the one-time
   *  first-load skeleton on the browse views; instant on every toggle after. */
  libraryLoaded: boolean;
  /** True when the first load found neither a saved copy nor the cloud, so the
   *  browse views say they're offline instead of loading forever (BUG-782). Goes
   *  back to false as soon as a later try (focus, the minute poll) succeeds. */
  libraryUnavailable: boolean;
  /** Self-serve beta-stream opt-in (users.is_beta_tester), read once server-side
   *  by the dashboard layout and handed down here. Gates early/experimental UI
   *  (e.g. the Mixtape feature) without a separate branch or deploy — see
   *  Settings › Account's "Early features" toggle. */
  isBetaTester: boolean;
};

const Ctx = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell must be used within <ShellProvider>");
  return c;
}

export function ShellProvider({
  children,
  playlists = [],
  isBetaTester = false,
  library = true,
}: {
  children: ReactNode;
  playlists?: OpenPlaylist[];
  /** Server-resolved once by the dashboard layout (getDashboardSession); see
   *  ShellState.isBetaTester. */
  isBetaTester?: boolean;
  /** Keep the whole library warm as cards (libraryAlbums / libraryArtists): loaded on mount, on
   *  focus and every minute while visible. The old library's grids read it; the desk mounts this
   *  provider for its player only, draws its library from its own data, and turns it off, or a
   *  window left open rebuilt the whole library about 60 times an hour for nothing (BUG-608).
   *  refreshLibrary still loads it on demand. */
  library?: boolean;
}) {
  // Playlist list for build targets. Initialised from the prop (back-compat for
  // any caller that still passes playlists) and hydrated by SidebarData once the
  // sidebar streams in, since the provider mounts before that data resolves.
  const [availablePlaylists, setAvailablePlaylists] =
    useState<OpenPlaylist[]>(playlists);
  const availablePlaylistsRef = useRef(availablePlaylists);
  availablePlaylistsRef.current = availablePlaylists;

  const [queue, setQueue] = useState<ShellTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(1);
  const lastVolumeSendRef = useRef(0);
  const volumeTrailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  // The engine's actual current track id (polled). Drives now-playing cover art;
  // distinct from the queue mirror's nowPlaying, which can drift (see bug register).
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);
  // Whether the local hub (Cassette Player sidecar) is reachable. null until the
  // first probe resolves; false after a couple of missed polls. Playback is a
  // remote control of that hub, so when it's gone nothing can play — this drives
  // the honest offline UI (dimmed covers, greyed play, "open Cassette" banner).
  // The website in a regular browser never reaches a hub (lib/hub-origin), so
  // there it is false from the start and never probed.
  const [hubReachable, setHubReachable] = useState<boolean | null>(HUB_IN_REACH ? null : false);
  const [source, setSource] = useState<Source | null>(null);
  const [openPlaylists, setOpenPlaylists] = useState<OpenPlaylist[]>([]);
  const [activeBuild, setActiveBuild] = useState("upnext");
  const [buildOpen, setBuildOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [immersiveSlug, setImmersiveSlug] = useState<string | null>(null);
  const [immersiveKind, setImmersiveKind] = useState<ImmersiveKind>("album");
  const [immersiveCover, setImmersiveCover] = useState<ImmersiveCover | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingTrack, setDraggingTrack] = useState<ShellTrack | null>(null);
  const [flashPlaylistId, setFlashPlaylistId] = useState<string | null>(null);
  // Job 3 — optimistic Hide: the grids drop these keys instantly; a failed hide
  // restores them. Cloud stays the write-truth (router.refresh reconciles).
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const removeOptimistically = useCallback((groupKey: string) => {
    setOptimisticallyRemoved((prev) => new Set(prev).add(groupKey));
  }, []);
  const restoreOptimistically = useCallback((groupKey: string) => {
    setOptimisticallyRemoved((prev) => {
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });
  }, []);

  // ── Library store: the whole library as cards, loaded ONCE into the shell ──
  // Stale-while-revalidate from IndexedDB. The persistent shell keeps this
  // mounted across navigation, so the Albums/Artists views render from this warm
  // store instead of re-fetching per route change — the toggle is instant (and
  // offline-durable on the desktop app, which otherwise crosses the WAN to Neon
  // on every click). A cached snapshot paints first; a fresh fetch reconciles.
  const [libraryAlbums, setLibraryAlbums] = useState<LibraryAlbumCard[] | null>(null);
  const [libraryArtists, setLibraryArtists] = useState<LibraryArtistCard[] | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryUnavailable, setLibraryUnavailable] = useState(false);
  // Load (and refresh) the warm library-cards snapshot via SWR. On a manual
  // refresh the cache-first paint re-sets the SAME cards already on screen (a
  // visual no-op) before the fresh fetch reconciles — so a post-pick refresh
  // updates covers with no flicker and keeps the IndexedDB cache fresh too.
  const loadLibraryCards = useCallback(
    () =>
      swrRead<{ albums: LibraryAlbumCard[]; artists: LibraryArtistCard[] }>(
        "library-cards",
        async () => {
          const res = await fetch("/api/dashboard/library-cards", { credentials: "include" });
          if (!res.ok) throw new Error(`library-cards ${res.status}`);
          return res.json();
        },
        (data) => {
          setLibraryAlbums(data.albums ?? []);
          setLibraryArtists(data.artists ?? []);
          setLibraryLoaded(true);
          setLibraryUnavailable(false);
        }
      ).then(({ ok }) => {
        if (!ok) setLibraryUnavailable(true);
      }),
    []
  );
  useEffect(() => {
    if (library) void loadLibraryCards();
  }, [library, loadLibraryCards]);

  // Keep the warm snapshot fresh without a full app restart. It loads once on
  // mount and otherwise never re-fetches, so a play made on the phone (or the
  // Mac) never reorders the "Recent" strip. On the desktop app, closing and
  // reopening the window does NOT remount the webview, so the grid could sit
  // stale for a whole session — only a force-quit refreshed it. Revalidate when
  // the window regains focus (you came back from the phone) or becomes visible,
  // plus a light poll while visible for the "watching the desktop while the
  // phone plays" case. Throttled so a quick blur/focus can't spam the WAN round
  // trip the load-once was there to avoid; swrRead paints from cache first, so
  // the reconcile is flicker-free.
  useEffect(() => {
    if (!library) return;
    let lastAt = Date.now(); // the mount fetch just ran — don't immediately refetch
    const MIN_INTERVAL_MS = 30_000;
    const maybeRevalidate = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const now = Date.now();
      if (now - lastAt < MIN_INTERVAL_MS) return;
      lastAt = now;
      void loadLibraryCards();
    };
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) maybeRevalidate();
    };
    window.addEventListener("focus", maybeRevalidate);
    document.addEventListener("visibilitychange", onVisible);
    const iv = window.setInterval(maybeRevalidate, 60_000);
    return () => {
      window.removeEventListener("focus", maybeRevalidate);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(iv);
    };
  }, [library, loadLibraryCards]);

  // Push any cover picks the hub still owes into their folder cover.jpg. Runs once
  // per shell mount, off the critical path, and no-ops when nothing is pending.
  // This is what makes a pick made while the hub was asleep — or made from a phone
  // — still end up in the library, instead of living only as our cloud copy and
  // leaving every satellite to re-derive it from a remote server on every launch.
  useEffect(() => {
    void (async () => {
      const r = await sweepPendingCoverMirrors();
      if (r.written > 0) {
        console.info(`Cassette: wrote ${r.written} pending cover(s) to the library`);
        if (library) void loadLibraryCards(); // repaint against the folder we just corrected
      }
    })();
    // One-shot on mount; loadLibraryCards is stable and re-running would re-sweep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshLibrary = useCallback(() => {
    void loadLibraryCards();
  }, [loadLibraryCards]);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Explicit sensors: a 6px activation distance lets a click (play) and a drag
  // coexist on the same row, and makes activation deterministic (the previous
  // default-sensor + invisible-grip setup was the reason drags never fired).
  // PointerSensor ONLY — no KeyboardSensor on purpose: dnd-kit's keyboard sensor
  // picks up a focused draggable on Spacebar, which stole Space from play/pause
  // (a focused queue row started dragging on Space). Drag is mouse-driven.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const showToast = useCallback(
    (msg: string, opts?: { variant?: ToastVariant }) => {
      const variant = opts?.variant ?? "info";
      setToast({ msg, variant });
      if (toastTimer.current) clearTimeout(toastTimer.current);
      // Errors linger so a failure can't be missed; info/success are brief.
      toastTimer.current = setTimeout(
        () => setToast(null),
        variant === "error" ? 6000 : 2400
      );
    },
    []
  );

  const flashPlaylist = useCallback((id: string) => {
    setFlashPlaylistId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashPlaylistId(null), 700);
  }, []);

  // Refs mirror queue state so the player callbacks stay stable ([] deps) yet
  // read current values — no stale closures on skip / shuffle / repeat.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  // the list as it was given (its own order), for the shuffle switch to put back
  const givenRef = useRef<ShellTrack[]>([]);
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // After an optimistic play we expect the engine to converge to this id by
  // `pendingUntil`; until then the poll's stale currentTrackId is ignored so it
  // can't snap the mirror off the just-clicked track. Refs so the []-dep poll
  // reads them without re-subscribing.
  const pendingTrackRef = useRef<string | null>(null);
  const pendingUntilRef = useRef(0);

  // Another audio lane started in this page (radio, the preview booth): the hub
  // goes quiet. The engine is paused, not stopped, so Play resumes where it was.
  useEffect(
    () =>
      onOtherAudioLane("hub", () => {
        if (!playingRef.current) return;
        setPlaying(false); // optimistic; the poll confirms
        void requestPause();
      }),
    []
  );

  // Derived view of the queue. The queue/index are the web's mirror of what it
  // sent the native engine; playing/position/duration come from the engine poll
  // below, so the transport reflects REAL playback (SPEC §6).
  const nowPlaying = queueIndex >= 0 ? queue[queueIndex] ?? null : null;
  const upNext = queueIndex >= 0 ? queue.slice(queueIndex + 1) : queue;
  // a note to the founder says which song the library's player had on (lib/diagnostics/now-playing)
  useNoteNowPlaying(
    "library",
    nowPlaying
      ? { state: playing ? "playing" : "paused", title: nowPlaying.title, artist: nowPlaying.artist, album: nowPlaying.album ?? null }
      : null,
  );

  // Poll the native engine ~1s and reflect its truth. queueIndex reconciles to
  // the engine's current track BY ID (see the tick), so nowPlaying tracks real
  // playback even when the native queue is a filtered subset of the display one.
  useEffect(() => {
    if (!HUB_IN_REACH) return; // the website: no hub to poll (lib/hub-origin)
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFails = 0;
    // Consecutive polls on which the engine had no track loaded (see
    // queue-mirror.ts IDLE_POLLS_TO_TRUST).
    let idlePolls = 0;
    async function tick() {
      if (cancelled) return;
      // Don't poll a backgrounded tab — the sidecar drives audio, not this poll,
      // so a hidden tab needs no engine truth. visibilitychange resumes instantly.
      if (typeof document !== "undefined" && document.hidden) {
        timer = setTimeout(tick, 1000);
        return;
      }
      const st = await getPlaybackState();
      if (cancelled) return;
      if (st) {
        consecutiveFails = 0;
        idlePolls = st.currentTrackId ? 0 : idlePolls + 1;
        setHubReachable(true);
        setPlaying(st.isPlaying);
        setPositionSeconds(st.positionSeconds);
        setDurationSeconds(st.durationSeconds);
        setCurrentTrackId(st.currentTrackId);
        // Reconcile the queue mirror to engine truth. The decision (and every
        // case behind it) is the pure, unit-tested reconcileQueueMirror in
        // queue-mirror.ts. In short: match the engine's track BY ID, not index,
        // because the native queue is a filtered subset of the display queue
        // (BUG-029 / stuck cover); hold through the settle window after a click
        // so a stale poll can't snap off the just-clicked track; drop to neutral
        // when the engine is on a track this surface doesn't have (foreign
        // playback) — and, since BUG-333, when the engine has NOTHING loaded for
        // a couple of polls while the mirror still names a track: the album ran
        // out with repeat off, the hub restarted empty, or a play command never
        // landed. Neutral hides the transport (DashboardShell), the honest
        // at-rest state, instead of the last track hanging on the bar as if it
        // were still loaded.
        const q = queueRef.current;
        const decision = reconcileQueueMirror({
          queue: q,
          shownIndex: queueIndexRef.current,
          engine: st,
          pendingTrackId: pendingTrackRef.current,
          pendingUntil: pendingUntilRef.current,
          now: Date.now(),
          idlePolls,
        });
        if (decision.action === "snap") {
          setQueueIndex(decision.index);
        } else if (decision.action === "neutral") {
          setQueueIndex(-1);
          // What the engine consumed leaves the mirror; anything queued past it
          // stays as the local Up Next builder (enqueue is display-only until the
          // next Play — BUG-334). keepFrom 0 keeps everything (foreign playback).
          if (decision.keepFrom > 0) setQueue(q.slice(decision.keepFrom));
        }
        if (decision.clearPending) pendingTrackRef.current = null;
      } else {
        idlePolls = 0;
        const fails = ++consecutiveFails;
        // A sustained miss streak = the hub is genuinely unreachable, so the web
        // shows its honest offline state (dimmed covers, greyed play, the offline
        // strip / transport "reconnecting" line). A single later success flips it
        // back. The web (a remote control of a Mac that may be asleep) trips after
        // 2; the desktop app — where the hub is its OWN bundled sidecar and should
        // always be up — waits a touch longer (~4 quick polls) so a normal startup
        // race or a watchdog restart blip doesn't flash it, but a real stall still
        // surfaces instead of freezing on stale numbers with no explanation.
        const offlineAfter = SIDECAR_SAME_ORIGIN ? 4 : 2;
        if (fails >= offlineAfter) setHubReachable(false);
        // A few misses running: stop presenting stale "playing" (keeps the live LED
        // lit + position frozen). A later poll self-heals from engine truth.
        if (fails >= 3) setPlaying(false);
      }
      // 1Hz during active playback (smooth scrubber). While anything is wrong the
      // desktop keeps probing at 1Hz so the sidecar watchdog's restart is noticed
      // within ~1s; the web keeps its gentle back-off after the first miss (its hub
      // is a remote Mac that may stay asleep, so a 1Hz forever-poll would waste the
      // WAN round trip). Otherwise back off hard when idle so the machine can rest.
      const probeFast =
        playingRef.current ||
        (consecutiveFails > 0 && (SIDECAR_SAME_ORIGIN || consecutiveFails < 2));
      if (!cancelled) timer = setTimeout(tick, probeFast ? 1000 : 5000);
    }
    void tick();
    const onVisible = () => {
      if (cancelled || typeof document === "undefined" || document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick(); // refresh immediately instead of waiting out the backoff
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, []);

  const playFrom = useCallback(
    (tracks: ShellTrack[], startIndex = 0, opts?: { shuffle?: boolean }) => {
      if (!tracks.length) return;
      const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
      // Play plays in order and turns shuffle off; Shuffle starts on the chosen song, mixes up the
      // rest and turns shuffle on (the phone's rule, One Home 2026-10-28).
      const shuffling = opts?.shuffle === true;
      let ordered = tracks;
      let startAt = idx;
      if (shuffling) {
        ordered = [tracks[idx], ...shuffleArr(tracks.filter((_, i) => i !== idx))];
        startAt = 0;
      }
      // Send only the locally-playable tracks to the Mac; reindex the start to the
      // chosen track (or the nearest playable one before it).
      const playable: PlayQueueItem[] = [];
      let nativeStart = 0;
      ordered.forEach((t, i) => {
        const q = toQueueItem(t);
        if (!q) return;
        if (i <= startAt) nativeStart = playable.length;
        playable.push(q);
      });
      if (!playable.length) {
        // Nothing here can play, so nothing changes: the engine was never sent
        // this, and the mirror keeps naming whatever it is actually doing rather
        // than a selection that makes no sound (the poll would only have to undo
        // it — BUG-333).
        showToast("This isn't in your library yet");
        return;
      }
      givenRef.current = tracks;
      shuffleRef.current = shuffling;
      setShuffle(shuffling);
      setQueue(ordered);
      setQueueIndex(startAt);
      setPlaying(true);
      // Arm the settle window on the id the engine will ACTUALLY start (the start
      // is reindexed to the nearest playable track at/before startAt, or the
      // first playable one when none precedes it), so convergence detection is
      // exact and the reconcile isn't wrongly suppressed.
      pendingTrackRef.current = playable[nativeStart]?.subsonicTrackId ?? null;
      pendingUntilRef.current = Date.now() + PENDING_SETTLE_MS;
      announceAudioLane("hub");
      void requestPlayQueue(playable, nativeStart, repeatRef.current);
    },
    [showToast]
  );
  const play = useCallback(
    (t: ShellTrack) => {
      const q = toQueueItem(t);
      if (!q) {
        showToast("This isn't in your library yet"); // mirror untouched — see playFrom
        return;
      }
      setQueue([t]);
      setQueueIndex(0);
      setPlaying(true);
      // Arm the settle window so the first stale poll can't undo the optimistic index.
      pendingTrackRef.current = q.subsonicTrackId;
      pendingUntilRef.current = Date.now() + PENDING_SETTLE_MS;
      announceAudioLane("hub");
      void requestPlayQueue([q], 0, repeatRef.current);
    },
    [showToast]
  );
  const enqueue = useCallback((t: ShellTrack) => {
    // Local Up Next builder: appends to the DISPLAY queue only — the native
    // queue isn't live-edited yet, so this reaches the engine on no path today
    // (BUG-334). While nothing is playing the builder is just the list; it must
    // not fake a now-playing index for its first track (the engine poll reads a
    // named track the engine doesn't have as a stale mirror and clears it, and
    // Play/Next/Prev on that fake bar drove an idle engine anyway).
    setQueue((q) => [...q, t]);
  }, []);
  const removeFromQueue = useCallback((i: number) => {
    setQueue((q) => {
      const base = queueIndexRef.current >= 0 ? queueIndexRef.current + 1 : 0;
      return q.filter((_, idx) => idx !== base + i);
    });
  }, []);
  // Transport verbs drive the engine; the poll reflects the result back.
  const next = useCallback(() => {
    // A user Next is a deliberate move off the just-started track — drop the settle
    // window so the poll reconciles to the engine's new track without waiting it out.
    pendingTrackRef.current = null;
    void requestNext();
  }, []);
  const prev = useCallback(() => {
    pendingTrackRef.current = null;
    void requestPrev();
  }, []);
  const seek = useCallback((seconds: number) => {
    setPositionSeconds(seconds); // optimistic; the poll confirms
    void requestSeek(seconds);
  }, []);
  // Repeat is live (the engine changes its auto-advance). So is shuffle, as on the phone: on mixes
  // up what's left after the song playing, off puts the list's own order back from it. The hub
  // swaps the songs after the current one without restarting it (/api/playback/queue).
  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    shuffleRef.current = on;
    setShuffle(on);
    const q = queueRef.current;
    const at = queueIndexRef.current;
    if (at < 0 || at >= q.length) return;
    const current = q[at];
    let upcoming: ShellTrack[];
    if (on) {
      upcoming = shuffleArr(q.slice(at + 1));
    } else {
      const given = givenRef.current;
      const same = (t: ShellTrack) => (current.subsonicTrackId ? t.subsonicTrackId === current.subsonicTrackId : t === current);
      const from = given.findIndex(same);
      if (from < 0) return;
      upcoming = given.slice(from + 1);
    }
    // Up Next follows only when the hub took it: a hub from before this command (0.5.19 and older)
    // says no, and the switch then shapes the next list started, as it used to
    void requestSetUpcoming(upcoming.map(toQueueItem).filter((x): x is PlayQueueItem => !!x)).then((ok) => {
      if (ok && queueIndexRef.current === at && queueRef.current === q) setQueue([...q.slice(0, at + 1), ...upcoming]);
    });
  }, []);
  const insertUpcoming = useCallback(
    async (tracks: ShellTrack[], where: "next" | "last"): Promise<boolean> => {
      const add = tracks.filter((t) => t.subsonicTrackId);
      if (!add.length) return false;
      const q = queueRef.current;
      const at = queueIndexRef.current;
      if (at < 0 || at >= q.length) {
        playFrom(add, 0);
        return true;
      }
      const rest = q.slice(at + 1);
      const upcoming = where === "next" ? [...add, ...rest] : [...rest, ...add];
      const ok = await requestSetUpcoming(upcoming.map(toQueueItem).filter((x): x is PlayQueueItem => !!x));
      if (ok && queueIndexRef.current === at && queueRef.current === q) {
        setQueue([...q.slice(0, at + 1), ...upcoming]);
        // the list's own order, which shuffle-off puts back, keeps them too
        const current = q[at];
        const given = givenRef.current;
        const from = given.findIndex((t) => (current.subsonicTrackId ? t.subsonicTrackId === current.subsonicTrackId : t === current));
        if (from >= 0) givenRef.current = where === "next" ? [...given.slice(0, from + 1), ...add, ...given.slice(from + 1)] : [...given, ...add];
      }
      return ok;
    },
    [playFrom],
  );
  const replaceUpcoming = useCallback(async (tracks: ShellTrack[]): Promise<boolean> => {
    const q = queueRef.current;
    const at = queueIndexRef.current;
    if (at < 0 || at >= q.length) return false;
    const upcoming = tracks.filter((t) => t.subsonicTrackId);
    const ok = await requestSetUpcoming(upcoming.map(toQueueItem).filter((x): x is PlayQueueItem => !!x));
    if (ok && queueIndexRef.current === at && queueRef.current === q) {
      setQueue([...q.slice(0, at + 1), ...upcoming]);
      // the list's own order (what shuffle-off puts back) keeps what stays in its place and takes
      // what is new at the end, so a song added this way survives the switch
      const current = q[at];
      const given = givenRef.current;
      const from = given.findIndex((t) => (current.subsonicTrackId ? t.subsonicTrackId === current.subsonicTrackId : t === current));
      if (from >= 0) {
        const staying = new Set(upcoming.map((t) => t.subsonicTrackId));
        const kept = given.slice(from + 1).filter((t) => staying.has(t.subsonicTrackId));
        const keptIds = new Set(kept.map((t) => t.subsonicTrackId));
        givenRef.current = [...given.slice(0, from + 1), ...kept, ...upcoming.filter((t) => !keptIds.has(t.subsonicTrackId))];
      }
    }
    return ok;
  }, []);
  const playNext = useCallback((tracks: ShellTrack[]) => insertUpcoming(tracks, "next"), [insertUpcoming]);
  const addToQueue = useCallback((tracks: ShellTrack[]) => insertUpcoming(tracks, "last"), [insertUpcoming]);
  const cycleRepeat = useCallback(() => {
    // Compute the next mode from the ref and fire the side effect OUTSIDE the
    // updater — state updaters must be pure (StrictMode double-invokes them in
    // dev, which was double-POSTing /api/playback/repeat).
    const r = repeatRef.current;
    const nr: RepeatMode = r === "off" ? "all" : r === "all" ? "one" : "off";
    setRepeat(nr);
    void requestSetRepeat(nr);
  }, []);
  const setRepeatMode = useCallback((mode: RepeatMode) => {
    if (repeatRef.current === mode) return;
    repeatRef.current = mode;
    setRepeat(mode);
    void requestSetRepeat(mode);
  }, []);
  // Throttled (not debounced): a drag fires this on every pointer move, and
  // volume should audibly track the thumb, not just jump once at drag-end.
  // Leading + trailing — first move sends immediately, a burst inside the
  // window collapses to one trailing send carrying the latest value.
  const VOLUME_THROTTLE_MS = 80;
  const setVolume = useCallback((level: number) => {
    const clamped = Math.min(1, Math.max(0, level));
    setVolumeState(clamped);
    if (volumeTrailingTimer.current) {
      clearTimeout(volumeTrailingTimer.current);
      volumeTrailingTimer.current = null;
    }
    const elapsed = Date.now() - lastVolumeSendRef.current;
    if (elapsed >= VOLUME_THROTTLE_MS) {
      lastVolumeSendRef.current = Date.now();
      void requestSetVolume(clamped);
    } else {
      volumeTrailingTimer.current = setTimeout(() => {
        volumeTrailingTimer.current = null;
        lastVolumeSendRef.current = Date.now();
        void requestSetVolume(clamped);
      }, VOLUME_THROTTLE_MS - elapsed);
    }
  }, []);
  const togglePlay = useCallback(() => {
    // Nothing queued yet but a source is open → start it from the top.
    if (queueIndexRef.current < 0) {
      const src = sourceRef.current;
      if (src && src.tracks.length) playFrom(src.tracks, 0);
      return;
    }
    if (playingRef.current) {
      setPlaying(false); // optimistic
      void requestPause();
    } else {
      setPlaying(true);
      announceAudioLane("hub");
      void requestResume();
    }
  }, [playFrom]);
  // Latest togglePlay for the keyboard handler, so its listener mounts once
  // ([] deps) yet always calls the current callback.
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  // Spacebar = play/pause while the workbench is open (Spotify-style, bf7224e3),
  // except where Space belongs to the focus (lib/keys.ts, BUG-603): a field being
  // typed in, an open menu, or a button or link the KEYBOARD brought the focus to,
  // which is how a Mac and a screen reader press it. A button that only kept the
  // focus after a click, and the draggable rows dnd-kit marks role="button", still
  // yield to play/pause. (dnd-kit's keyboard sensor stays removed, see `sensors`.)
  // Still ignored on a modifier (leaves OS shortcuts alone), on auto-repeat, and
  // when nothing is queued/open (so Space can still scroll a long page).
  useEffect(() => {
    watchFocusArrival();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (spaceIsTheFocus(e.target)) return;
      const canToggle =
        queueIndexRef.current >= 0 ||
        (sourceRef.current?.tracks.length ?? 0) > 0;
      if (!canToggle) return;
      e.preventDefault();
      togglePlayRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const selectAlbum = useCallback((a: Source | null) => {
    setSource(a);
    if (a) setRailOpen(true);
  }, []);
  /** Open a freshly-generated mixtape in the rail — auto-OPEN, never
   *  auto-PLAY. Nothing here touches queue/playback state; the listener
   *  presses the rail's own Play (or a track row) to actually hear it. */
  const selectMixtape = useCallback(
    (
      input: Pick<SourceMixtape, "name" | "description" | "art" | "tracks"> &
        Partial<Pick<SourceMixtape, "doorKey">>
    ) => {
      setSource({ kind: "mixtape", saved: false, savedPlaylistId: null, doorKey: null, ...input });
      setRailOpen(true);
    },
    []
  );
  /** Stamp the open mixtape source as saved once /api/mixtape/save succeeds,
   *  so the rail can swap the Save button for a "Saved" state without a
   *  full re-fetch. No-ops if the rail has since moved to a different source. */
  const markMixtapeSaved = useCallback((playlistId: string) => {
    setSource((prev) =>
      prev && prev.kind === "mixtape" ? { ...prev, saved: true, savedPlaylistId: playlistId } : prev
    );
  }, []);
  const selectAlbumBySlug = useCallback(
    async (slug: string) => {
      // Picking an album is "going where you clicked" — drop any open overlay.
      setImmersiveSlug(null);
      setRailOpen(true);
      setSourceLoading(true);
      try {
        const res = await fetch(`/api/album/${encodeURIComponent(slug)}/tracks`);
        if (!res.ok) {
          showToast("Couldn't load that album");
          return;
        }
        const a = (await res.json()) as Omit<SourceAlbum, "kind">;
        setSource({ kind: "album", ...a });
      } catch {
        showToast("Couldn't load that album");
      } finally {
        setSourceLoading(false);
      }
    },
    [showToast]
  );
  const selectAlbumByGroupKey = useCallback(
    async (
      groupKey: string,
      optimistic?: {
        title: string;
        artist: string;
        coverUrl: string | null;
        /** The exact URL (usually an image ladder size) the clicked card's <img>
         *  is currently showing — decoded + cached, paints with zero network. */
        paintedCoverUrl?: string | null;
        coverOverrideUrl?: string | null;
        dominantColor: string | null;
      }
    ) => {
      setImmersiveSlug(null);
      setRailOpen(true);
      setSourceLoading(true);
      // Instant paint from data the caller already has (the clicked grid card) —
      // same cover/title/artist already on screen, no network wait. The real
      // fetch below still runs and replaces this with the canonical tracklist.
      if (optimistic) {
        setSource({
          kind: "album",
          title: optimistic.title,
          artist: optimistic.artist,
          slug: undefined,
          coverUrl: optimistic.coverUrl,
          coverSmallUrl: optimistic.paintedCoverUrl ?? optimistic.coverUrl,
          coverOverrideUrl: optimistic.coverOverrideUrl ?? null,
          dominantColor: optimistic.dominantColor,
          manualMatch: false,
          groupKey,
          tracks: [],
        });
      }
      type AlbumSourcePayload = {
        title: string;
        artist: string;
        slug: string | null;
        artistSlug: string | null;
        artistGroupKey: string | null;
        coverUrl: string | null;
        coverOverrideUrl: string | null;
        dominantColor: string | null;
        year: number | null;
        label: string | null;
        genre: string | null;
        manualMatch: boolean;
        tracks: ShellTrack[];
      };
      // Stale-while-revalidate: paint the cached tracklist instantly, then refresh
      // from the cloud in the background. Cache is derived/disposable — the fresh
      // fetch always wins; offline keeps the last-seen tracklist.
      const { ok } = await swrRead<AlbumSourcePayload>(
        `lib-album:${toBase64Url(groupKey)}`,
        async () => {
          const res = await fetch(
            `/api/sync/library/album/${toBase64Url(groupKey)}/tracks`,
            { credentials: "include" }
          );
          if (!res.ok) throw new Error(`album source ${res.status}`);
          return (await res.json()) as AlbumSourcePayload;
        },
        (a, src) => {
          setSource({
            kind: "album",
            title: a.title,
            artist: a.artist,
            // null slug (unmatched) → undefined so the rail's `!source.slug`
            // checks (Album-info disabled, "Find album" shown) read correctly.
            slug: a.slug ?? undefined,
            artistSlug: a.artistSlug ?? undefined,
            artistGroupKey: a.artistGroupKey ?? undefined,
            coverUrl: a.coverUrl,
            coverSmallUrl: optimistic?.paintedCoverUrl ?? optimistic?.coverUrl ?? null,
            coverOverrideUrl: a.coverOverrideUrl,
            dominantColor: a.dominantColor,
            year: a.year,
            label: a.label,
            genre: a.genre,
            manualMatch: a.manualMatch,
            groupKey,
            tracks: a.tracks,
          });
          if (src === "cache") setSourceLoading(false); // instant paint
        }
      );
      setSourceLoading(false);
      if (!ok) showToast("Couldn't load that album");
    },
    [showToast]
  );

  // Albums whose tracklist we've already warmed this session (hover prefetch),
  // so sweeping across the grid doesn't refire the same fetch.
  const prefetchedAlbums = useRef(new Set<string>());
  const prefetchAlbumByGroupKey = useCallback((groupKey: string, coverUrl?: string | null) => {
    if (!groupKey || prefetchedAlbums.current.has(groupKey)) return;
    prefetchedAlbums.current.add(groupKey);
    // Warm the raw cover URL the rail will paint — the grid shows the optimizer's
    // variant, so without this the click still pays a fresh image fetch.
    if (coverUrl && typeof window !== "undefined") {
      const img = new window.Image();
      img.src = coverUrl;
    }
    // Warm the SAME cache key selectAlbumByGroupKey reads — no rail state touched,
    // so a subsequent click is a cache hit (instant paint) instead of a fetch.
    void swrRead(
      `lib-album:${toBase64Url(groupKey)}`,
      async () => {
        const res = await fetch(`/api/sync/library/album/${toBase64Url(groupKey)}/tracks`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`album source ${res.status}`);
        return (await res.json()) as unknown;
      },
      () => {} // warm cache only — nothing to paint
    );
  }, []);

  // Play a whole library album straight from a card's hover play button. Reuses
  // the EXACT lib-album cache the grid warms on hover (see prefetch above), so a
  // cache-hot album starts instantly. Plays once on the first data and ignores
  // the background revalidate, so it doesn't restart when the fresh copy lands.
  const playAlbumByGroupKey = useCallback(
    async (groupKey: string) => {
      if (!groupKey) return;
      let started = false;
      const { ok } = await swrRead<{ tracks: ShellTrack[] }>(
        `lib-album:${toBase64Url(groupKey)}`,
        async () => {
          const res = await fetch(
            `/api/sync/library/album/${toBase64Url(groupKey)}/tracks`,
            { credentials: "include" }
          );
          if (!res.ok) throw new Error(`album source ${res.status}`);
          return (await res.json()) as { tracks: ShellTrack[] };
        },
        (a) => {
          if (!started && a.tracks.length) {
            started = true;
            playFrom(a.tracks, 0); // toasts itself if nothing's playable on this Mac
          }
        }
      );
      if (!ok) showToast("Couldn't load that album");
    },
    [playFrom, showToast]
  );

  const selectArtistBySlug = useCallback(
    async (slug: string) => {
      setImmersiveSlug(null);
      setRailOpen(true);
      setSourceLoading(true);
      try {
        const res = await fetch(`/api/artist/${encodeURIComponent(slug)}/source`);
        if (!res.ok) {
          showToast("Couldn't load that artist");
          return;
        }
        const a = (await res.json()) as Omit<SourceArtist, "kind">;
        setSource({ kind: "artist", ...a });
      } catch {
        showToast("Couldn't load that artist");
      } finally {
        setSourceLoading(false);
      }
    },
    [showToast]
  );
  // B1 — library artist cards open the user's OWNED albums/tracks for that
  // artist (the inherited source via group key), never the full catalog
  // discography. groupKey is `catalog-artist:<id>` or `inherited-artist:<x>`.
  const selectArtistByGroupKey = useCallback(
    async (
      groupKey: string,
      optimistic?: {
        name: string;
        imageUrl: string | null;
        imageIsOverride?: boolean;
        localArtistPhotoTrackId?: string | null;
        albumCount?: number;
        songCount?: number;
      }
    ) => {
      setImmersiveSlug(null);
      setRailOpen(true);
      setSourceLoading(true);
      // Instant header from the clicked card. Keep albums when re-opening the
      // same artist; Popular songs wait for the ranked fresh payload (never
      // paint a stale order that then re-ranks). Seed album/song counts + the
      // local photo anchor from the card so the hero never jumps or flickers
      // waiting on Popular tracks.
      if (optimistic) {
        setSource((prev) => {
          const same =
            prev?.kind === "artist" && prev.groupKey === groupKey;
          return {
            kind: "artist",
            slug: same ? prev.slug : "",
            name: optimistic.name,
            imageUrl: optimistic.imageUrl,
            imageIsOverride: optimistic.imageIsOverride ?? false,
            localArtistPhotoTrackId:
              optimistic.localArtistPhotoTrackId ??
              (same ? prev.localArtistPhotoTrackId : null),
            groupKey,
            tracks: [],
            albums: same ? prev.albums : [],
            trackTotal: same ? prev.trackTotal : undefined,
            albumCount:
              optimistic.albumCount ??
              (same ? (prev.albumCount ?? prev.albums.length) : undefined),
            songCount:
              optimistic.songCount ?? (same ? prev.songCount : undefined),
          };
        });
      }
      // Albums/header may paint from cache; Popular songs wait for the ranked
      // fresh response so a stale cache order never flashes then re-ranks.
      let cachedArtist: Omit<SourceArtist, "kind"> | null = null;
      let gotFreshArtist = false;
      const applyArtistSource = (a: Omit<SourceArtist, "kind">, allowTracks: boolean) => {
        setSource((prev) => {
          const sameArtist =
            prev?.kind === "artist" && prev.groupKey === groupKey;
          const albumCount = a.albums.length;
          // Prefer a card-seeded library song count over the Popular teaser size
          // so "N songs" in the hero stays the full owned total.
          const songCount =
            (sameArtist && prev.kind === "artist" ? prev.songCount : undefined) ??
            a.songCount;
          // Keep the card/API photo anchor even while Popular tracks are held
          // back — otherwise desktop flashes catalog then swaps to artist.jpg.
          const localArtistPhotoTrackId =
            a.localArtistPhotoTrackId ??
            a.tracks[0]?.subsonicTrackId ??
            a.albums.find((al) => al.localCoverTrackId)?.localCoverTrackId ??
            (sameArtist && prev.kind === "artist"
              ? prev.localArtistPhotoTrackId
              : null) ??
            null;
          const imageIsOverride =
            a.imageIsOverride ??
            (sameArtist && prev.kind === "artist" ? prev.imageIsOverride : false);
          // Cache paint: albums/header + stable meta counts. Hold Popular rows
          // until ranked fresh — but keep trackTotal so Show-more math is ready.
          if (!allowTracks) {
            return {
              kind: "artist",
              ...a,
              groupKey,
              tracks: [],
              trackTotal: a.trackTotal ?? a.tracks.length,
              albumCount,
              songCount,
              localArtistPhotoTrackId,
              imageIsOverride,
            };
          }
          let tracks = a.tracks;
          // Keep an already-appended Popular tail when the fresh head matches
          // (avoids 20→5→20 flash when cache had the remainder).
          if (
            sameArtist &&
            prev.tracks.length > a.tracks.length
          ) {
            const headOk = a.tracks.every((t, i) => {
              const p = prev.tracks[i];
              return (
                (t.cassetteLocalId ?? t.subsonicTrackId ?? t.title) ===
                (p?.cassetteLocalId ?? p?.subsonicTrackId ?? p?.title)
              );
            });
            if (headOk) tracks = prev.tracks;
          }
          return {
            kind: "artist",
            ...a,
            groupKey,
            tracks,
            albumCount,
            songCount,
            localArtistPhotoTrackId,
            imageIsOverride,
          };
        });
        if (!allowTracks) return;
        const total = a.trackTotal ?? a.tracks.length;
        if (total > a.tracks.length && !artistMoreFetches.current.has(groupKey)) {
          artistMoreFetches.current.add(groupKey);
          void fetch(
            `/api/sync/library/artist/${toBase64Url(groupKey)}/songs?offset=${a.tracks.length}&limit=${total - a.tracks.length}`,
            { credentials: "include" }
          )
            .then((r) => (r.ok ? r.json() : null))
            .then((page: { tracks: ShellTrack[]; trackTotal: number } | null) => {
              if (!page?.tracks?.length) return;
              setSource((prev) => {
                if (prev?.kind !== "artist" || prev.groupKey !== groupKey) return prev;
                const seen = new Set(
                  prev.tracks.map((t) => t.cassetteLocalId ?? t.subsonicTrackId ?? t.title)
                );
                const extra = page.tracks.filter((t) => {
                  const k = t.cassetteLocalId ?? t.subsonicTrackId ?? t.title;
                  if (seen.has(k)) return false;
                  seen.add(k);
                  return true;
                });
                if (!extra.length) return prev;
                return {
                  ...prev,
                  tracks: [...prev.tracks, ...extra],
                  trackTotal: page.trackTotal,
                };
              });
            })
            .catch(() => {})
            .finally(() => {
              artistMoreFetches.current.delete(groupKey);
            });
        }
      };
      const { ok } = await swrRead<Omit<SourceArtist, "kind">>(
        `lib-artist:${toBase64Url(groupKey)}`,
        async () => {
          const res = await fetch(
            `/api/sync/library/artist/${toBase64Url(groupKey)}/source`,
            { credentials: "include" }
          );
          if (!res.ok) throw new Error(`artist source ${res.status}`);
          return (await res.json()) as Omit<SourceArtist, "kind">;
        },
        (a, src) => {
          if (src === "cache") {
            cachedArtist = a;
            // Instant albums/header; hold Popular until ranked fresh lands.
            applyArtistSource(a, false);
            return;
          }
          gotFreshArtist = true;
          applyArtistSource(a, true);
          setSourceLoading(false);
        }
      );
      // Offline: fresh never arrived — show cached Popular as best available.
      if (ok && !gotFreshArtist && cachedArtist) {
        applyArtistSource(cachedArtist, true);
      }
      setSourceLoading(false);
      if (!ok) showToast("Couldn't load that artist");
    },
    [showToast]
  );

  // Artists whose source we've already warmed this session (hover prefetch),
  // so sweeping across the grid doesn't refire the same fetch.
  const prefetchedArtists = useRef(new Set<string>());
  // In-flight Popular "songs 6–20" fetches — cache + fresh onData both fire.
  const artistMoreFetches = useRef(new Set<string>());
  const prefetchArtistByGroupKey = useCallback((groupKey: string) => {
    if (!groupKey || prefetchedArtists.current.has(groupKey)) return;
    prefetchedArtists.current.add(groupKey);
    // Warm the SAME cache key selectArtistByGroupKey reads — no rail state touched,
    // so a subsequent click is a cache hit (instant paint) instead of a fetch.
    void swrRead(
      `lib-artist:${toBase64Url(groupKey)}`,
      async () => {
        const res = await fetch(`/api/sync/library/artist/${toBase64Url(groupKey)}/source`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`artist source ${res.status}`);
        return (await res.json()) as unknown;
      },
      () => {} // warm cache only — nothing to paint
    );
  }, []);
  const openBuild = useCallback((p: OpenPlaylist | "upnext") => {
    setRailOpen(true);
    setBuildOpen(true);
    if (p === "upnext") {
      setActiveBuild("upnext");
      return;
    }
    setOpenPlaylists((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, p]));
    setActiveBuild(p.id);
  }, []);
  const closeBuild = useCallback(
    (id: string) =>
      setOpenPlaylists((ps) => {
        setActiveBuild((a) => (a === id ? "upnext" : a));
        return ps.filter((p) => p.id !== id);
      }),
    []
  );
  const closeBuildRegion = useCallback(() => setBuildOpen(false), []);
  const openImmersive = useCallback(
    (slug: string, kind: ImmersiveKind = "album", cover: ImmersiveCover | null = null) => {
      setImmersiveSlug(slug);
      setImmersiveKind(kind);
      setImmersiveCover(cover);
    },
    [],
  );
  const closeImmersive = useCallback(() => {
    setImmersiveSlug(null);
    setImmersiveCover(null);
  }, []);
  const openLab = useCallback(() => setLabOpen(true), []);
  const closeLab = useCallback(() => setLabOpen(false), []);

  // Persist a track add to a playlist via the op-based endpoint. Guards the
  // 32-hex local id first so a bad id is a toast, not a 400. Several tracks (a
  // whole record) go as one request, one op each, in their order; tracks with no
  // stable id are left out and said so.
  const addTracksToPlaylist = useCallback(
    async (playlistId: string, playlistName: string, tracks: ShellTrack[], opts: { already?: number } = {}): Promise<boolean> => {
      const good = tracks.filter((t) => t.cassetteLocalId && LOCAL_ID_RE.test(t.cassetteLocalId));
      if (!good.length) {
        showToast(tracks.length > 1 ? "Can't add: these tracks have no stable id yet" : "Can't add — this track has no stable id yet");
        return false;
      }
      // Optimistic (Job 3): flash the playlist immediately as instant feedback,
      // then persist. The cloud stays the write-truth — a failure surfaces as an
      // error toast (there is no local playlist mirror to roll back; the op just
      // didn't land).
      flashPlaylist(playlistId);
      const now = Date.now();
      try {
        const res = await fetch(`/api/sync/playlists/${playlistId}/ops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ops: good.map((track, i) => ({
              op: "add",
              item_id: generateUuid(),
              cassette_local_id: track.cassetteLocalId,
              mbid: track.mbid ?? null,
              position: now + i,
              added_at: new Date(now).toISOString(),
              added_by_device: "web",
            })),
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            error?: string;
          };
          showToast(body.message ?? body.error ?? "Couldn't add to playlist", {
            variant: "error",
          });
          return false;
        }
        const skipped = tracks.length - good.length;
        const already = opts.already ?? 0;
        const added = good.length === 1 ? (already ? `Added 1 song to ${playlistName}` : `Added to ${playlistName}`) : `Added ${good.length} songs to ${playlistName}`;
        const there = already ? `. ${already === 1 ? "1 was" : `${already} were`} already on it` : "";
        showToast(`${added}${there}${skipped ? ` (${skipped} not in your library yet)` : ""}`);
        return true;
      } catch {
        showToast("Network error — try again", { variant: "error" });
        return false;
      }
    },
    [showToast, flashPlaylist]
  );
  const addTrackToPlaylist = useCallback(
    (playlistId: string, playlistName: string, track: ShellTrack) =>
      addTracksToPlaylist(playlistId, playlistName, [track]),
    [addTracksToPlaylist]
  );

  // External drag-to-insert: an open playlist page registers a drop target
  // keyed by its id; while a rail track hovers it, we track the slot so the
  // page can draw the insertion line. This lives OUTSIDE the page's own reorder
  // DndContext, so reordering is untouched — the page just receives the drop.
  const playlistDropTargets = useRef<Map<string, PlaylistDropTarget>>(new Map());
  // Which target currently shows an insertion line, so we can hide it the instant
  // the pointer leaves that page. Imperative (a ref, never React state) — this is
  // touched on every pointer move and must not trigger a render.
  const activePreviewIdRef = useRef<string | null>(null);
  const registerPlaylistDropTarget = useCallback(
    (playlistId: string, target: PlaylistDropTarget) => {
      playlistDropTargets.current.set(playlistId, target);
      return () => {
        if (playlistDropTargets.current.get(playlistId) === target) {
          playlistDropTargets.current.delete(playlistId);
        }
      };
    },
    []
  );
  const clearInsertPreview = useCallback(() => {
    const id = activePreviewIdRef.current;
    if (id) {
      playlistDropTargets.current.get(id)?.setPreview(null);
      activePreviewIdRef.current = null;
    }
  }, []);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const track = e.active?.data?.current?.track as ShellTrack | undefined;
    setDraggingTrack(track ?? null);
  }, []);
  const onDragCancel = useCallback(() => {
    setDraggingTrack(null);
    clearInsertPreview();
  }, [clearInsertPreview]);

  // Fires on EVERY pointer move (onDragOver only fired on region crossings, which
  // left the line lagging the cursor). Positions the insertion line straight
  // through the DOM via the page's setPreview — no React state, no re-render.
  const onDragMove = useCallback((e: DragMoveEvent) => {
    const overId = e.over?.id != null ? String(e.over.id) : null;
    const pid =
      overId && overId.startsWith("plinsert:") ? overId.slice("plinsert:".length) : null;
    if (activePreviewIdRef.current && activePreviewIdRef.current !== pid) {
      playlistDropTargets.current.get(activePreviewIdRef.current)?.setPreview(null);
      activePreviewIdRef.current = null;
    }
    if (!pid) return;
    const target = playlistDropTargets.current.get(pid);
    if (!target) return;
    const y = pointerYFromDrag(e);
    if (y == null) return;
    target.setPreview(y);
    activePreviewIdRef.current = pid;
  }, []);

  // Drag DROP routing. Droppable ids are namespaced so the rail build target
  // and a same-named sidebar playlist can't collide:
  //   build:upnext   → Up Next queue
  //   build:<id>     → the active rail playlist tab
  //   nav:<id>       → a left-nav playlist row
  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDraggingTrack(null);
      const track = e.active?.data?.current?.track as ShellTrack | undefined;
      const overId = e.over?.id != null ? String(e.over.id) : null;
      // Dropped onto an open playlist page: land at the slot the line is showing.
      // onDrop reads the page's current slot, so call it BEFORE clearing. The page
      // owns the geometry + the write; we forward the track.
      if (track && overId && overId.startsWith("plinsert:")) {
        playlistDropTargets.current.get(overId.slice("plinsert:".length))?.onDrop(track);
      }
      clearInsertPreview();
      if (!track || !overId) return;
      if (overId.startsWith("plinsert:")) return;
      if (overId === "build:upnext") {
        enqueue(track);
        showToast("Added to Up Next");
        return;
      }
      let playlistId: string | null = null;
      if (overId.startsWith("build:")) playlistId = overId.slice("build:".length);
      else if (overId.startsWith("nav:")) playlistId = overId.slice("nav:".length);
      if (!playlistId) return;
      const pl = [...availablePlaylistsRef.current, ...openPlaylists].find(
        (p) => p.id === playlistId
      );
      void addTrackToPlaylist(playlistId, pl?.name ?? "playlist", track);
    },
    [openPlaylists, addTrackToPlaylist, enqueue, showToast, clearInsertPreview]
  );

  const value: ShellState = {
    addTracksToPlaylist,
    nowPlaying,
    upNext,
    play,
    playFrom,
    enqueue,
    playNext,
    addToQueue,
    replaceUpcoming,
    removeFromQueue,
    next,
    prev,
    shuffle,
    repeat,
    toggleShuffle,
    cycleRepeat,
    setRepeatMode,
    volume,
    setVolume,
    playing,
    togglePlay,
    positionSeconds,
    durationSeconds,
    currentTrackId,
    hubReachable,
    seek,
    source,
    selectAlbum,
    selectMixtape,
    markMixtapeSaved,
    selectAlbumBySlug,
    selectAlbumByGroupKey,
    prefetchAlbumByGroupKey,
    playAlbumByGroupKey,
    selectArtistBySlug,
    selectArtistByGroupKey,
    prefetchArtistByGroupKey,
    sourceLoading,
    openPlaylists,
    availablePlaylists,
    setAvailablePlaylists,
    activeBuild,
    openBuild,
    setActiveBuild,
    closeBuild,
    buildOpen,
    closeBuildRegion,
    railOpen,
    setRailOpen,
    immersiveSlug,
    immersiveKind,
    immersiveCover,
    openImmersive,
    closeImmersive,
    labOpen,
    openLab,
    closeLab,
    toast,
    showToast,
    dragging: draggingTrack != null,
    flashPlaylistId,
    registerPlaylistDropTarget,
    optimisticallyRemoved,
    removeOptimistically,
    restoreOptimistically,
    refreshLibrary,
    libraryAlbums,
    libraryArtists,
    libraryLoaded,
    libraryUnavailable,
    isBetaTester,
  };

  return (
    <Ctx.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {draggingTrack ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                maxWidth: 280,
                padding: "8px 14px",
                borderRadius: "var(--cs-radius-md)",
                background: "var(--cs-ink)",
                color: "var(--cs-bg)",
                fontFamily: "var(--cs-font-serif)",
                fontSize: "var(--cs-text-body)",
                fontWeight: 500,
                boxShadow: "var(--cs-shadow-lg)",
                cursor: "grabbing",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {draggingTrack.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Ctx.Provider>
  );
}

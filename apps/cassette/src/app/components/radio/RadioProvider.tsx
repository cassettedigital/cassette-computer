"use client";

/**
 * RadioProvider — the web's radio lane. One <audio> element for the whole app,
 * mounted at the root (providers.tsx) so a station keeps playing while the
 * person moves between Discover, Search and Library.
 *
 * Rules kept (docs/reference/CASSETTE_RADIO.md):
 *   • Playback starts from a click. Nothing autoplays.
 *   • Live only: no buffering past what playback needs, no recording, no seek.
 *   • One sound at a time: starting radio announces itself on the audio-lane
 *     bus; the hub transport and the preview booth go quiet. When either of
 *     them starts, this lane stops itself.
 *   • Metadata is polled ONLY while a station with an adapter is playing, on a
 *     slow clock, through our own route (which caches upstream a few seconds).
 *   • Media keys / lock screen through the browser's Media Session.
 *   • The station list is the cloud's catalog (GET /api/radio/catalog), the one the phones read, asked for
 *     once per page and only on a page with a way to tune in (useRadio). The registry it is made from
 *     (config/radio) stays on the website's server, with its notes on each station's clearance and ads, and
 *     never reaches a browser or the Mac app's screens.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RadioCatalog, RadioCatalogStation, RadioNowPlaying } from "@/lib/radio/types";
import { announceAudioLane, onOtherAudioLane } from "@/lib/audio-lane";
import { inPanelFrame, type PanelHears, type PanelSays } from "@/lib/app-surface";
import { useNoteNowPlaying } from "@/lib/diagnostics/now-playing";

export type RadioStatus = "idle" | "connecting" | "playing" | "error";

/** A station as the radio plays and shows it: the catalog's own entry. */
export type RadioStation = RadioCatalogStation;

type RadioCtx = {
  station: RadioStation | null;
  status: RadioStatus;
  nowPlaying: RadioNowPlaying | null;
  /** Tune to a station (by slug). Replaces whatever was playing. */
  play: (slug: string) => void;
  /** Stop and drop the connection. */
  stop: () => void;
  /** Tune in, or stop if this station is the one playing. */
  toggle: (slug: string) => void;
  isCurrent: (slug: string) => boolean;
  /** Slugs the signed-in person has saved — fetched ONCE per page, shared by
   *  every Save key. Empty when signed out or not loaded yet. */
  saved: ReadonlySet<string>;
  savedLoaded: boolean;
  /** The list came back as a signed-in person's own, so `saved` is theirs rather than a stand-in. */
  savedKnown: boolean;
  /** Optimistic local update after a Save/Saved toggle. */
  setSavedLocal: (slug: string, saved: boolean) => void;
  /**
   * Save a station, or take it back: the one save, the same follow the phones and the website write
   * (/api/follows, type radio_station). `saved` flips at once and flips back if the cloud says no.
   * "signed-out" leaves the caller to decide (the website sends the person to sign in; the Mac app's
   * pairing has its own way back).
   */
  toggleSaved: (slug: string, want?: boolean) => Promise<"ok" | "signed-out" | "failed">;
  /** Ask for the station list now, so a press on Tune in plays at once (useRadio does this). */
  warm: () => void;
};

const Ctx = createContext<RadioCtx | null>(null);

/**
 * The station list, by slug: the cloud's catalog, asked for once per page (the edge keeps it an hour). In the
 * Mac app the request goes to the cloud like every /api call. A failed ask is asked again the next time.
 */
let catalogAsk: Promise<ReadonlyMap<string, RadioStation>> | null = null;
function stationList(): Promise<ReadonlyMap<string, RadioStation>> {
  catalogAsk ??= fetch("/api/radio/catalog")
    .then((r) => (r.ok ? (r.json() as Promise<RadioCatalog>) : Promise.reject(new Error(`radio catalog ${r.status}`))))
    .then((c) => new Map(c.stations.map((s) => [s.slug, s])))
    .catch((e: unknown) => {
      catalogAsk = null;
      throw e;
    });
  return catalogAsk;
}

const POLL_MS = 20_000;
/** How long a tune-in may sit at Connecting before it is a failed one (a live stream starts in a second or two). */
const CONNECT_MS = 12_000;

export function RadioProvider({ children }: { children: ReactNode }) {
  const [station, setStation] = useState<RadioStation | null>(null);
  const [status, setStatus] = useState<RadioStatus>("idle");
  const [nowPlaying, setNowPlaying] = useState<RadioNowPlaying | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [savedKnown, setSavedKnown] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // the station list once it has come (stationList), for a press on Tune in to play without waiting
  const listRef = useRef<ReadonlyMap<string, RadioStation> | null>(null);
  const warm = useCallback(() => {
    if (!listRef.current) stationList().then((l) => (listRef.current = l), () => {});
  }, []);
  /** A station by its slug: at once when the list is here, else once it has come (null when it isn't on the dial). */
  const lookUp = useCallback(
    (slug: string): RadioStation | null | Promise<RadioStation | null> =>
      listRef.current
        ? (listRef.current.get(slug) ?? null)
        : stationList().then(
            (l) => ((listRef.current = l), l.get(slug) ?? null),
            () => null,
          ),
    [],
  );

  // In the account window's side panel (a page beside Discover or Radio) the radio is the window's: one player,
  // never a second one in the panel. Tune in and Stop are sent up and played there, and what the window plays is
  // mirrored here, so the page's keys say Stop on the station that's on (lib/app-surface PanelSays, PanelHears).
  const panelRef = useRef(false);
  const toWindow = useCallback((said: PanelSays) => window.parent.postMessage(said, window.location.origin), []);
  useEffect(() => {
    if (!inPanelFrame()) return;
    panelRef.current = true;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const heard = e.data as PanelHears | null;
      if (heard?.cassettePanel !== "radio") return;
      const show = (next: RadioStation | null) => {
        // the window's radio just came on: anything playing in the page (a preview) goes quiet, one sound at a time
        if (next && next.slug !== stationRef.current?.slug) announceAudioLane("radio");
        setStation(next);
        setStatus(next ? heard.status : "idle");
        setNowPlaying(next ? heard.nowPlaying : null);
      };
      const next = heard.slug ? lookUp(heard.slug) : null;
      if (next instanceof Promise) void next.then(show);
      else show(next);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [lookUp]);

  // The saved set, once per page. Signed out → empty list, no error.
  useEffect(() => {
    let alive = true;
    fetch("/api/radio/saved", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { saved?: string[]; signedIn?: boolean } | null) => {
        if (!alive) return;
        if (d?.saved) setSaved(new Set(d.saved));
        setSavedKnown(!!d?.saved && d.signedIn === true);
        setSavedLoaded(true);
      })
      .catch(() => {
        if (alive) setSavedLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setSavedLocal = useCallback((slug: string, on: boolean) => {
    setSaved((prev) => {
      if (prev.has(slug) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);

  const savedRef = useRef(saved);
  savedRef.current = saved;
  const savingRef = useRef(new Set<string>());
  const toggleSaved = useCallback(
    async (slug: string, want?: boolean): Promise<"ok" | "signed-out" | "failed"> => {
      if (savingRef.current.has(slug)) return "ok"; // a second press while the first is on its way
      // `want` names the state the person sees (a caller that keeps its own list says it outright)
      const next = want ?? !savedRef.current.has(slug);
      savingRef.current.add(slug);
      setSavedLocal(slug, next);
      try {
        const res = await fetch("/api/follows", {
          method: next ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "radio_station", id: slug, source: "radio" }),
        });
        if (res.ok) {
          if (panelRef.current) toWindow({ cassettePanel: "saved", slug, on: next });
          return "ok";
        }
        setSavedLocal(slug, !next);
        return res.status === 401 ? "signed-out" : "failed";
      } catch {
        setSavedLocal(slug, !next);
        return "failed";
      } finally {
        savingRef.current.delete(slug);
      }
    },
    [setSavedLocal, toWindow],
  );
  const stationRef = useRef<RadioStation | null>(null);
  stationRef.current = station;
  const connectTimer = useRef<number | undefined>(undefined);

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = "none";
    a.addEventListener("playing", () => {
      window.clearTimeout(connectTimer.current);
      setStatus("playing");
    });
    a.addEventListener("waiting", () => setStatus((s) => (s === "idle" ? s : "connecting")));
    a.addEventListener("stalled", () => setStatus((s) => (s === "idle" ? s : "connecting")));
    a.addEventListener("error", () => setStatus((s) => (s === "idle" ? s : "error")));
    audioRef.current = a;
    return a;
  }, []);

  const stop = useCallback(() => {
    if (panelRef.current) {
      toWindow({ cassettePanel: "radio", play: null });
      setStatus("idle");
      setStation(null);
      setNowPlaying(null);
      return;
    }
    window.clearTimeout(connectTimer.current);
    const a = audioRef.current;
    if (a) {
      a.pause();
      // Drop the connection, not just the sound: a paused live stream would
      // otherwise keep pulling bytes the person is not hearing.
      a.removeAttribute("src");
      a.load();
    }
    setStatus("idle");
    setStation(null);
    setNowPlaying(null);
  }, [toWindow]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const tuneIn = useCallback(
    (next: RadioStation) => {
      if (panelRef.current) {
        toWindow({ cassettePanel: "radio", play: next.slug });
        setStation(next);
        setStatus("connecting");
        setNowPlaying(null);
        return;
      }
      const a = ensureAudio();
      announceAudioLane("radio");
      setStation(next);
      setStatus("connecting");
      setNowPlaying(null);
      a.src = next.streamUrl;
      a.load();
      a.play().catch(() => setStatus("error"));
      // A stream server that takes the connection and then never sends a byte leaves the browser waiting with no
      // error at all (SomaFM's, 2026-11-16): past CONNECT_MS still not playing, it is a failed tune-in, said as one.
      window.clearTimeout(connectTimer.current);
      connectTimer.current = window.setTimeout(() => {
        if (stationRef.current?.slug !== next.slug || !a.paused || a.readyState >= 3) return;
        a.pause();
        a.removeAttribute("src");
        a.load();
        setStatus("error");
      }, CONNECT_MS);
    },
    [ensureAudio, toWindow],
  );

  const play = useCallback(
    (slug: string) => {
      const next = lookUp(slug);
      // the list hadn't come yet (a page that never asked): tune in once it has
      if (next instanceof Promise) void next.then((s) => s && tuneIn(s));
      else if (next) tuneIn(next);
    },
    [lookUp, tuneIn],
  );

  const toggle = useCallback(
    (slug: string) => {
      if (stationRef.current?.slug === slug) stop();
      else play(slug);
    },
    [play, stop],
  );

  const isCurrent = useCallback((slug: string) => stationRef.current?.slug === slug, []);

  // Another lane started (owned music on the hub, or the preview booth): go quiet.
  useEffect(() => onOtherAudioLane("radio", () => stopRef.current()), []);

  // Let fixed overlays elsewhere (the help dock) know the radio dock is up.
  useEffect(() => {
    const el = document.documentElement;
    if (status === "idle") delete el.dataset.radio;
    else el.dataset.radio = "open";
    return () => {
      delete el.dataset.radio;
    };
  }, [status]);

  // Now-playing: only while playing, only for stations that declare an adapter.
  useEffect(() => {
    // in the panel the window polls, and says
    if (panelRef.current || !station || status !== "playing" || !station.hasNowPlaying) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/radio/now-playing?station=${encodeURIComponent(station.slug)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as RadioNowPlaying;
        if (alive && d?.station === station.slug) setNowPlaying(d);
      } catch {
        /* the dock simply keeps the last line */
      }
    };
    void tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [station, status]);

  // a note to the founder says which station was on and what it was playing (lib/diagnostics/now-playing)
  useNoteNowPlaying(
    "radio",
    station && status !== "idle"
      ? {
          state: status,
          station: station.name,
          title: nowPlaying?.track?.title ?? nowPlaying?.show?.name ?? null,
          artist: nowPlaying?.track?.artist ?? nowPlaying?.show?.host ?? null,
        }
      : null,
  );

  // Media Session: lock screen / media keys name the station and what's on.
  useEffect(() => {
    if (panelRef.current || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      if (!station || status === "idle") {
        ms.metadata = null;
        return;
      }
      const track = nowPlaying?.track;
      const show = nowPlaying?.show;
      const art = track?.coverUrl ?? show?.image ?? station.image;
      ms.metadata = new MediaMetadata({
        title: track ? track.title : show ? show.name : station.name,
        artist: track ? track.artist : (show?.host ?? station.sourceLabel),
        album: station.name,
        artwork: art ? [{ src: art, sizes: "512x512" }] : [],
      });
      ms.setActionHandler("pause", () => stopRef.current());
      ms.setActionHandler("stop", () => stopRef.current());
      ms.setActionHandler("play", () => {
        audioRef.current?.play().catch(() => {});
      });
    } catch {
      /* a browser without one of these actions */
    }
  }, [station, status, nowPlaying]);

  const value = useMemo<RadioCtx>(
    () => ({ station, status, nowPlaying, play, stop, toggle, isCurrent, saved, savedLoaded, savedKnown, setSavedLocal, toggleSaved, warm }),
    [station, status, nowPlaying, play, stop, toggle, isCurrent, saved, savedLoaded, savedKnown, setSavedLocal, toggleSaved, warm],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The radio, for anything with a way to tune in: asks for the station list as it mounts, so a press plays at once. */
export function useRadio(): RadioCtx {
  const v = useRadioNow();
  const { warm } = v;
  useEffect(() => warm(), [warm]);
  return v;
}

/** The radio as it is, for what only shows what's on (the dock): never asks for the station list. */
export function useRadioNow(): RadioCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRadio must be used inside RadioProvider");
  return v;
}

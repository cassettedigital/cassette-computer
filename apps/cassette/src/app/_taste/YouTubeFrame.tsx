"use client";

/*
 * Copied from src/app/components/YouTubeFullSongPlayer.tsx:3-24 (its compliance note, kept as written
 * there, punctuation aside):
 *
 * YouTubeFullSongPlayer: a docked, always-visible mini-player for full-song
 * previews, driven by messages to YouTube's own player frame (lib/youtube-embed).
 *
 * This is the COMPLIANT way to play a YouTube track: the video is visible on
 * screen, YouTube serves its own ads, and we never touch the audio stream. Do
 * NOT hide it, size it to 0, or keep audio going with the video removed: that
 * is the background-player pattern YouTube's policies forbid (and what got Musi
 * pulled). Playback starts from the user's click (a gesture), so audio is
 * allowed to autoplay.
 *
 * One player instance is created and reused: changing the `videoId` prop calls
 * loadVideoById() rather than remounting the iframe (which would reload the
 * hundreds-of-KB player bundle each time).
 *
 * Videos first, never a miss: `videoId` is the showcase (the official music
 * video when we have one) and `fallbackVideoIds` are the uploads to try next:
 * the Topic/Art Track audio, then the legacy match. When YouTube reports that
 * an upload can't play here (not found, embedding disabled, region or referer
 * blocked) the player steps to the next id inside the same iframe, so the
 * listener sees at most a beat of black, not a dead tile.
 *
 * What this copy drops: the shared component's header, footer and its own fixed card (the dock draws
 * those).
 * What it adds: a paused report, an "every id refused" report, and the current time for the progress line.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { YouTubeEmbed } from "@/lib/youtube-embed";

/** Open the connection to YouTube ahead of the first click. No player, no audio, none of YouTube's script on our
 *  page (lib/youtube-embed). Safe to call repeatedly. */
export function primeYouTube(): void {
  if (typeof document === "undefined" || document.getElementById("youtube-preconnect")) return;
  const link = document.createElement("link");
  link.id = "youtube-preconnect";
  link.rel = "preconnect";
  link.href = "https://www.youtube.com";
  document.head.appendChild(link);
}

export type FrameApi = { play(): void; pause(): void; time(): { elapsed: number; duration: number | null } };

export function YouTubeFrame({
  videoId,
  fallbackVideoIds,
  onPlaying,
  onPaused,
  onEnded,
  onUnplayable,
  apiRef,
  className,
  startSeconds,
}: {
  videoId: string;
  fallbackVideoIds: string[];
  /** Where in the song to begin, in whole seconds (a shared song's chosen moment). Applies to this
   *  videoId and its fallbacks only; the next song starts from its beginning. */
  startSeconds?: number | null;
  onPlaying(): void;
  onPaused(): void;
  onEnded(): void;
  /** The last fallback refused too: YouTube's codes for each upload tried, in order. */
  onUnplayable(codes: number[]): void;
  apiRef: MutableRefObject<FrameApi | null>;
  className?: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubeEmbed | null>(null);
  // YouTube's player has its methods only once it says it is ready; a song asked for before then waits
  // in wantedId and starts on ready (a quick Next or Previous right after the first press took the page down)
  const ready = useRef(false);
  const loadedId = useRef<string | null>(null);
  // The latest requested id, readable inside the async create callback, so a fast switch during the
  // first API load starts the right video (copied from YouTubeFullSongPlayer.tsx:136-140).
  const wantedId = useRef(videoId);
  const wantedStart = useRef(startSeconds ?? 0);
  // The remaining fallbacks for the current track, consumed front to back by onError.
  const remaining = useRef<string[]>([...fallbackVideoIds]);
  // YouTube's refusal codes for the current track's uploads so far
  const refusals = useRef<number[]>([]);
  const cbs = useRef({ onPlaying, onPaused, onEnded, onUnplayable });
  useEffect(() => {
    cbs.current = { onPlaying, onPaused, onEnded, onUnplayable };
  });

  // Create the player once, on a throwaway child node that holds YouTube's frame, so React never loses its own
  // node (copied from YouTubeFullSongPlayer.tsx:159-229).
  useEffect(() => {
    if (playerRef.current || !mountRef.current) return;
    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    mountRef.current.appendChild(host);
    const startId = wantedId.current;
    const startAt = wantedStart.current;
    playerRef.current = new YouTubeEmbed(host, {
      videoId: startId,
      // fs: YouTube's own fullscreen key (the frame carries allowfullscreen)
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 1, fs: 1, ...(startAt > 0 ? { start: startAt } : {}) },
      events: {
        onReady: (e) => {
          ready.current = true;
          // the song may have changed while the player was getting ready: start the one wanted now
          if (wantedId.current !== loadedId.current) {
            loadedId.current = wantedId.current;
            e.target.loadVideoById(wantedId.current, wantedStart.current || undefined);
          } else e.target.playVideo();
        },
        onStateChange: (e) => {
          if (e.data === 0) cbs.current.onEnded();
          else if (e.data === 1) cbs.current.onPlaying();
          else if (e.data === 2) cbs.current.onPaused();
        },
        onError: (e) => {
          // Step to the next upload for this track; with none left, say so, and what YouTube said.
          refusals.current.push(e.data);
          const next = remaining.current.shift();
          if (!next) {
            cbs.current.onUnplayable(refusals.current);
            return;
          }
          loadedId.current = next;
          e.target.loadVideoById(next, wantedStart.current || undefined);
        },
      },
    });
    loadedId.current = startId;
    const safe = <T,>(f: () => T, fallback: T): T => {
      try {
        return f();
      } catch {
        return fallback;
      }
    };
    apiRef.current = {
      play: () => safe(() => playerRef.current?.playVideo(), undefined),
      pause: () => safe(() => playerRef.current?.pauseVideo(), undefined),
      time: () => {
        const elapsed = safe(() => playerRef.current?.getCurrentTime(), undefined);
        const duration = safe(() => playerRef.current?.getDuration(), undefined);
        return {
          elapsed: typeof elapsed === "number" && Number.isFinite(elapsed) ? elapsed : 0,
          duration: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
        };
      },
    };
    return () => {
      apiRef.current = null;
      try {
        playerRef.current?.destroy();
      } catch {
        // destroy() can throw if the iframe was already torn down
      }
      // the holder goes too: left behind, the next player's holder stacked under it, a whole frame down,
      // so the video sat under the dock's keys and YouTube's own controls never came up (React runs this
      // twice on a dev server, so every preview there showed it)
      host.remove();
      playerRef.current = null;
      ready.current = false;
      loadedId.current = null;
    };
    // Intentionally create-once; swaps and the latest-id ref are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the video on the already-mounted player (copied from YouTubeFullSongPlayer.tsx:231-241).
  useEffect(() => {
    wantedId.current = videoId;
    wantedStart.current = startSeconds ?? 0;
    remaining.current = [...fallbackVideoIds];
    refusals.current = [];
    if (playerRef.current && ready.current && loadedId.current !== videoId) {
      playerRef.current.loadVideoById(videoId, wantedStart.current || undefined);
      loadedId.current = videoId;
    }
  }, [videoId, fallbackVideoIds, startSeconds]);

  return <div ref={mountRef} className={className} style={{ position: "absolute", inset: 0 }} />;
}

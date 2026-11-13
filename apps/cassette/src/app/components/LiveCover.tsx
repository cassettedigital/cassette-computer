"use client";

/**
 * A drawn cover that moves: a playlist's (by its id and name) or a made-for-you mix's (by its
 * spec). The still from /api/covers renders first, as any cover does (pass it as children);
 * behind it the drawing code and the faces this cover needs load, then a canvas drawing the
 * same cover fades in over the still, starting from the frame the still was taken at, and
 * runs on the cover's own loop.
 *
 *   - "visible": runs while the cover is on screen and at least `minLiveSize` wide (the
 *     playlist page header, which holds still once it shrinks to a chip on scroll).
 *   - "hover": runs while the pointer is over its card, on computers only, one card at a
 *     time; leaving fades back to the still, and the next hover starts from the still again.
 *
 * Never moves under the system's reduced-motion setting, pauses on a hidden tab, and draws
 * at most 30 frames a second, fewer for a family that takes long to draw on this machine.
 */

import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import {
  coverSpec,
  DEFAULT_COVER_SETTINGS,
  FAMILIES,
  stillPhase,
  type CoverSettings,
  type CoverSpec,
  type FamilyId,
} from "@/lib/cover-art/spec";
import { mixVersionOf, type MixCoverSpec } from "@/lib/cover-art/mixes/catalog";
import styles from "./LiveCover.module.css";

type Live = typeof import("@/lib/cover-art/browser");
let live: Promise<Live> | null = null;
const loadLive = () => (live ??= import("@/lib/cover-art/browser"));
type MixLive = typeof import("@/lib/cover-art/mixes/live");
let mixLive: Promise<MixLive> | null = null;
const loadMixLive = () => (mixLive ??= import("@/lib/cover-art/mixes/live"));

type Frame = (ctx: CanvasRenderingContext2D, S: number, ph: number) => void;
/** What a live cover draws: its loop in seconds, the frame its still was taken at, and how to get ready to draw it. */
type Art = { loop: number; still: number; prepare: () => Promise<Frame> };

function playlistArt(spec: CoverSpec): Art {
  return {
    loop: FAMILIES[spec.family].loop,
    still: stillPhase(spec.family),
    prepare: async () => {
      const L = await loadLive();
      await L.loadCoverFonts(spec);
      // a kit of its own for each live cover, so two covers never resize each other's scratch canvases
      const kit = L.createBrowserKit();
      return (ctx, S, ph) => L.drawCover(ctx, S, spec, ph, kit);
    },
  };
}

function mixArt(spec: MixCoverSpec): Art {
  const { loop, still } = mixVersionOf(spec);
  return {
    loop,
    still,
    prepare: async () => {
      const M = await loadMixLive();
      await M.prepareMix(spec);
      const kit = M.createBrowserKit();
      return (ctx, S, ph) => M.drawMixCover(ctx, S, spec, kit, ph);
    },
  };
}

/** Stops the hover cover that is moving now, so a new hover takes over. */
let stopHover: (() => void) | null = null;

/** 30 fps, unless drawing a frame takes more than 40% of the time between frames. */
const FRAME_MS = 1000 / 30;
const DRAW_SHARE = 0.4;

type Props = {
  mode: "visible" | "hover";
  /** The still, rendered the way the caller always has. */
  children: ReactNode;
  /** The Animated covers setting (cover plan step 3); on until it ships. */
  animate?: boolean;
  /** Below this width (CSS px) the cover holds still. */
  minLiveSize?: number;
  className?: string;
} & (
  | {
      /** The playlist's id and name: what its still was drawn from. */
      id: string;
      name: string;
      /** The family its owner chose in the cover picker, if they did (lib/covers/playlist drawnPickFamily). */
      family?: FamilyId | null;
      /** The account's cover settings; the defaults until step 3 ships, matching the still. */
      settings?: CoverSettings;
      mix?: never;
    }
  | { /** A made-for-you mix's cover, as its still was drawn. */ mix: MixCoverSpec; id?: never; name?: never; family?: never; settings?: never }
);

export function LiveCover({
  id,
  name,
  family,
  mix,
  mode,
  children,
  animate = true,
  settings = DEFAULT_COVER_SETTINGS,
  minLiveSize = 0,
  className,
}: Props) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // time into the loop, kept across a rename so the motion carries on where it was
  const clock = useRef(0);
  const { colors, titles, hue } = settings;
  const mixKey = mix?.cacheKey;
  const art = useMemo(
    () => (mix ? mixArt(mix) : playlistArt(coverSpec(id ?? "", name ?? "", { colors, titles, hue }, family))),
    // a mix's cacheKey stands for the whole spec
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mixKey, id, name, family, colors, titles, hue],
  );

  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    if (!animate || typeof window.matchMedia !== "function") {
      delete canvas.dataset.on;
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mode === "hover" && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    const { loop, still: from } = art;
    let disposed = false;
    let ready: Promise<Frame | null> | null = null;
    let raf = 0;
    let last = 0;
    let drawMs = 0;
    let onScreen = mode === "hover";
    let hovered = false;
    let wide = box.clientWidth >= minLiveSize;

    const wanted = () =>
      !reduce.matches && !document.hidden && (mode === "hover" ? hovered : onScreen && wide);

    // a cover that can't get ready (its faces didn't load) keeps its still, and tries again next time
    const prepare = () =>
      (ready ??= art
        .prepare()
        .then((frame) => (disposed ? null : frame))
        .catch(() => {
          ready = null;
          return null;
        }));

    const paint = (frame: Frame) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // grow the canvas to the cover's size (never shrink it: the header comes back to full size)
      const px = Math.round(box.clientWidth * Math.min(2, window.devicePixelRatio || 1));
      if (px > canvas.width) canvas.width = canvas.height = px;
      const S = canvas.width;
      if (!S) return;
      frame(ctx, S, (from + clock.current / 1000 / loop) % 1);
      canvas.dataset.on = "";
    };

    const run = (draw: Frame) => {
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        if (last && now - last < Math.max(FRAME_MS, drawMs / DRAW_SHARE) - 1) return;
        if (last) clock.current += Math.min(now - last, 250);
        last = now;
        const t = performance.now();
        paint(draw);
        const ms = performance.now() - t;
        drawMs = drawMs ? drawMs * 0.85 + ms * 0.15 : ms;
      };
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    const halt = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const update = () => {
      if (disposed) return;
      if (wanted()) {
        if (mode === "hover" && stopHover !== leave) {
          stopHover?.();
          stopHover = leave;
        }
        void prepare().then((draw) => {
          // a rename or unmount may have replaced this cover while its code and faces loaded
          if (draw && !disposed && !raf && wanted()) run(draw);
        });
        return;
      }
      halt();
      // back to the still when the setting asks for stillness or the hover ends; offscreen
      // or collapsed, the last frame stays up
      if (reduce.matches || mode === "hover") delete canvas.dataset.on;
      if (mode === "hover") clock.current = 0;
    };

    function leave() {
      hovered = false;
      if (stopHover === leave) stopHover = null;
      update();
    }

    const cleanups: (() => void)[] = [];
    const on = (t: EventTarget, type: string, fn: () => void) => {
      t.addEventListener(type, fn);
      cleanups.push(() => t.removeEventListener(type, fn));
    };
    on(reduce, "change", update);
    on(document, "visibilitychange", update);

    if (mode === "hover") {
      // the whole card answers the hover, not just the art (ArtHover's shared .cs-art-hover root)
      const scope = box.closest(".cs-art-hover") ?? box;
      on(scope, "pointerenter", () => {
        hovered = true;
        update();
      });
      on(scope, "pointerleave", leave);
      // fetch the drawing code while the page is idle, so the first hover starts promptly
      if (typeof window.requestIdleCallback === "function") {
        const idle = window.requestIdleCallback(() => void loadLive());
        cleanups.push(() => window.cancelIdleCallback(idle));
      } else {
        const timer = window.setTimeout(() => void loadLive(), 2000);
        cleanups.push(() => window.clearTimeout(timer));
      }
    } else {
      const io = new IntersectionObserver(([e]) => {
        onScreen = !!e?.isIntersecting;
        update();
      });
      io.observe(box);
      cleanups.push(() => io.disconnect());
      if (minLiveSize > 0) {
        const ro = new ResizeObserver(([e]) => {
          wide = (e?.contentRect.width ?? 0) >= minLiveSize;
          update();
        });
        ro.observe(box);
        cleanups.push(() => ro.disconnect());
      }
    }
    update();

    return () => {
      disposed = true;
      halt();
      if (stopHover === leave) stopHover = null;
      cleanups.forEach((fn) => fn());
    };
  }, [art, mode, animate, minLiveSize]);

  return (
    <span ref={boxRef} className={`${styles.box}${className ? ` ${className}` : ""}`}>
      {children}
      <canvas ref={canvasRef} className={styles.live} width={0} height={0} aria-hidden="true" />
    </span>
  );
}

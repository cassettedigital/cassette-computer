"use client";

/**
 * The web's one picture component (contract: docs/reference/CASSETTE_IMAGES.md; the desktop app runs
 * the same code). Handed an image reference and its frame, it lists every rung with its true width and
 * lets the browser pick the one that fits the frame at the screen's sharpness, and pick again when the
 * frame or the window changes. A plain <img>: never Vercel's resizer.
 *
 * The frame is either `frame` (a fixed box in CSS pixels, from which the width the picture is actually
 * drawn at is worked out, a wide photo cropped into a circle included) or `sizes` (as for any <img>,
 * for a fluid frame). `rung` asks for one size outright: a backdrop that is blurred anyway, or a viewer
 * that shows the picture at its own size (as large as the top rung).
 *
 * `original` is what to show when there is no reference (a picture the ladder cannot serve: a drawn
 * cover, a preview, another host) and the fallback when the ladder cannot answer (over its daily cap,
 * a picture it could not make), so a page never loses a picture to the ladder. Once both have failed,
 * nothing is drawn and `onError` tells the caller, which owns the empty state.
 */

import { useCallback, useRef, useState, type CSSProperties, type ImgHTMLAttributes, type SyntheticEvent } from "react";
import { aspectOf, imageSrcSet, imageUrl, type Fit, type ImageRef, type ImageRung } from "./images";

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes" | "onError">;

export type PictureProps = ImgProps & {
  image: ImageRef | null | undefined;
  original?: string | null;
  /** A fixed frame in CSS pixels: a number for a square, or its width and height. */
  frame?: number | { w: number; h: number };
  /** How the picture sits in a fixed frame: cropped to fill it (the default) or shown whole. */
  fit?: Fit;
  /** A fluid frame, as `sizes` on any <img> ("(max-width: 640px) 50vw, 200px"): the frame's width. */
  sizes?: string;
  /** The fluid frame is square (an artist circle), so a wide picture cropped into it is drawn wider than `sizes`. */
  square?: boolean;
  /** One rung and no choice: a backdrop blurred past any sharpness, or a viewer showing the picture at its own size. */
  rung?: ImageRung;
  /** Fill the nearest positioned box. */
  fill?: boolean;
  /** Above the fold: load at once, first. */
  priority?: boolean;
  onError?: () => void;
};

const FILL: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

/** The `src` for a browser that ignores srcset; every current one reads it, so this is never fetched. */
const PLAIN_RUNG: ImageRung = 480;

/** The width, in CSS pixels, a picture is drawn at inside a fixed frame. */
function drawnWidth(frame: number | { w: number; h: number }, image: ImageRef, fit: Fit): number {
  const { w, h } = typeof frame === "number" ? { w: frame, h: frame } : frame;
  const a = aspectOf(image);
  return Math.ceil(fit === "contain" ? Math.min(w, h * a) : Math.max(w, h * a));
}

/**
 * `sizes` for a wide picture cropped into a square frame: each entry's width times the picture's shape,
 * so a 3:2 photo in a 160px circle is picked for the 240px it is drawn at.
 */
function widerSizes(sizes: string, aspect: number): string {
  return sizes
    .split(",")
    .map((entry) => {
      const m = /^(.*?)(calc\(.*\)|[^\s()]+)$/.exec(entry.trim());
      if (!m || m[2] === "auto") return entry.trim();
      return `${m[1]}calc(${m[2]} * ${Math.round(aspect * 1000) / 1000})`;
    })
    .join(", ");
}

export function Picture({ image, original, frame, fit = "cover", sizes, square, rung, fill, priority, onError, onLoad, style, loading, decoding, ...img }: PictureProps) {
  const sources: Array<"ladder" | "original"> = [];
  if (image) sources.push("ladder");
  if (original) sources.push("original");
  const key = `${image?.src ?? ""}\n${original ?? ""}`;
  // Which source has failed, per picture: a frame reused for another record starts again at the ladder.
  const [failed, setFailed] = useState({ key, count: 0 });
  const count = failed.key === key ? failed.count : 0;
  const source = sources[count];

  // Once per source, however many ways its failure is heard (the mounting check and the error event can
  // both see it), so a caller that steps through its own list on `onError` never skips a step.
  const heard = useRef("");
  const fail = useCallback(() => {
    const id = `${key}\n${count}`;
    if (heard.current === id) return;
    heard.current = id;
    setFailed({ key, count: count + 1 });
    if (count + 1 >= sources.length) onError?.();
  }, [key, count, sources.length, onError]);

  // A picture that loaded or failed before the page came alive fires no event; read the state it is in.
  // No width can also be a drawing with no size of its own (an SVG preset), so decoding decides.
  const settle = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el || !el.complete || !el.currentSrc) return;
      const loaded = () => onLoad?.({ currentTarget: el, target: el } as unknown as SyntheticEvent<HTMLImageElement>);
      if (el.naturalWidth > 0) loaded();
      else el.decode().then(loaded, fail);
    },
    // Once per source: a new picture is a new element state to read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, source],
  );

  if (!source) return null;

  let src: string;
  let srcSet: string | undefined;
  let pick: string | undefined;
  if (source === "ladder" && image) {
    if (rung) {
      src = imageUrl(image, rung);
    } else {
      src = imageUrl(image, PLAIN_RUNG);
      srcSet = imageSrcSet(image);
      const a = aspectOf(image);
      if (frame !== undefined) pick = `${drawnWidth(frame, image, fit)}px`;
      else pick = sizes && square && fit === "cover" && a > 1 ? widerSizes(sizes, a) : sizes;
    }
  } else {
    src = original!;
  }

  // src goes last, after the browser has been told how to choose, so it never fetches the plain one first.
  return (
    <img
      key={source}
      ref={settle}
      {...img}
      loading={loading ?? (priority ? "eager" : "lazy")}
      decoding={decoding ?? "async"}
      fetchPriority={priority ? "high" : img.fetchPriority}
      style={fill ? { ...FILL, ...style } : style}
      onLoad={onLoad}
      onError={fail}
      sizes={pick}
      srcSet={srcSet}
      src={src}
    />
  );
}

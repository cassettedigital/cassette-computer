/**
 * The one hover-play (the founder, 2026-11-06: "This 'play button on hover for a playable asset' should be
 * universal when a click = play. It should appear in our desktop app, across our site"). A big round play
 * disc laid over the thing a click plays, in the middle of its art, hidden until that thing (the link or
 * button it sits in, or any [data-play-host]) is pointed at or focused. It is a picture of what the click
 * does, never a key of its own: aria-hidden, and it takes no pointer.
 *
 * Over art (the default) it is the desk tile disc's glass, a dark wash with a hairline ring and a light
 * glyph, over a light dimming of the art, so it reads on any cover, light or dark. `bare` is for a track
 * number (a numbered list puts it there rather than on the art): just the play triangle, no disc (the
 * founder, 2026-11-06: "instead of a big circle + inset play button, a triangular play button"), in the
 * page's accent, standing where the number starts (`align` "end" for a list whose numbers sit right). Over
 * art the disc is about three quarters of the art's height, at most 64 across; `size` fixes it (px), and
 * for `bare` it is the triangle's height.
 *
 * Only where a click plays: not on the row that is already playing (its own bars say so, and its click
 * pauses), and not where a click opens something (the desk's tiles, whose click shows the side view).
 * The host's box must be positioned (position: relative) for the disc to centre on it.
 */

import type { CSSProperties } from "react";
import { TransportGlyph } from "./Glyph";
import s from "./playover.module.css";

export function PlayOver({
  bare = false,
  size,
  align = "start",
  className,
}: {
  bare?: boolean;
  size?: number;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <span
      className={className ? `${s.over} ${className}` : s.over}
      data-bare={bare || undefined}
      data-align={bare ? align : undefined}
      style={size ? ({ "--over": `${size}px` } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {bare ? (
        // the triangle drawn tight to its own box, so it starts exactly where the number does
        <svg className={s.tri} viewBox="0 0 16 18" focusable="false">
          <path d="M1.5 1.9C1.5 1 2.5.4 3.3.9l11.6 7.2c.8.5.8 1.6 0 2.1L3.3 17.1c-.8.5-1.8-.1-1.8-1V1.9z" />
        </svg>
      ) : (
        <span className={s.face}>
          <TransportGlyph name="play" size={24} />
        </span>
      )}
    </span>
  );
}

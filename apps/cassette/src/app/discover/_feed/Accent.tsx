"use client";

/**
 * A record's colour for the part around it (the founder, 2026-11-18: "bring the album colors forward ... a bit of pop
 * flowing through the page's color"): read off its cover in the browser and set as --accent-c and --accent-ink, the
 * album page's own way (_taste/colour.ts). The top pick's title and a shelf's head word take it.
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { accentVars, useCoverAccent } from "@/app/_taste/colour";

export const Accent = forwardRef<HTMLDivElement, { cover: string | null | undefined; children: ReactNode } & Omit<HTMLAttributes<HTMLDivElement>, "style">>(
  function Accent({ cover, children, ...rest }, ref) {
    const accent = useCoverAccent(cover);
    return (
      <div ref={ref} {...rest} style={accentVars(accent)}>
        {children}
      </div>
    );
  },
);

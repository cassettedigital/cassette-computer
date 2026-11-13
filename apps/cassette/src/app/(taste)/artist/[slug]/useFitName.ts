"use client";

/**
 * The name, fitted to its column by measuring the display face: as big as the column allows up to the
 * size the CSS caps it at (--cap), and on two lines split at a space when one line would fall under the
 * floor. Never three lines, never a break inside a word. Runs on mount, when the fonts land and when the
 * column changes width. Before it runs, the CSS estimate (artist.module.css .name) stands in.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitName } from "../_lib/rules";

export function useFitName(
  nameRef: RefObject<HTMLHeadingElement | null>,
  measureRef: RefObject<HTMLSpanElement | null>,
  name: string,
): string[] {
  const [lines, setLines] = useState<string[]>([name]);
  const key = useRef(name);

  useLayoutEffect(() => {
    const el = nameRef.current;
    const measure = measureRef.current;
    if (!el || !measure) return;
    const run = () => {
      const fitW = el.clientWidth;
      if (!fitW) return;
      const css = getComputedStyle(el);
      const cap = parseFloat(css.getPropertyValue("--cap")) || 120;
      const floor = parseFloat(css.getPropertyValue("--floor")) || 40;
      const width = (t: string) => {
        measure.textContent = t;
        return measure.getBoundingClientRect().width;
      };
      const fit = fitName({ name, fitW: fitW * 0.995, cap, floor, width });
      measure.textContent = "";
      el.style.setProperty("--ns", `${fit.size.toFixed(2)}px`);
      const next = fit.lines.join("\n");
      if (next !== key.current) {
        key.current = next;
        setLines(fit.lines);
      }
    };
    run();
    let last = -1;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === last) return;
      last = w;
      run();
    });
    ro.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) run();
    });
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [nameRef, measureRef, name]);

  return lines;
}

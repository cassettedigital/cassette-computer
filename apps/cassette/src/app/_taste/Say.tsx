/**
 * A button's words, on one line, cut short with an ellipsis only when a row has nothing left to give
 * (row-fit.ts). With a `short` form, a row of buttons (ActionRow) can trade the whole name for it:
 * "Preview album" for "Preview", "Buy on Barnes & Noble" for "Buy". Outside a row the whole name shows.
 */

import type { ReactNode } from "react";
import r from "./actionrow.module.css";

export function Say({ whole, short }: { whole: ReactNode; short?: ReactNode }) {
  return (
    <span className={r.say} data-say="">
      {short === undefined ? (
        whole
      ) : (
        <>
          <span className={r.whole}>{whole}</span>
          <span className={r.short}>{short}</span>
        </>
      )}
    </span>
  );
}

/**
 * The playing mark: three bars, orange and moving only while the music is playing, grey and still
 * while it loads or is paused.
 */

import s from "./bars.module.css";

export function Bars({ live, className }: { live: boolean; className?: string }) {
  return (
    <span className={className ? `${s.bars} ${className}` : s.bars} data-live={live || undefined} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

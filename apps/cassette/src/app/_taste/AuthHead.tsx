import type { ReactNode } from "react";
import a from "./auth.module.css";

/**
 * The account column's head (AuthCard.tsx): an optional eyebrow in the label role, the title, one line under it.
 * Its own piece so a form that moves through steps (the invite) can change its head as it goes.
 */
export function AuthHead({ eyebrow, title, subtitle }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode }) {
  return (
    <header className={a.head}>
      {eyebrow ? <p className={a.eyebrow}>{eyebrow}</p> : null}
      <h1 className={a.title}>{title}</h1>
      {subtitle ? <p className={a.subtitle}>{subtitle}</p> : null}
    </header>
  );
}

/**
 * What a page that broke says, inside whatever frame caught it (each error.tsx on the paper): that it
 * didn't load, Try again (the boundary's reset), and one way on. The frame around it stays, so the
 * masthead, the dock and the song keep going. Drawn by the shared EmptyState. Only an error screen
 * renders it (it takes the boundary's reset), and the screen reports the crash itself
 * (useReportWebError), so this part stays a picture.
 */

import { ArrowButton, ArrowLink } from "./Button";
import { EmptyState } from "./EmptyState";

export type WayOn = { href: string; label: string };

export function Failed({
  reset,
  away = { href: "/", label: "Go to the homepage" },
  wrap = true,
}: {
  reset: () => void;
  away?: WayOn;
  wrap?: boolean;
}) {
  return (
    <EmptyState wrap={wrap} title="That page didn’t load.">
      <ArrowButton onClick={reset}>Try again</ArrowButton>
      <ArrowLink href={away.href}>{away.label}</ArrowLink>
    </EmptyState>
  );
}

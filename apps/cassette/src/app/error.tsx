"use client";

/**
 * A page that broke with no closer error screen of its own (the homepage, radio, search and the other
 * pages directly under the root): the site's own page frame around the shared "That page didn't load",
 * the same frame the site's 404 draws (not-found.tsx). Try again re-renders the page. Every error screen
 * reports what put it up to the diagnostics spine (/admin/diagnostics).
 */

import { Failed } from "./_taste/Failed";
import { PageFrame } from "./_taste/PageFrame";
import { useReportWebError } from "@/lib/diagnostics/use-report-web-error";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportWebError(error, "error.tsx");
  return (
    <PageFrame>
      <Failed reset={reset} />
    </PageFrame>
  );
}

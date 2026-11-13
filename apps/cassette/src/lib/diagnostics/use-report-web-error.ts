import { useEffect } from "react";
import { reportWebError } from "./web-report";

/**
 * The one line every error screen (each error.tsx and global-error.tsx) runs: send the error that put
 * the screen up to the diagnostics spine, and keep the detail in the console. In production, Next 15.5
 * hands an error caught by a page's own error screen only to the console, and the site-wide listener
 * (instrumentation-client.ts) never hears it, so a screen without this line hides the crash from
 * /admin/diagnostics (BUG-658). error-screens.test.ts fails on a screen that skips it.
 */
export function useReportWebError(error: Error & { digest?: string }, source: string): void {
  useEffect(() => {
    reportWebError(error, { source });
    console.error(`${source}:`, error);
  }, [error, source]);
}

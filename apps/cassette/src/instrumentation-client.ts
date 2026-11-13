/**
 * The window's error listeners, set once before the page starts (Next runs this file ahead of hydration) and
 * never taken down. They used to live in a component (WebErrorReporter) that went away with the page when the
 * page fell over, so the crashes that take the whole window down, the very ones Next answers with its bare
 * "Application error: a client-side exception has occurred" page, reached no one: no report to the diagnostics
 * spine, and no one-time reload for a page whose code files have gone missing (reportWebError's chunk rule).
 * Seen in the Mac app on launch, 2026-11-12. Next hands an error no screen caught to window.reportError, which
 * raises the window's error event heard here; the error screens (error.tsx, global-error.tsx) still report
 * their own (useReportWebError).
 */
import { reportWebError } from "@/lib/diagnostics/web-report";

window.addEventListener("error", (e) => {
  reportWebError(e.error ?? e.message, { source: "window.onerror" });
});
window.addEventListener("unhandledrejection", (e) => {
  reportWebError(e.reason, { source: "unhandledrejection" });
});

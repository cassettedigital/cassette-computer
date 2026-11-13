"use client";

/**
 * Last-resort error boundary. This is the ONLY thing that catches an error thrown
 * in the root layout itself — it REPLACES the root layout, so it must render its
 * own <html>/<body> and cannot rely on the app's globals.css, the kit's tokens or
 * next/font's faces. So it carries its own copy of the taste stock in one style
 * block: the light card stock, or the dark paper when the device is set to dark
 * (the paper follows the device everywhere), the house faces by name with their
 * fallbacks, and the kit's filled pill for the one way on. For everything below
 * the layout, error.tsx handles it with the chrome intact. Reports to the
 * diagnostics spine (/api/diagnostics/reports).
 */
import { useReportWebError } from "@/lib/diagnostics/use-report-web-error";

// the taste stock's values (packages/cassette-kit/src/taste.module.css .light / .dark), copied because no
// stylesheet of the app's is on this page
const CSS = `
.ge {
  color-scheme: light;
  --bg: #f3eadb;
  --ink: #15110e;
  --ink-2: rgba(21, 17, 14, 0.74);
  --fill: #2e241c;
  --fill-hover: #15110e;
  --ring: 0 0 0 2px #f3eadb, 0 0 0 4px #15110e;
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .ge {
    color-scheme: dark;
    --bg: #16110d;
    --ink: #efe7da;
    --ink-2: rgba(239, 231, 218, 0.74);
    --fill: #efe7da;
    --fill-hover: #ffffff;
    --ring: 0 0 0 2px #16110d, 0 0 0 4px #efe7da;
  }
}
.ge-box {
  max-width: 440px;
  padding: 32px;
  text-align: center;
}
.ge-title {
  margin: 0 0 14px;
  font: 800 clamp(36px, 7vw, 52px) / 0.9 "Barlow Condensed", "Arial Narrow", sans-serif;
  text-transform: uppercase;
}
.ge-line {
  margin: 0 0 28px;
  font: 400 17px / 1.5 "Newsreader", Georgia, serif;
  color: var(--ink-2);
}
.ge-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: var(--fill);
  color: var(--bg);
  font: 700 16px / 1.05 "Barlow Condensed", "Arial Narrow", sans-serif;
  letter-spacing: 0.08125em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.2s;
}
.ge-key:hover {
  background: var(--fill-hover);
}
.ge-key:focus-visible {
  outline: none;
  box-shadow: var(--ring);
}
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useReportWebError(error, "global-error.tsx");

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body className="ge">
        <div className="ge-box">
          <h1 className="ge-title">Something went wrong</h1>
          <p className="ge-line">Cassette hit an unexpected error. It usually passes, so try again.</p>
          <button type="button" className="ge-key" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

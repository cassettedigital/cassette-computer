"use client";

/**
 * Appearance picker: two axes on one page, in the player kit's sections (Settings, and the desk's window):
 *
 *   • Light or dark: Auto (the device's), Light or Dark, for the pages whose paper
 *              follows it (album, artist, the desk). Applied live; kept per device.
 *   • Skin: re-tints the accent ramp; applied LIVE on the web (and the
 *              desktop WebView, same origin) the instant you pick it.
 *
 * No app-icon choice: nothing applied it on any platform and its tiles weren't
 * the real icon, so it's gone from the page (founder, 2026-10-29). The icon
 * catalog stays in lib/appearance.ts, which the account route still validates.
 *
 * Persistence is localStorage today (see lib/appearance.ts) — the whole thing
 * is a showcase of the SELECTION + cross-launch stickiness, with no DB write.
 * The mounted-gate avoids a hydration mismatch: the server can't read
 * localStorage, so we render neutral until the effect seeds the real choice.
 */

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  THEMES,
  PAPERS,
  DEFAULT_THEME,
  DEFAULT_PAPER,
  loadAppearance,
  loadPaper,
  saveTheme,
  savePaper,
  type ThemeId,
  type PaperId,
} from "@/lib/appearance";
import taste from "@/app/_taste/taste.module.css";
import { StudioSection } from "@/app/studio/_kit/parts";
import styles from "./appearance.module.css";

function CheckBadge() {
  return (
    <span className={styles.check}>
      <Check size={13} strokeWidth={3} aria-hidden="true" />
    </span>
  );
}

export function AppearancePicker() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [paper, setPaper] = useState<PaperId>(DEFAULT_PAPER);

  // Seed from localStorage after mount (server rendered the defaults).
  useEffect(() => {
    setTheme(loadAppearance().theme);
    setPaper(loadPaper());
    setMounted(true);
  }, []);

  function pickPaper(id: PaperId) {
    setPaper(id);
    savePaper(id); // writes localStorage + stamps <html data-paper> → the paper turns live
  }

  function pickTheme(id: ThemeId) {
    setTheme(id);
    saveTheme(id); // writes localStorage + stamps <html data-theme> → live re-tint
  }

  return (
    <>
      {/* ── Light or dark ───────────────────────────────────────────────── */}
      <StudioSection title="Light or dark">
        <div className={styles.grid}>
          {PAPERS.map((p) => {
            const selected = mounted && paper === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPaper(p.id)}
                className={`${styles.card} ${selected ? styles.selected : ""}`}
                aria-pressed={selected}
              >
                {selected && <CheckBadge />}
                {/* Each side is the paper itself (the taste stock held by data-paper), so the preview
                    shows the real paper and ink rather than a snapshot. Auto shows both. */}
                <div className={styles.paper}>
                  {(p.id === "auto" ? (["light", "dark"] as const) : [p.id]).map((side) => (
                    <div key={side} className={`${taste.auto} ${styles.paperSide}`} data-paper={side}>
                      <span className={styles.paperCover} />
                      <span className={styles.paperLines}>
                        <span className={styles.paperLine} />
                        <span className={styles.paperLine} />
                      </span>
                    </div>
                  ))}
                </div>
                <span className={styles.cardName}>{p.name}</span>
                {p.id === "auto" && <span className={styles.cardBlurb}>Follows your device.</span>}
              </button>
            );
          })}
        </div>
      </StudioSection>

      {/* ── Skins ───────────────────────────────────────────────────────── */}
      <StudioSection title="Skin">
        <div className={styles.grid}>
          {THEMES.map((t) => {
            const selected = mounted && theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTheme(t.id)}
                className={`${styles.card} ${selected ? styles.selected : ""}`}
                aria-pressed={selected}
              >
                {selected && <CheckBadge />}
                {/* data-theme scopes the skin to this swatch: its chassis bg AND
                    accent pip/bars re-derive from the skin's own dial (see the
                    :root,[data-theme] block in globals.css), so the preview shows
                    the REAL result — background pivot included — not a hex snapshot. */}
                <div className={styles.swatch} data-theme={t.id === "classic" ? undefined : t.id}>
                  <span className={styles.swatchPip} style={{ background: "var(--cs-accent-9)", boxShadow: "0 0 8px 1px var(--cs-accent-9)" }} />
                  <span className={styles.swatchBar} style={{ background: "var(--cs-accent-9)" }} />
                  <span className={styles.swatchBar} style={{ background: "var(--cs-accent-11)", opacity: 0.5 }} />
                </div>
                <span className={styles.cardName}>{t.name}</span>
                <span className={styles.cardBlurb}>{t.blurb}</span>
              </button>
            );
          })}
        </div>
      </StudioSection>
    </>
  );
}

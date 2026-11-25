"use client";

/**
 * Appearance picker, in the player kit's sections (Settings, and the desk's window): Light or dark, that is Auto (the
 * device's), Light or Dark, for the pages whose paper follows it (album, artist, the desk). Applied live; kept per
 * device. No skins: the site is light and dark only (the founder's D14, 2026-11-22); a skin someone picked before is
 * left stored and simply no longer applied (lib/appearance.ts, RETIRED_SKINS).
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
import { PAPERS, DEFAULT_PAPER, loadPaper, savePaper, type PaperId } from "@/lib/appearance";
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
  const [paper, setPaper] = useState<PaperId>(DEFAULT_PAPER);

  // Seed from localStorage after mount (server rendered the defaults).
  useEffect(() => {
    setPaper(loadPaper());
    setMounted(true);
  }, []);

  function pickPaper(id: PaperId) {
    setPaper(id);
    savePaper(id); // writes localStorage + stamps <html data-paper> → the paper turns live
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

    </>
  );
}

"use client";

/**
 * CoverPicker — "find a better cover." A section DISTINCT from "Match to a
 * different catalog album": it searches the Cover Art Archive for every edition
 * of THIS album, scores them by the same weighted quality metric we use to pick
 * albums, and lets you choose one — showing each candidate's RESOLUTION and a
 * large PREVIEW so you can spot a janky cover before accepting. Choosing stages
 * the image for the Edit album panel's "Save changes" (never writes immediately).
 *
 * The first open of an album pays the throttled upstream cost (~10-15s); the
 * server caches per release group so re-opens are instant.
 */

import { useEffect, useState } from "react";
import { Button } from "@/app/components/Button";
import { LoadingDots } from "@/app/components/LoadingDots";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { useShell } from "./shell-context";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";

type Candidate = {
  candidateId: string;
  thumbUrl: string | null;
  previewUrl: string;
  fullUrl: string;
  width: number | null;
  height: number | null;
  isSquare: boolean;
  score: number;
  junk: boolean;
  edition: { releaseMbid: string; label: string; date: string | null; country: string | null; format: string | null };
};

type CandidatesResponse = {
  candidates: Candidate[];
  currentCoverUrl: string | null;
  hasOverride: boolean;
  rgMbid: string | null;
};

const disclosureStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--cs-ink2)",
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  display: "flex",
  gap: 6,
  alignItems: "center",
};
const muted: React.CSSProperties = { color: "var(--cs-ink3)", fontSize: "var(--cs-text-label)", margin: 0 };
/* Recessed tray for the search results — same well/hairline/radius language as a
   quiet Field, so the fetched art reads as one contained group rather than
   loose assets floating on the panel. */
const insetBox: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.6rem",
  background: "var(--cs-well)",
  border: "1px solid var(--cs-border-subtle)",
  borderRadius: "var(--cs-radius-lg)",
  padding: "0.75rem",
};
const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--cs-orange)",
  fontSize: "var(--cs-text-label)",
  textDecoration: "none",
};
const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
  gap: 8,
};

function tileStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    aspectRatio: "1",
    padding: 0,
    border: selected ? "2px solid var(--cs-orange)" : "1px solid var(--cs-border)",
    borderRadius: "var(--cs-radius-sm)",
    overflow: "hidden",
    cursor: "pointer",
    background: "var(--cs-vinyl)",
  };
}

export function CoverPicker({
  groupKey,
  albumRef = null,
  onStage,
  onReset,
  embedded = false,
  open = false,
}: {
  groupKey: string;
  /** List this picked (unsaved) album's covers instead of the record's own. */
  albumRef?: string | null;
  /** Kept for call-site compatibility; staging defers the folder mirror to save. */
  localCoverTrackId?: string | null;
  /** Stage a chosen CAA image for the parent Save changes commit. */
  onStage: (blob: Blob) => void;
  /** Stage a reset-to-original (parent Save changes commits the DELETE). */
  onReset?: () => void;
  /** Embedded in the cover action bar: drop the self-owned disclosure trigger and
   *  the section chrome — the parent's "Search" button controls `open`. */
  embedded?: boolean;
  /** Expansion state when `embedded`. Ignored otherwise. */
  open?: boolean;
}) {
  const { showToast } = useShell();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [wide, setWide] = useState(false);
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [showJunk, setShowJunk] = useState(false);
  const [staging, setStaging] = useState(false);

  const encoded = toBase64Url(groupKey);

  async function load(w: boolean) {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (w) qs.set("wide", "1");
      if (albumRef) qs.set("ref", albumRef);
      const r = await fetch(
        `/api/sync/library/album/${encoded}/cover-candidates${qs.size ? `?${qs}` : ""}`
      );
      if (!r.ok) {
        showToast("Couldn't search covers.", { variant: "error" });
        return;
      }
      const d = (await r.json()) as CandidatesResponse;
      setData(d);
      setSelected(d.candidates.find((c) => !c.junk) ?? d.candidates[0] ?? null);
    } catch {
      showToast("Couldn't search covers.", { variant: "error" });
    } finally {
      setLoading(false);
    }
  }

  // Effective expansion — controlled by the parent when embedded.
  const isOpen = embedded ? open : expanded;

  // Fetch candidates the first time it opens, whichever path opened it. Guarded
  // by `requested` so a "search all editions" refetch (which nulls `data`) or a
  // collapse/reopen never refires the throttled upstream search.
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (!isOpen || requested) return;
    setRequested(true);
    void load(false);
    // load is stable enough for this one-shot; `requested` guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, requested]);

  function searchWide() {
    setWide(true);
    setData(null);
    setSelected(null);
    void load(true);
  }

  async function choose() {
    if (!selected) return;
    setStaging(true);
    try {
      // CAA bytes come through our host-locked proxy (CAA 307s + CORS block a
      // direct browser fetch). Staging only — Save changes commits later.
      const bytesRes = await fetch(
        `/api/sync/library/cover-bytes?url=${encodeURIComponent(selected.previewUrl)}`
      );
      if (!bytesRes.ok) {
        showToast("Couldn't load that cover.", { variant: "error" });
        return;
      }
      onStage(await bytesRes.blob());
    } catch {
      showToast("Couldn't load that cover.", { variant: "error" });
    } finally {
      setStaging(false);
    }
  }

  const good = (data?.candidates ?? []).filter((c) => !c.junk);
  const junk = (data?.candidates ?? []).filter((c) => c.junk);

  function tile(c: Candidate) {
    return (
      <button
        key={c.candidateId}
        type="button"
        onClick={() => setSelected(c)}
        style={tileStyle(selected?.candidateId === c.candidateId)}
        title={`${c.width ?? "?"}×${c.height ?? "?"} · quality ${Math.round(c.score * 100)}`}
      >
        <Picture
          {...picture(c.thumbUrl ?? c.previewUrl, "cover")}
          sizes="120px"
          alt=""
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      </button>
    );
  }

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        ...(embedded
          ? null
          : { borderTop: "1px solid var(--cs-border)", paddingTop: "0.75rem" }),
      }}
    >
      {!embedded && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={disclosureStyle}
          aria-expanded={expanded}
        >
          <span>{expanded ? "▾" : "▸"}</span> Browse official cover art
        </button>
      )}

      {isOpen && (
        <div style={insetBox}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <LoadingDots label="Searching the Cover Art Archive" />
              <p style={muted}>
                Searching the Cover Art Archive… the first search for an album takes a moment.
              </p>
            </div>
          ) : !data || data.candidates.length === 0 ? (
            <p style={muted}>
              {data && data.rgMbid
                ? "No cover candidates found for this album."
                : "Couldn't identify this album in MusicBrainz, so there are no candidates to show."}
            </p>
          ) : (
            <>
              {selected && (
                <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start" }}>
                  <Picture
                    {...picture(selected.previewUrl, "cover")}
                    sizes="160px"
                    loading="eager"
                    alt="Cover preview"
                    style={{
                      width: 160,
                      height: "auto",
                      maxHeight: 220,
                      borderRadius: "var(--cs-radius-md)",
                      boxShadow: "var(--cs-shadow-md)",
                      objectFit: "contain",
                      flex: "none",
                    }}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: "var(--cs-text-body)" }}>
                      {selected.width && selected.height ? `${selected.width} × ${selected.height}` : "Resolution unknown"}
                      {!selected.isSquare && selected.width ? " · non-square" : ""}
                    </div>
                    <div style={muted}>{selected.edition.label}</div>
                    <div style={muted}>Quality score {Math.round(selected.score * 100)}/100</div>
                    <a href={selected.fullUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                      View full resolution ↗
                    </a>
                  </div>
                </div>
              )}

              <div style={gridStyle}>{good.map(tile)}</div>

              {junk.length > 0 && (
                <button type="button" style={{ ...linkStyle, alignSelf: "flex-start" }} onClick={() => setShowJunk((v) => !v)}>
                  {showJunk ? "Hide" : "Show"} low-quality ({junk.length})
                </button>
              )}
              {showJunk && junk.length > 0 && <div style={gridStyle}>{junk.map(tile)}</div>}

              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap" }}>
                  {!wide && (
                    <button type="button" style={linkStyle} onClick={searchWide}>
                      Not seeing it? Search all editions
                    </button>
                  )}
                  {data.hasOverride && onReset && (
                    <button type="button" style={linkStyle} onClick={onReset} disabled={staging}>
                      Reset to the album default
                    </button>
                  )}
                </div>
                <Button type="button" variant="primary" size="sm" onClick={() => void choose()} disabled={staging || !selected}>
                  {staging ? "Loading…" : "Use this cover"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

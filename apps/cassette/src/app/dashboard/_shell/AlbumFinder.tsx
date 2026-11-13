"use client";

/**
 * AlbumFinder - "Which album is this?" at the top of the Edit album panel.
 *
 * One place to say what a record IS, with its cover, instead of a cover search that
 * only knew the album the library had guessed and a catalog match hidden under
 * More options (BUG-919, 2026-11-08: a rip of "The Very Best of Daryl Hall & John
 * Oates" was filed as the 37-song "Ultimate", and every cover the editor offered
 * was Ultimate's).
 *
 * It opens on what the person's own files call the album and what it is filed as
 * now. When the two disagree it says so and leads with the album the files name
 * (the exact release, when a rip carried it). Below, related albums (the same
 * songs on other records) and a live search that finds albums by name or band as
 * you type. Picking one only STAGES it: the panel's Save switches the name, the
 * cover and the songs together.
 */

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { ladderSrc } from "@/lib/images/picture";
import { normalizeTitle } from "@/lib/dashboard/match-normalize";

type Confidence = "strong" | "likely" | "possible";

export type AlbumChoice = {
  candidateRef: string;
  title: string;
  artist: string;
  trackCount: number | null;
  coverUrl: string | null;
  confidence?: Confidence;
  exact?: boolean;
};

type Answer = {
  library: { title: string; artist: string; trackCount: number };
  current: AlbumChoice | null;
  suggestions: AlbumChoice[];
};

const songs = (n: number | null) => (n ? `${n} song${n === 1 ? "" : "s"}` : null);

export function AlbumFinder({
  encoded,
  picked,
  onPick,
  onUnpick,
}: {
  encoded: string;
  /** The album staged for Save, if any. */
  picked: AlbumChoice | null;
  onPick: (c: AlbumChoice) => void;
  onUnpick: () => void;
}) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AlbumChoice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    let gone = false;
    fetch(`/api/sync/library/album/${encoded}/match-suggestions`, { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : Promise.reject(new Error(String(r.status)))))
      .then((a) => {
        if (gone) return;
        setAnswer(a);
        // open on the choices when it was never filed, or when the files name a
        // different album that is on offer (their exact release, or one carrying
        // their name); a title merely written differently ("NFR!") stays shut
        const named = normalizeTitle(a.library.title);
        const better = a.suggestions.some((s) => s.exact || normalizeTitle(s.title) === named);
        if (a.suggestions.length > 0 && (!a.current || (mismatchOf(a) && better))) setOpen(true);
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
  }, [encoded]);

  // live search: albums by name or band as you type (the catalog's typo-forgiving search)
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      seq.current += 1; // an answer still on its way for an older query is dropped
      setResults(null);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = window.setTimeout(() => {
      fetch(`/api/catalog/albums/search?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => (r.ok ? (r.json() as Promise<{ results: AlbumChoice[] }>) : { results: [] }))
        .then((d) => mine === seq.current && setResults(d.results))
        .catch(() => mine === seq.current && setResults([]))
        .finally(() => mine === seq.current && setSearching(false));
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  // albums that arrived without a cover (not in the catalog yet): ask for a few
  const shown = results ?? answer?.suggestions ?? [];
  useEffect(() => {
    const need = shown.filter((c) => !c.coverUrl && !(c.candidateRef in covers)).slice(0, 4);
    if (need.length === 0) return;
    let gone = false;
    for (const c of need) {
      fetch(`/api/catalog/albums/cover?ref=${encodeURIComponent(c.candidateRef)}`, { credentials: "include" })
        .then((r) => (r.ok ? (r.json() as Promise<{ coverUrl: string | null }>) : { coverUrl: null }))
        .then((d) => !gone && setCovers((m) => ({ ...m, [c.candidateRef]: d.coverUrl ?? "" })))
        .catch(() => {});
    }
    return () => {
      gone = true;
    };
  }, [shown, covers]);
  const coverOf = (c: AlbumChoice) => c.coverUrl ?? (covers[c.candidateRef] || null);

  if (failed) return null;

  const lib = answer?.library;
  const current = answer?.current ?? null;
  const mismatch = !!answer && mismatchOf(answer);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      <div style={label}>Which album</div>

      {!answer ? (
        <div style={{ ...row, opacity: 0.5 }}>
          <div style={thumb(null)} />
          <div style={meta}>Looking it up…</div>
        </div>
      ) : picked ? (
        <div style={{ ...row, ...rowOn }}>
          <div style={thumb(coverOf(picked))} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={rowTitle}>{picked.title}</div>
            <div style={meta}>Saving switches the name, cover and songs to this album.</div>
          </div>
          <button type="button" style={textKey} onClick={onUnpick}>
            Undo
          </button>
        </div>
      ) : (
        <>
          {mismatch && lib && (
            <p style={note}>
              Your files call it <em>{lib.title}</em>
              {songs(lib.trackCount) ? ` (${songs(lib.trackCount)})` : ""}.{" "}
              {current ? (
                <>
                  It&apos;s filed as <em>{current.title}</em>
                  {songs(current.trackCount) ? ` (${songs(current.trackCount)})` : ""}.
                </>
              ) : (
                "It isn't matched to an album yet."
              )}
            </p>
          )}
          {current && !open && (
            <div style={row}>
              <div style={thumb(current.coverUrl)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={rowTitle}>{current.title}</div>
                <div style={meta}>{[current.artist, songs(current.trackCount)].filter(Boolean).join(" · ")}</div>
              </div>
              <button type="button" style={textKey} onClick={() => setOpen(true)}>
                Change
              </button>
            </div>
          )}
        </>
      )}

      {answer && !picked && (open || !current) && (
        <div style={well}>
          <div style={searchBox}>
            <Search size={14} style={{ color: "var(--cs-ink3)", flex: "none" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search albums or bands"
              aria-label="Search albums or bands"
              style={searchInput}
            />
            {query && (
              <button type="button" aria-label="Clear" style={clearKey} onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </div>

          {!results && shown.length > 0 && <div style={subLabel}>{mismatch ? "It may be" : "Related albums"}</div>}
          {searching && !results && <div style={meta}>Searching…</div>}
          {results?.length === 0 && !searching && <div style={meta}>No albums found. Try the band&apos;s name too.</div>}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {shown.map((c) => (
              <button key={c.candidateRef} type="button" style={choice} onClick={() => onPick(c)}>
                <div style={thumb(coverOf(c))} />
                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div style={rowTitle}>{c.title}</div>
                  <div style={meta}>
                    {[c.artist, songs(c.trackCount), c.exact ? "Your disc" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <span style={useKey}>Use</span>
              </button>
            ))}
          </div>

          {current && (
            <button type="button" style={{ ...textKey, alignSelf: "flex-start" }} onClick={() => setOpen(false)}>
              Keep {current.title}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** The files and the filing disagree: never filed, or filed under another name that
 *  isn't the files' own release. */
function mismatchOf(a: Answer): boolean {
  if (!a.current) return true;
  if (a.current.exact) return false;
  return normalizeTitle(a.current.title) !== normalizeTitle(a.library.title);
}

const label: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--cs-ink3)",
};
const subLabel: React.CSSProperties = { ...label, fontSize: "var(--cs-text-meta)", paddingTop: 2 };
const note: React.CSSProperties = {
  fontFamily: "var(--cs-font-serif)",
  fontSize: "var(--cs-text-label)",
  color: "var(--cs-ink2)",
  margin: 0,
  lineHeight: 1.45,
};
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.65rem",
  padding: "0.45rem",
  background: "var(--cs-well)",
  borderRadius: "var(--cs-radius-md)",
};
const rowOn: React.CSSProperties = { boxShadow: "inset 0 0 0 1.5px var(--cs-orange)" };
const choice: React.CSSProperties = {
  ...row,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  width: "100%",
  color: "inherit",
  font: "inherit",
};
const well: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  padding: "0.6rem",
  background: "var(--cs-well)",
  borderRadius: "var(--cs-radius-lg)",
};
const searchBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0.45rem 0.7rem",
  background: "var(--cs-bg)",
  borderRadius: "var(--cs-radius-pill, 999px)",
};
const searchInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "transparent",
  border: "none",
  outline: "none",
  color: "var(--cs-ink)",
  fontFamily: "var(--cs-font-serif)",
  fontSize: "var(--cs-text-body)",
};
const clearKey: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--cs-ink3)",
  display: "flex",
};
const rowTitle: React.CSSProperties = {
  fontFamily: "var(--cs-font-display)",
  fontSize: "var(--cs-text-body)",
  fontWeight: 600,
  color: "var(--cs-ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const meta: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  color: "var(--cs-ink3)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const textKey: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--cs-orange)",
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  flex: "none",
};
const useKey: React.CSSProperties = { ...textKey, cursor: "inherit" };

function thumb(url: string | null): React.CSSProperties {
  return {
    width: 44,
    height: 44,
    flex: "none",
    borderRadius: "var(--cs-radius-sm)",
    background: url
      ? `center/cover url("${ladderSrc(url, 120)}")`
      : "linear-gradient(150deg, var(--cs-source-bg-a), var(--cs-source-bg-b))",
  };
}

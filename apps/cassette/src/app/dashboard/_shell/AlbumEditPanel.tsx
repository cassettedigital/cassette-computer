"use client";

/**
 * AlbumEditPanel — the "Edit album" modal for an owned library album, built as
 * progressive disclosure so a casual user sees only the basics and a detail-
 * oriented one can open everything:
 *
 *   BASICS (always visible)
 *     - Which album (AlbumFinder): what the files call it, what it is filed as,
 *       and one search that finds albums WITH their covers. Picking one stages
 *       the name, cover and songs together (BUG-919: re-identifying used to be
 *       buried under More options and left the old cover behind).
 *     - Cover — one unified section (CoverEditor: upload / drop / ⌘V / Search)
 *       with Cover Art Archive browse (CoverPicker) inline.
 *     - Album name + Band name (display-name override).
 *
 *   EDIT MORE (opt-in disclosure)
 *     - Year / Label / Genre (album metadata override — non-destructive).
 *     - Song names (per-track title override).
 *
 * Every edit is a non-destructive Cassette-owned display override — it changes
 * how the album renders in Cassette and never rewrites the file's embedded tags.
 * Cover picks stage in the panel and commit with "Save changes", same as name
 * and details — there is no separate cover-save step.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { commitAlbumCover } from "@/lib/library-cover";
import { Button } from "@/app/components/Button";
import { Field } from "@/app/components/Field";
import { useShell } from "./shell-context";
import { CoverEditor, type PendingCover } from "./CoverEditor";
import { AlbumFinder, type AlbumChoice } from "./AlbumFinder";

const previewCoverCache = new Map<string, Promise<string | null>>();

function fetchPreviewCover(ref: string): Promise<string | null> {
  let p = previewCoverCache.get(ref);
  if (!p) {
    p = fetch(`/api/catalog/albums/cover?ref=${encodeURIComponent(ref)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { coverUrl: null }))
      .then((d: { coverUrl: string | null }) => d.coverUrl ?? null)
      .catch(() => null);
    previewCoverCache.set(ref, p);
  }
  return p;
}

export type LinkedAlbum = {
  catalogAlbumId: number;
  slug: string;
  title: string;
  artist: string;
  coverArtUrl: string | null;
};

/** One editable track row — the rail's owned tracks, narrowed to those with a
 *  stable per-track key (all rail tracks carry one). */
export type EditTrack = {
  cassetteLocalId: string;
  title: string;
  discNumber: number | null;
};

export function AlbumEditPanel({
  groupKey,
  title,
  artist,
  coverSrc,
  hasCoverOverride,
  localCoverTrackId,
  year,
  label,
  genre,
  tracks,
  onClose,
  onLinked,
  onSaved,
  onCoverReplaced,
}: {
  groupKey: string;
  title: string;
  artist: string;
  coverSrc: string | null;
  hasCoverOverride: boolean;
  localCoverTrackId: string | null;
  /** Effective album metadata (override → catalog base) for pre-fill. */
  year: number | null;
  label: string | null;
  genre: string | null;
  tracks: EditTrack[];
  onClose: () => void;
  onLinked: (album: LinkedAlbum) => void;
  /** Re-fetch the rail source after any name/metadata/track override saves. */
  onSaved: () => void;
  onCoverReplaced: () => void;
}) {
  const { showToast } = useShell();
  const encoded = toBase64Url(groupKey);

  // ── Album fields (name + metadata) + staged cover — one save ─────────────
  const [fTitle, setFTitle] = useState(title);
  const [fArtist, setFArtist] = useState(artist);
  const [fYear, setFYear] = useState(year != null ? String(year) : "");
  const [fLabel, setFLabel] = useState(label ?? "");
  const [fGenre, setFGenre] = useState(genre ?? "");
  // Snapshot of the last-saved values — drives the dirty check + reverts.
  const [snap, setSnap] = useState({
    title,
    artist,
    year: year != null ? String(year) : "",
    label: label ?? "",
    genre: genre ?? "",
  });
  const [pendingCover, setPendingCover] = useState<PendingCover | null>(null);
  const [savingFields, setSavingFields] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const setPendingCoverSafe = useCallback((next: PendingCover | null) => {
    setPendingCover((prev) => {
      if (prev?.kind === "image") URL.revokeObjectURL(prev.previewUrl);
      return next;
    });
  }, []);

  const pendingCoverRef = useRef(pendingCover);
  pendingCoverRef.current = pendingCover;
  useEffect(() => {
    return () => {
      const prev = pendingCoverRef.current;
      if (prev?.kind === "image") URL.revokeObjectURL(prev.previewUrl);
    };
  }, []);

  const fieldsDirty =
    fTitle !== snap.title ||
    fArtist !== snap.artist ||
    fYear !== snap.year ||
    fLabel !== snap.label ||
    fGenre !== snap.genre;
  // ── Which album: an album picked in the finder, staged for Save ───────────
  const [pickedAlbum, setPickedAlbum] = useState<AlbumChoice | null>(null);
  const [pickedCoverFailed, setPickedCoverFailed] = useState(false);
  const dirty = fieldsDirty || pendingCover != null || pickedAlbum != null;

  const saveFields = useCallback(async () => {
    const nextTitle = fTitle.trim();
    const nextArtist = fArtist.trim();
    if (fieldsDirty && (!nextTitle || !nextArtist)) {
      setFieldsError("Album and artist name can't be empty.");
      return;
    }
    if (!dirty) return;
    setSavingFields(true);
    setFieldsError(null);
    const coverToSave = pendingCover;
    let fieldsOk = !fieldsDirty;
    let coverOk = coverToSave == null;
    let mirrorMissed = false;
    try {
      if (fieldsDirty) {
        const res = await fetch(`/api/sync/library/album/${encoded}/display-override`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            displayTitle: nextTitle,
            displayArtist: nextArtist,
            displayYear: fYear.trim(),
            displayLabel: fLabel.trim(),
            displayGenre: fGenre.trim(),
          }),
        });
        if (!res.ok) throw new Error("fields_failed");
        setSnap({
          title: nextTitle,
          artist: nextArtist,
          year: fYear.trim(),
          label: fLabel.trim(),
          genre: fGenre.trim(),
        });
        fieldsOk = true;
      }

      if (coverToSave?.kind === "image") {
        const result = await commitAlbumCover({
          groupKey,
          blob: coverToSave.blob,
          source: coverToSave.source,
          localCoverTrackId,
        });
        if (!result.ok) {
          setFieldsError(result.error);
          coverOk = false;
        } else {
          mirrorMissed = result.mirrorMissed;
          setPendingCoverSafe(null);
          coverOk = true;
          onCoverReplaced();
        }
      } else if (coverToSave?.kind === "reset") {
        const r = await fetch(`/api/sync/library/album/${encoded}/cover`, {
          method: "DELETE",
        });
        if (!r.ok) {
          setFieldsError("Couldn't reset the cover.");
          coverOk = false;
        } else {
          setPendingCoverSafe(null);
          coverOk = true;
          onCoverReplaced();
        }
      }

      // Switch the album LAST: the name and cover above are filed under this
      // record's own name, so they hold across the switch; the switch changes the
      // record's address, which the steps above still need.
      if (fieldsOk && coverOk && pickedAlbum) {
        const res = await fetch(`/api/sync/library/album/${encoded}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ candidateRef: pickedAlbum.candidateRef }),
        });
        if (!res.ok) {
          setFieldsError("Couldn't switch the album. Try again.");
          return;
        }
        const data = (await res.json()) as { linked: boolean; album: LinkedAlbum };
        if (coverToSave) onCoverReplaced();
        onLinked(data.album);
        return;
      }

      if (fieldsOk && coverOk) {
        if (fieldsDirty && coverToSave) {
          showToast(
            mirrorMissed
              ? "Saved. Your phone cover will update on the next sync."
              : "Changes saved.",
            { variant: mirrorMissed ? "info" : "success" }
          );
        } else if (fieldsDirty) {
          showToast("Album details saved.", { variant: "success" });
        } else if (coverToSave?.kind === "reset") {
          showToast("Cover reset to the album default.", { variant: "success" });
        } else if (coverToSave) {
          showToast(
            mirrorMissed
              ? "Cover set. Your phone copy will update on the next sync."
              : "Cover updated.",
            { variant: mirrorMissed ? "info" : "success" }
          );
        }
        if (fieldsDirty) onSaved();
      } else if (fieldsOk && !coverOk && fieldsDirty) {
        // Name landed; cover didn't — still refresh the rail for the fields.
        showToast("Album details saved, but the cover couldn't be updated.", {
          variant: "error",
        });
        onSaved();
      }
    } catch {
      setFieldsError("Couldn't save — try again.");
    } finally {
      setSavingFields(false);
    }
  }, [
    dirty,
    fieldsDirty,
    pendingCover,
    pickedAlbum,
    onLinked,
    encoded,
    groupKey,
    localCoverTrackId,
    fTitle,
    fArtist,
    fYear,
    fLabel,
    fGenre,
    onSaved,
    onCoverReplaced,
    setPendingCoverSafe,
    showToast,
  ]);

  // ── Song names (per-track override) ───────────────────────────────────────
  const [songs, setSongs] = useState<Record<string, string>>(() =>
    Object.fromEntries(tracks.map((t) => [t.cassetteLocalId, t.title]))
  );
  const [songSnap, setSongSnap] = useState<Record<string, string>>(() =>
    Object.fromEntries(tracks.map((t) => [t.cassetteLocalId, t.title]))
  );
  const [savingSongs, setSavingSongs] = useState(false);
  const songsDirty = tracks.some((t) => songs[t.cassetteLocalId] !== songSnap[t.cassetteLocalId]);
  const multiDisc = useMemo(
    () => new Set(tracks.map((t) => t.discNumber ?? 1)).size > 1,
    [tracks]
  );

  const saveSongs = useCallback(async () => {
    const changed = tracks
      .filter((t) => songs[t.cassetteLocalId] !== songSnap[t.cassetteLocalId])
      .map((t) => ({ cassetteLocalId: t.cassetteLocalId, displayTitle: songs[t.cassetteLocalId] ?? "" }));
    if (changed.length === 0) return;
    setSavingSongs(true);
    try {
      const res = await fetch(`/api/sync/library/album/${encoded}/track-overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ overrides: changed }),
      });
      if (!res.ok) throw new Error("save_failed");
      const data = (await res.json()) as { results: Array<{ cassetteLocalId: string; title: string }> };
      // Repaint each saved row with the resulting effective title (a cleared row
      // reverts to its raw file tag) and advance the snapshot.
      setSongs((prev) => {
        const next = { ...prev };
        for (const r of data.results) next[r.cassetteLocalId] = r.title;
        return next;
      });
      setSongSnap((prev) => {
        const next = { ...prev };
        for (const r of data.results) next[r.cassetteLocalId] = r.title;
        return next;
      });
      showToast("Song names saved.", { variant: "success" });
      onSaved();
    } catch {
      showToast("Couldn't save song names — try again.", { variant: "error" });
    } finally {
      setSavingSongs(false);
    }
  }, [encoded, tracks, songs, songSnap, onSaved, showToast]);

  // ── Advanced disclosure ("Edit more") ────────────────────────────────────
  const [advanced, setAdvanced] = useState(false);

  // Pick an album: stage it, its cover (the stored original, for the folder) and
  // its name. Fields the person already typed in are kept.
  const pickSeq = useRef(0);
  const pickAlbum = useCallback(
    async (c: AlbumChoice) => {
      const mine = ++pickSeq.current;
      setPickedAlbum(c);
      setPickedCoverFailed(false);
      setPendingCoverSafe(null);
      if (fTitle === snap.title && fArtist === snap.artist) {
        setFTitle(c.title);
        setFArtist(c.artist);
        setSnap((prev) => ({ ...prev, title: c.title, artist: c.artist }));
      }
      // a later pick (or Undo) wins over a cover still arriving for an earlier one
      const url = c.coverUrl ?? (await fetchPreviewCover(c.candidateRef));
      if (mine !== pickSeq.current) return;
      if (!url) {
        setPickedCoverFailed(true);
        return;
      }
      try {
        const r = await fetch(`/api/sync/library/cover-bytes?url=${encodeURIComponent(url)}`);
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        if (mine !== pickSeq.current) return;
        setPendingCoverSafe({ kind: "image", blob, previewUrl: URL.createObjectURL(blob), source: "caa" });
      } catch {
        if (mine === pickSeq.current) setPickedCoverFailed(true);
      }
    },
    [fTitle, fArtist, snap.title, snap.artist, setPendingCoverSafe]
  );

  const unpickAlbum = useCallback(() => {
    pickSeq.current += 1;
    setPickedAlbum(null);
    setPickedCoverFailed(false);
    setPendingCoverSafe(null);
    setFTitle(title);
    setFArtist(artist);
    setSnap((prev) => ({ ...prev, title, artist }));
  }, [title, artist, setPendingCoverSafe]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);


  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit album"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          // The DARKEST surface step, not bg2: the field wells are a fixed
          // #181410, so a bg2 panel (#23201a) left a ~0.055 lightness gap that
          // read as zebra striping down a stack of inputs. bg (#1c1913) more
          // than halves it; the overlay + border still read the panel as raised.
          background: "var(--cs-bg)",
          border: "1px solid var(--cs-ink4)",
          borderRadius: "var(--cs-radius-md)",
          padding: "1.25rem",
          maxWidth: "460px",
          width: "100%",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          overflowY: "auto",
        }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={titleStyle}>Edit album</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={closeStyle}>
            ×
          </button>
        </header>

        {/* ── BASICS: which album ── */}
        <AlbumFinder encoded={encoded} picked={pickedAlbum} onPick={(c) => void pickAlbum(c)} onUnpick={unpickAlbum} />

        {/* ── BASICS: cover ── */}
        <CoverEditor
          groupKey={groupKey}
          albumRef={pickedAlbum?.candidateRef ?? null}
          localCoverTrackId={localCoverTrackId}
          coverSrc={coverSrc}
          hasOverride={hasCoverOverride}
          pending={pendingCover}
          onPendingChange={setPendingCoverSafe}
        />
        {pickedCoverFailed && (
          <p style={mutedLine}>That album has no cover on file. Upload or search for one, or save without.</p>
        )}

        {/* ── BASICS: name ── */}
        <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Field label="Album name" quiet value={fTitle} onChange={setFTitle} inputProps={{ maxLength: 200 }} />
          <Field label="Band name" quiet value={fArtist} onChange={setFArtist} inputProps={{ maxLength: 200 }} />
        </section>

        {/* ── EDIT MORE ── */}
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          style={editMoreStyle}
          aria-expanded={advanced}
        >
          <span>{advanced ? "▾" : "▸"}</span> {advanced ? "Fewer options" : "More options"}
        </button>

        {advanced && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Metadata */}
            <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <div style={{ width: 110 }}>
                  <Field
                    label="Year"
                    quiet
                    value={fYear}
                    onChange={(v) => setFYear(v.replace(/[^\d]/g, "").slice(0, 4))}
                    placeholder="—"
                    inputProps={{ inputMode: "numeric" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Label" quiet value={fLabel} onChange={setFLabel} inputProps={{ maxLength: 200 }} />
                </div>
              </div>
              <Field label="Genre" quiet value={fGenre} onChange={setFGenre} inputProps={{ maxLength: 120 }} />
            </section>

            {/* Song names */}
            {tracks.length > 0 && (
              <section style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <div style={sectionLabel}>Song names</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {tracks.map((t, i) => {
                    const prevDisc = tracks[i - 1]?.discNumber ?? 1;
                    const thisDisc = t.discNumber ?? 1;
                    const showDisc = multiDisc && (i === 0 || thisDisc !== prevDisc);
                    return (
                      <div key={t.cassetteLocalId} style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                        {showDisc && <div style={discLabel}>Disc {thisDisc}</div>}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                          <span style={trackNum}>{i + 1}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <Field
                              aria-label={`Song ${i + 1} name`}
                              quiet
                              value={songs[t.cassetteLocalId] ?? ""}
                              onChange={(v) =>
                                setSongs((prev) => ({ ...prev, [t.cassetteLocalId]: v }))
                              }
                              inputProps={{ maxLength: 300 }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void saveSongs()}
                  disabled={!songsDirty || savingSongs}
                  style={{ alignSelf: "flex-start" }}
                >
                  {savingSongs ? "Saving…" : "Save song names"}
                </Button>
              </section>
            )}
          </div>
        )}

        {/* ── Save bar (cover + album name + details) ── */}
        <footer
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            justifyContent: "flex-end",
            borderTop: "1px solid var(--cs-border)",
            paddingTop: "0.85rem",
          }}
        >
          {fieldsError && <p style={{ ...errorLine, marginRight: "auto" }}>{fieldsError}</p>}
          <p style={{ ...mutedLine, marginRight: "auto", opacity: fieldsError ? 0 : 1 }}>
            Changes how this shows in Cassette. Your file tags aren&apos;t touched.
          </p>
          <Button
            type="button"
            variant="primary"
            onClick={() => void saveFields()}
            disabled={savingFields || !dirty}
          >
            {savingFields ? "Saving…" : "Save changes"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--cs-font-display)",
  fontSize: "var(--cs-text-body)",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--cs-ink)",
  margin: 0,
};
const closeStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--cs-ink2)",
  fontSize: "var(--cs-text-section)",
  cursor: "pointer",
  padding: 0,
  lineHeight: 1,
};
const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--cs-ink3)",
};
const discLabel: React.CSSProperties = {
  ...sectionLabel,
  color: "var(--cs-ink2)",
  paddingTop: "0.35rem",
};
const trackNum: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  // ink4 is border/fill-only (see globals.css) — illegible as text in dark mode.
  color: "var(--cs-ink3)",
  width: 18,
  flex: "none",
  textAlign: "right",
};
const editMoreStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.4rem",
  alignSelf: "flex-start",
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-label)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--cs-orange)",
};
const mutedLine: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-label)",
  color: "var(--cs-ink3)",
  margin: 0,
};
const errorLine: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-label)",
  color: "var(--cs-red, #f87171)",
  margin: 0,
};

"use client";

/**
 * CoverEditor — "Replace album cover" as one action surface:
 *
 *   [ Upload ]  [ Search ]   + drop / ⌘V an image onto the preview
 *
 * Upload opens the file picker; drop or paste stages a preview; Search expands
 * the Cover Art Archive browser (CoverPicker). Staging only — the Edit album
 * panel's "Save changes" commits the pick (same as name / details).
 */

import { useEffect, useRef, useState } from "react";
import { Upload, Search, X } from "lucide-react";
import { Button } from "@/app/components/Button";
import { shortcutLabel, useIsMac } from "@/lib/platform-shortcut";
import type { CoverSource } from "@/lib/library-cover";
import { useShell } from "./shell-context";
import { CoverPicker } from "./CoverPicker";

export type PendingCover =
  | { kind: "image"; blob: Blob; previewUrl: string; source: CoverSource }
  | { kind: "reset" };

/** Which secondary surface the action bar has revealed. */
type Mode = null | "search";

/** The paste hint, in the viewer's own shortcut words: Cmd V on a Mac, Ctrl+V elsewhere. */
function PasteHint() {
  const isMac = useIsMac();
  return <>Drop an image here, or paste one ({shortcutLabel("V", isMac)}).</>;
}

function isImageFile(f: File | null | undefined): f is File {
  return Boolean(f && f.type.startsWith("image/"));
}

export function CoverEditor({
  groupKey,
  albumRef = null,
  localCoverTrackId,
  coverSrc,
  hasOverride,
  pending,
  onPendingChange,
}: {
  groupKey: string;
  /** An album picked in the editor's album search, not saved yet: Search lists
   *  ITS covers (BUG-919), not the covers of what the record is filed as. */
  albumRef?: string | null;
  localCoverTrackId: string | null;
  /** The cover currently shown in the rail (already cache-busted) — the preview. */
  coverSrc: string | null;
  /** Whether a personal cover override exists (enables "Reset to original"). */
  hasOverride: boolean;
  pending: PendingCover | null;
  onPendingChange: (next: PendingCover | null) => void;
}) {
  const { showToast } = useShell();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [dragOver, setDragOver] = useState(false);

  // Keep the drop zone focusable so bare ⌘V works without a URL field.
  useEffect(() => {
    dropRef.current?.focus({ preventScroll: true });
  }, []);

  function stage(blob: Blob, source: CoverSource) {
    onPendingChange({
      kind: "image",
      blob,
      previewUrl: URL.createObjectURL(blob),
      source,
    });
  }

  function clearPending() {
    onPendingChange(null);
  }

  function acceptImageFile(f: File, source: CoverSource) {
    if (!isImageFile(f)) {
      showToast("Please choose an image.", { variant: "error" });
      return;
    }
    setMode(null);
    stage(f, source);
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    acceptImageFile(f, "upload");
  }

  /** ⌘V: a copied IMAGE stages directly. Links are ignored — paste the image. */
  function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          setMode(null);
          stage(blob, "paste");
          return;
        }
      }
    }
  }

  function onDragOver(e: React.DragEvent) {
    if (![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    acceptImageFile(f, "upload");
  }

  const previewUrl =
    pending?.kind === "image" ? pending.previewUrl : pending?.kind === "reset" ? null : coverSrc;
  const showReset =
    hasOverride && pending?.kind !== "reset" && pending?.kind !== "image";

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
      <div
        ref={dropRef}
        tabIndex={0}
        onPaste={onPaste}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-label="Replace album cover — drop or paste an image"
        style={{
          display: "flex",
          gap: "0.9rem",
          alignItems: "flex-start",
          outline: "none",
          borderRadius: "var(--cs-radius-lg)",
          boxShadow: dragOver ? "inset 0 0 0 2px var(--cs-orange)" : undefined,
        }}
      >
        {/* Preview — a staged pick wins; a staged reset clears the art until save. */}
        <div style={previewBox}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              aria-hidden="true"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
          {pending?.kind === "reset" && (
            <div style={resetOverlay}>Reset on save</div>
          )}
          {dragOver && <div style={dropOverlay}>Drop image</div>}
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={sectionLabel}>Replace album cover</div>
          {pending ? (
            <>
              <p style={hint}>
                {pending.kind === "reset"
                  ? "Will reset to the original cover when you save."
                  : "Preview — save your changes below to apply."}
              </p>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Button type="button" variant="ghost" size="sm" onClick={clearPending}>
                  <X size={13} /> Cancel
                </Button>
                {albumRef && pending.kind === "image" && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setMode((m) => (m === "search" ? null : "search"))}
                    aria-pressed={mode === "search"}
                    style={mode === "search" ? activeBtn : undefined}
                  >
                    <Search size={13} /> Other covers
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} /> Upload
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setMode((m) => (m === "search" ? null : "search"))}
                  aria-pressed={mode === "search"}
                  style={mode === "search" ? activeBtn : undefined}
                >
                  <Search size={13} /> Search
                </Button>
              </div>
              <p style={hint}><PasteHint /></p>

              {showReset && (
                <button
                  type="button"
                  style={resetLink}
                  onClick={() => onPendingChange({ kind: "reset" })}
                >
                  Reset to the original cover
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {mode === "search" && (!pending || albumRef) && (
        <CoverPicker
          key={albumRef ?? "filed"}
          groupKey={groupKey}
          albumRef={albumRef}
          localCoverTrackId={localCoverTrackId}
          onStage={(blob) => {
            setMode(null);
            stage(blob, "caa");
          }}
          onReset={() => {
            setMode(null);
            onPendingChange({ kind: "reset" });
          }}
          embedded
          open
        />
      )}

      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={onFileSelected} />
    </section>
  );
}

const previewBox: React.CSSProperties = {
  width: 104,
  height: 104,
  flex: "none",
  position: "relative",
  overflow: "hidden",
  borderRadius: "var(--cs-radius-lg)",
  background: "linear-gradient(150deg, var(--cs-source-bg-a), var(--cs-source-bg-b))",
  boxShadow: "var(--cs-shadow-sm)",
};
const dropOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.55)",
  color: "var(--cs-orange)",
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};
const resetOverlay: React.CSSProperties = {
  ...dropOverlay,
  background: "rgba(0,0,0,0.4)",
  color: "var(--cs-ink2)",
};
const sectionLabel: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-meta)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--cs-ink3)",
};
const hint: React.CSSProperties = {
  fontFamily: "var(--cs-font-mono)",
  fontSize: "var(--cs-text-label)",
  color: "var(--cs-ink3)",
  margin: 0,
};
const activeBtn: React.CSSProperties = {
  borderColor: "var(--cs-orange)",
  color: "var(--cs-orange)",
};
const resetLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  color: "var(--cs-orange)",
  fontSize: "var(--cs-text-label)",
  alignSelf: "flex-start",
};

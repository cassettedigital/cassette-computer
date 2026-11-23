"use client";

/**
 * PlaylistCoverPicker: the covers drawn for this playlist, opened from wherever a playlist cover
 * renders. Confirms via `onCoverChosen` (the caller owns persistence: PUT /api/sync/playlists/:id
 * already accepts cover_image_url, see PlaylistEditor and the desk's playlist page).
 *
 * The drawn covers are every cover-art family (src/lib/cover-art) drawn with this playlist's name, the
 * one it gets on its own first. Choosing one stores the family alone (`drawnPickUrl`), which every
 * reader turns into the cover's current address (src/lib/covers/playlist.ts), so a rename redraws it.
 * The preset grid and "upload your own" are gone (the founder, 2026-10-22: the drawn covers are the
 * covers); a playlist that already carries one keeps it until another is picked.
 *
 * One window (the founder's wife, 2026-11-21: choosing and then accepting was two steps): the cover as it
 * is now sits at the head, at the size and shape the playlist page shows it, moving as it does there; a
 * click on a cover below lights it and shows it there; "Use this cover" keeps it (a double click on a cover
 * keeps it at once). `current` is the cover the playlist wears, so its own is lit on opening.
 */

import { useState, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { DialogTrigger, Modal } from "@/app/components/Modal";
import { LiveCover } from "@/app/components/LiveCover";
import { coverFamilies, coverSpec, type FamilyId } from "@/lib/cover-art/spec";
import { drawnPickFamily, drawnPickUrl, isDrawnPlaylistCover, playlistArtCoverUrl } from "@/lib/covers/playlist";
import styles from "./PlaylistCoverPicker.module.css";

export function PlaylistCoverPicker({
  playlistId,
  playlistName,
  trigger,
  triggerLabel = "Change playlist cover",
  onCoverChosen,
  defaultOpen,
  triggerClassName,
  isOpen,
  onOpenChange,
  current,
}: {
  playlistId: string;
  /** The playlist's saved name, which the drawn covers carry. */
  playlistName: string;
  /** Visual content only (e.g. the cover swatch) — the actual interactive
   *  trigger element is owned by this component (RA's DialogTrigger needs an
   *  RA-aware pressable child; a plain native <button> here silently doesn't
   *  open the dialog, since it never receives the PressResponder context). */
  trigger: ReactNode;
  triggerLabel?: string;
  onCoverChosen: (url: string) => void;
  /** Opens the dialog once, uncontrolled, on first mount — for the one-time
   *  "pick a cover" prompt right after playlist creation. Every other open
   *  is still gated on a deliberate click of the trigger. */
  defaultOpen?: boolean;
  /** Added to the trigger (a page that wants it to fill the cover's box). */
  triggerClassName?: string;
  /** Controlled open state, for a page that opens the picker from elsewhere (a menu's "Change the cover"). */
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The cover the playlist wears now (its address), so the window opens on it, lit. */
  current?: string | null;
}) {
  // the cover it gets on its own first, then every other family that can carry its name
  const own = coverSpec(playlistId, playlistName);
  const families = [own.family, ...coverFamilies(own.titles).filter((f) => f !== own.family)];
  const drawnUrl = (family: FamilyId, size: number) => playlistArtCoverUrl({ id: playlistId, name: playlistName }, { absolute: false, size, family });
  // the family it wears: a chosen one, its own when it wears the drawn cover it was given, none for anything else
  const wears: FamilyId | null = drawnPickFamily(current) ?? (isDrawnPlaylistCover(current) ? own.family : null);
  // the one lit here; null: the one it wears (so a cover changed while this was shut opens right)
  const [lit, setLit] = useState<FamilyId | null>(null);
  const shown = lit ?? wears ?? own.family;
  const changed = lit !== null && lit !== wears;

  return (
    <DialogTrigger
      defaultOpen={defaultOpen}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setLit(null);
        onOpenChange?.(open);
      }}
    >
      <AriaButton className={triggerClassName ? `${styles.triggerReset} ${triggerClassName}` : styles.triggerReset} aria-label={triggerLabel}>
        {trigger}
      </AriaButton>
      <Modal title="Choose a cover" subtitle="Drawn for this playlist" size="lg">
        {({ close }) => {
          const keep = (family: FamilyId) => {
            if (family !== wears) onCoverChosen(drawnPickUrl(playlistId, family));
            close();
            setLit(null);
          };
          return (
            <div className={styles.body}>
              <div className={styles.head}>
                {/* a cover from before the drawn ones isn't one of these: the head offers its own drawn cover */}
                <div className={styles.preview}>
                  <LiveCover key={shown} id={playlistId} name={playlistName} family={shown} mode="visible">
                    <img src={drawnUrl(shown, 600)} alt="" className={styles.previewImg} />
                  </LiveCover>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.cancel} onClick={close}>
                    Cancel
                  </button>
                  <button type="button" className={styles.confirm} disabled={!changed} onClick={() => lit && keep(lit)}>
                    Use this cover
                  </button>
                </div>
              </div>
              <div className={styles.scroll}>
                <div className={styles.grid} role="radiogroup" aria-label="Covers">
                  {families.map((family) => (
                    <button
                      key={family}
                      type="button"
                      role="radio"
                      aria-checked={family === shown}
                      className={styles.tile}
                      onClick={() => setLit(family)}
                      onDoubleClick={() => keep(family)}
                      aria-label={`${family} cover`}
                    >
                      <LiveCover id={playlistId} name={playlistName} family={family} mode="hover">
                        <img src={drawnUrl(family, 300)} alt="" loading="lazy" className={styles.tileImg} />
                      </LiveCover>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        }}
      </Modal>
    </DialogTrigger>
  );
}

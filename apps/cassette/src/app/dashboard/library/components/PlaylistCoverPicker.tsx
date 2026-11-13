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
 * A pick lands on a preview at the size and shape the playlist page header shows the cover at, moving
 * as it does there, before it's confirmed.
 */

import { useState, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import { DialogTrigger, Modal } from "@/app/components/Modal";
import { LiveCover } from "@/app/components/LiveCover";
import { coverFamilies, coverSpec, type FamilyId } from "@/lib/cover-art/spec";
import { drawnPickUrl, playlistArtCoverUrl } from "@/lib/covers/playlist";
import styles from "./PlaylistCoverPicker.module.css";

type Step =
  | { kind: "grid" }
  /** `url` is what the preview shows, `pick` what gets stored. */
  | { kind: "preview"; url: string; pick: string; family: FamilyId };

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
}) {
  const [step, setStep] = useState<Step>({ kind: "grid" });
  // the cover it gets on its own first, then every other family that can carry its name
  const own = coverSpec(playlistId, playlistName);
  const families = [own.family, ...coverFamilies(own.titles).filter((f) => f !== own.family)];
  const drawnUrl = (family: FamilyId, size: number) => playlistArtCoverUrl({ id: playlistId, name: playlistName }, { absolute: false, size, family });

  return (
    <DialogTrigger
      defaultOpen={defaultOpen}
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) setStep({ kind: "grid" });
        onOpenChange?.(open);
      }}
    >
      <AriaButton className={triggerClassName ? `${styles.triggerReset} ${triggerClassName}` : styles.triggerReset} aria-label={triggerLabel}>
        {trigger}
      </AriaButton>
      <Modal
        title="Choose a cover"
        subtitle="Drawn for this playlist"
        size="lg"
      >
        {({ close }) => (
          <div className={styles.body}>
            {step.kind === "grid" && (
              <div className={styles.scroll}>
                <div className={styles.grid}>
                  {families.map((family) => (
                    <button
                      key={family}
                      type="button"
                      className={styles.tile}
                      onClick={() => setStep({ kind: "preview", url: drawnUrl(family, 600), pick: drawnPickUrl(playlistId, family), family })}
                      aria-label={`${family} cover`}
                    >
                      <LiveCover id={playlistId} name={playlistName} family={family} mode="hover">
                        <img src={drawnUrl(family, 300)} alt="" loading="lazy" className={styles.tileImg} />
                      </LiveCover>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step.kind === "preview" && (
              <div className={styles.previewWrap}>
                <div className={styles.preview}>
                  <LiveCover id={playlistId} name={playlistName} family={step.family} mode="visible">
                    <img src={step.url} alt="" className={styles.previewImg} />
                  </LiveCover>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.cancel} onClick={() => setStep({ kind: "grid" })}>
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.confirm}
                    onClick={() => {
                      onCoverChosen(step.pick);
                      close();
                      setStep({ kind: "grid" });
                    }}
                  >
                    Use this cover
                  </button>
                </div>
              </div>
            )}

          </div>
        )}
      </Modal>
    </DialogTrigger>
  );
}

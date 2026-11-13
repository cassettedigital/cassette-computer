"use client";

/**
 * Your saved stations in the Mac app (the founder, 2026-10-29: save a station the phone's way, with Save
 * beside Tune in). The page comes with the list (desk data, read fresh on every load); once the radio
 * provider has the signed-in person's own list, that one leads, so a station saved or taken back here
 * shows in the sidebar and in Radio's order at once. Saving goes through the provider's `toggleSaved`:
 * the same follow the phones and the website write.
 */

import { useMemo } from "react";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { useSavedOrder } from "@/app/components/radio/RadioDial";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useDesk } from "./DeskShell";

/** The saved stations' slugs, the newest saved first (the Radio page's own rule, components/radio/RadioDial). */
export function useSavedStations(): string[] {
  return useSavedOrder(useDesk().saved);
}

/** Whether a station is saved, and the press that saves it or takes it back. */
export function useStationSave(): { isSaved: (slug: string) => boolean; toggle: (slug: string) => void } {
  const saved = useSavedStations();
  const { toggleSaved } = useRadio();
  const { showToast } = useShell();
  return useMemo(
    () => ({
      isSaved: (slug: string) => saved.includes(slug),
      toggle: (slug: string) => {
        void toggleSaved(slug, !saved.includes(slug)).then((r) => {
          if (r !== "ok") showToast("Couldn't save that station", { variant: "error" });
        });
      },
    }),
    [saved, toggleSaved, showToast],
  );
}

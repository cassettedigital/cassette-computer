"use client";

/**
 * Save for a station, drawn as the kit's save key: the outlined pill with a plus, latched on with a
 * check while saved (the artist page's Follow is the same key). Storage is the site's general follow
 * edge (the same table that holds followed artists and labels), under the word people use for music
 * they keep: Save. Saved stations are what the hub mirrors down to the phones.
 *
 * Reads its state from the radio provider's saved set (one request per page, not one per card) and
 * saves through the provider's `toggleSaved`, the one save the Mac app's station view uses too; sends a
 * signed-out viewer to sign in and back.
 */

import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { useRadio } from "@/app/components/radio/RadioProvider";

export function SaveStationKey({ station }: { station: { slug: string; name: string } }) {
  const { saved, toggleSaved } = useRadio();
  const isSaved = saved.has(station.slug);

  async function toggle() {
    if ((await toggleSaved(station.slug)) === "signed-out") {
      const dest = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/sign-in?callbackUrl=${dest}`;
    }
  }

  return (
    <Button
      look="outlined"
      icon={<Icon name={isSaved ? "check" : "plus"} size={14} />}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Saved ${station.name}` : `Save ${station.name}`}
      onClick={() => void toggle()}
    >
      {isSaved ? "Saved" : "Save"}
    </Button>
  );
}

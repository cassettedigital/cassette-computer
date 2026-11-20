"use client";

/**
 * Save for a station, drawn as the kit's save key: the outlined pill with a bookmark, filled in while saved (the
 * founder, 2026-11-19: never swapped for a check). In a row short of room it gives up its word and keeps the
 * bookmark, as the artist page's Follow keeps its plus (ActionRow's "word" step). Storage is the site's general follow
 * edge (the same table that holds followed artists and labels), under the word people use for music
 * they keep: Save. Saved stations are what the hub mirrors down to the phones.
 *
 * Reads its state from the radio provider's saved set (one request per page, not one per card) and
 * saves through the provider's `toggleSaved`, the one save the Mac app's station view uses too; sends a
 * signed-out viewer to sign in and back.
 */

import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { Say } from "@/app/_taste/Say";
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
    // the bookmark beside the word, filled once saved (never swapped for a check); in a row short of
    // room the word goes and the bookmark stays (ActionRow's "word" step, as Follow gives up its word for its plus)
    <Button
      look="outlined"
      data-give="word"
      icon={<Icon name="bookmark" filled={isSaved} size={14} />}
      aria-pressed={isSaved}
      aria-label={isSaved ? `Saved ${station.name}` : `Save ${station.name}`}
      onClick={() => void toggle()}
    >
      <Say whole={isSaved ? "Saved" : "Save"} />
    </Button>
  );
}

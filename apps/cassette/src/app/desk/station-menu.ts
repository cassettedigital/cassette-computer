"use client";

/**
 * One menu for a station in the Mac app, wherever it is right-clicked or opened from "…": the side view,
 * the sidebar, and Radio's cards and rows. Tune in and Save, then the station's own places, its website and
 * where to support it (the founder, 2026-10-29: "easy to access but out of the way"; a station's about text
 * stays hidden, "if they want to read about it, they can go to the internet"), then Radio. The phone's
 * station page carries the same lines in its own "…" menu.
 */

import { useRouter } from "next/navigation";
import type { MenuItem } from "@discovery/cassette-kit";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useDesk } from "./DeskShell";
import { useOnline } from "./network";
import { useStationSave } from "./saved-stations";
import { openOutside } from "@/lib/open-outside";
import { DESK } from "./types";


/** "kexp.org" for https://www.kexp.org/ */
const siteOf = (href: string): string => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return "its website";
  }
};

/** The menu for one station, by slug. */
export function useStationMenu(): (slug: string) => MenuItem[] {
  const router = useRouter();
  const radio = useRadio();
  const online = useOnline();
  const { showToast } = useShell();
  const save = useStationSave();
  const { stations } = useDesk();
  return (slug: string) => {
    const s = stations.find((x) => x.slug === slug);
    const on = radio.isCurrent(slug) && radio.status !== "idle";
    const places: MenuItem[] = [];
    if (s?.homepage) places.push({ label: `Go to ${siteOf(s.homepage)}`, onSelect: () => openOutside(s.homepage!) });
    if (s?.supportUrl) places.push({ label: `Support ${s.name}`, onSelect: () => openOutside(s.supportUrl!) });
    return [
      { label: on ? "Stop" : "Tune in", onSelect: () => (online || on ? radio.toggle(slug) : showToast("Radio needs the internet")), disabled: !online && !on },
      { label: save.isSaved(slug) ? "Remove from your stations" : "Save", onSelect: () => save.toggle(slug) },
      ...(places.length ? (["separator", ...places] as MenuItem[]) : []),
      "separator",
      { label: "Open Radio", onSelect: () => router.push(`${DESK}/radio`) },
    ];
  };
}

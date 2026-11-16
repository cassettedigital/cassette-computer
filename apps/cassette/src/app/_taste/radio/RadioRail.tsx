"use client";

/**
 * The radio in the website's right rail: the Mac app's side view with a station in it (the founder,
 * 2026-11-16: "we should make an effort to unify these"). The column itself is the desk's (its head with the
 * kit's switch, "…" and Close; the station under it, scrolling in itself), and what's in it is the one shared
 * station view (components/radio/StationSide), the desk's own drawing. It shows on any page in the taste
 * frame while a station is tuned, on a window wide enough for the rail; the page steps aside for it as it
 * does for the preview player's, and a preview takes the rail over (one sound at a time: starting one stops
 * the radio anyway). Narrower, and on pages outside the frame, the corner dock (RadioDock) keeps playing it;
 * it reads useRadioInRail to stay out of the way while this shows.
 *
 * What differs from the desk is only what a click does on the website: a song we carry goes to its record's
 * page (one we don't, to a search for it), the station's name and a station like it to their pages; the
 * station's website and where to support it are in "…", as in the app.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { forwardRef, useEffect, type AnchorHTMLAttributes, type CSSProperties, type RefObject } from "react";
import { Glyph, KitProvider, Pills, PlayPill, SavePill, Segmented, tokens as kit, useContextMenu, type KitLinkProps, type MenuItem } from "@discovery/cassette-kit";
import { useRailWide } from "@/app/_taste/PlayerDock";
import { usePlayerMaybe } from "@/app/_taste/player";
import { accentVars, useCoverAccent } from "@/app/_taste/colour";
import { albumHref } from "@/app/_taste/links";
import { AlbumCover } from "@/app/components/AlbumCover";
import { useRadioNow } from "@/app/components/radio/RadioProvider";
import { setRadioInRail } from "@/app/components/radio/rail-claim";
import { StationSide, useStationPage, type SideSong } from "@/app/components/radio/StationSide";
import { inPanelFrame } from "@/lib/app-surface";
import r from "./rail.module.css";

const KitLink = forwardRef<HTMLAnchorElement, KitLinkProps>(function KitLink({ href, ...rest }, ref) {
  return <Link ref={ref} href={href} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
});

/** A song we don't carry, looked for (the desk's way: "Look for it on Cassette"). */
const searchFor = (x: SideSong) => `/search?q=${encodeURIComponent(`${x.artist} ${x.title}`.slice(0, 80))}`;

const outside = (href: string) => window.open(href, "_blank", "noopener");

export function RadioRail({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const radio = useRadioNow();
  const router = useRouter();
  const player = usePlayerMaybe();
  const wide = useRailWide();
  const { station, status } = radio;
  // in the account window's side panel the window plays the radio and shows it, never the page
  const on = !!station && status !== "idle" && wide && !player?.track && !inPanelFrame();
  const heard = on ? radio.nowPlaying?.track : null;
  const page = useStationPage(on ? station!.slug : null, heard ? `${heard.artist}\u0000${heard.title}` : null);
  // the station's colour from its mark, as the desk tints its side view (desk/Player useTint)
  const accent = useCoverAccent(on ? station!.image : null);
  const cm = useContextMenu();

  useEffect(() => {
    setRadioInRail(on);
    return () => setRadioInRail(false);
  }, [on]);

  // the page steps aside for the rail, as it does for the preview player's
  useEffect(() => {
    const root = rootRef.current;
    if (!on || !root) return;
    root.setAttribute("data-rail", "");
    return () => root.removeAttribute("data-rail");
  }, [on, rootRef]);

  if (!on || !station) return null;

  const paper = accentVars(accent) as Record<string, string>;
  const tint = { ...paper, "--pk-tint-text": paper["--accent-ink"], "--pk-tint-glow": accent } as CSSProperties;
  // where it's from, as the desk's line says it: its network where that isn't its name, its city, Live
  const kicker = [station.sourceLabel !== station.name ? station.sourceLabel : null, station.cityLabels[0], station.kind === "station" ? "Live" : null]
    .filter(Boolean)
    .join(" · ");
  const saved = radio.saved.has(station.slug);
  const save = async () => {
    if ((await radio.toggleSaved(station.slug, !saved)) === "signed-out") {
      router.push(`/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  };
  const menu: MenuItem[] = [
    { label: `Go to ${station.name}'s page`, onSelect: () => router.push(`/radio/${station.slug}`) },
    ...(station.homepage ? [{ label: `${station.name}'s website`, onSelect: () => outside(station.homepage!) }] : []),
    ...(station.supportUrl ? [{ label: `Support ${station.name}`, onSelect: () => outside(station.supportUrl!) }] : []),
    "separator",
    { label: "Stop", onSelect: radio.stop },
  ];

  return (
    <KitProvider link={KitLink}>
      <aside className={`${kit.kit} ${kit.follow} ${r.aside}`} aria-label="Radio">
        <div className={r.head}>
          <Segmented<"station"> label="Show" value="station" onChange={() => {}} options={[["station", "Station"]]} />
          <span className={r.keys}>
            <button type="button" className={r.key} aria-label="More" title="More" onClick={(e) => cm.open(e, menu)}>
              <Glyph name="more" size={16} />
            </button>
            <button type="button" className={r.key} aria-label="Stop the radio" title="Stop the radio" onClick={radio.stop}>
              <Glyph name="close" size={16} />
            </button>
          </span>
          {cm.menu}
        </div>
        <div className={r.body}>
          <StationSide
            style={tint}
            station={{ slug: station.slug, name: station.name, image: station.image, accent: station.accent, kicker }}
            page={page}
            live={radio.nowPlaying ?? page?.live ?? null}
            titleHref={`/radio/${station.slug}`}
            keys={
              <>
                <Pills>
                  {status === "error" ? (
                    <PlayPill state="play" word="Try again" onClick={() => radio.play(station.slug)} />
                  ) : (
                    <PlayPill state="stop" word={status === "connecting" ? "Tuning in" : "Stop"} onClick={radio.stop} />
                  )}
                  <SavePill saved={saved} onClick={() => void save()} />
                </Pills>
                {status === "error" && <p className={r.note}>{station.name} isn&apos;t answering right now.</p>}
              </>
            }
            picture={(src, px, opts) => <AlbumCover bare imageUrl={src} title="" size={px} sizes={`${px}px`} priority={opts?.priority} />}
            songHit={(x) =>
              x.match
                ? { href: albumHref(x.match.albumSlug), label: `See ${x.match.title} on Cassette` }
                : { href: searchFor(x), label: `Look for ${x.title} on Cassette` }
            }
            stationHit={(x) => ({ href: `/radio/${x.slug}`, label: `Go to ${x.name}` })}
          />
        </div>
      </aside>
    </KitProvider>
  );
}

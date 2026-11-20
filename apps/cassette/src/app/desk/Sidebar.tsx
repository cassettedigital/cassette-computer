"use client";

/**
 * The rail: where you are, what's on, and everything you keep, one click from playing.
 *
 *   top       the mark, and the key that folds the rail to its icons (it remembers)
 *   search    a key that opens the search at the top of the page, results coming in as you type
 *             ("/" or Cmd-K from anywhere), with your account beside it (2026-10-22)
 *   places    Home, Albums, Artists, Playlists, Radio, Devices: names only (counts and a connected
 *             line were noise). Radio names the station that's on.
 *   library   your playlists, your stations and the records you've played lately, as rows with their
 *             art (a desktop player's library, not a list of words). The kit's switch along its head
 *             filters it; under the pointer the art becomes a play key; what's playing wears the bars;
 *             a click looks into it in the side view; a right click opens its menu. It runs to the
 *             rail's foot and scrolls on its own.
 *
 * Folded, the rail keeps the fold key, the search key, the icons and the library's art, each where it
 * was (the mark and the account step aside), with names as tooltips. A newer Mac app shows beside the
 * window's own buttons, above all of it (WindowUpdate). No rules between anything; the
 * place you're on is a lit row.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { LogoMark } from "@/app/_taste/Brand";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { useOwned } from "./owned";
import { Glyph, Place, Places, Segmented, TransportGlyph, useContextMenu, Waveform, WordArt, type Concept, type MenuItem } from "@discovery/cassette-kit";
import { playlistPlayed, playlistSongs } from "./playlists";
import { Art, albumCovers } from "./Art";
import { useListening } from "./listening";
import { useAside, useDesk, useDeskAccount, type Look } from "./DeskShell";
import { useSavedStations } from "./saved-stations";
import { useStationMenu } from "./station-menu";
import { signOut } from "@/lib/sign-out";
import { feedbackMenuItem } from "@/app/components/feedback-door";
import { AvatarDisc } from "@/app/components/AvatarDisc";
import { useDesktopUpdate } from "@/app/components/UpdatePill";
import type { DeskAccount } from "./DeskShell";
import { usePlaylistDrop } from "./Rail";
import { useStartRecord } from "./Player";
import { useQueueLines, useRecordMenu } from "./Shelves";
import { useOnline } from "./network";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { DESK, deskAlbum, deskPlaylist, type OwnedTrack } from "./types";
import { inDesktopApp, openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { DiscRow } from "./disc";
import d from "./desk.module.css";

/** A place on the rail (the kit's), lit while you're on its page, or one under it unless it's exact. */
function RailPlace({ href, label, glyph, live, exact }: { href: string; label: string; glyph: Concept; live?: ReactNode; exact?: boolean }) {
  const path = usePathname();
  const on = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return <Place href={href} label={label} glyph={<Glyph name={glyph} size={15} />} current={on} live={live} />;
}

type Kind = "all" | "playlist" | "station" | "record";
type Item = {
  key: string;
  kind: Exclude<Kind, "all">;
  title: string;
  line: string;
  /** a click looks into it in the side view; a double click opens it (its page, or tunes in) */
  look: Look;
  open: () => void;
  /** a playlist takes songs dragged out of the side view */
  playlist?: { id: string; name: string };
  art: ReactNode;
  /** this item's music is what's on now */
  on: boolean;
  live: boolean;
  play: () => void;
  menu: MenuItem[];
};

const KIND_WORD: Record<Exclude<Kind, "all">, string> = { playlist: "Playlist", station: "Station", record: "Album" };
const FILTER_KEY = "desk-taste-rail-filter";

/** One row of the library, by the window's one rule (2026-11-06): the art selects it (the side view shows
    it), the name opens its page (a station, which has none, is selected), the play symbol at the row's end
    plays it; folded to its icons, the art selects. A playlist row takes songs dragged onto it from the side
    view. */
function LibraryRow({ i, slim, kindWord, onMenu }: { i: Item; slim: boolean; kindWord: string | null; onMenu: (e: MouseEvent) => void }) {
  const aside = useAside();
  const drop = usePlaylistDrop(i.playlist ?? { id: "", name: "" });
  const dropping = i.playlist ? { onDragEnter: drop.onDragEnter, onDragOver: drop.onDragOver, onDragLeave: drop.onDragLeave, onDrop: drop.onDrop } : {};
  return (
    <li className={d.libItem} data-on={i.on || undefined} data-look={aside.showing(i.look) || undefined} data-drop={(i.playlist && drop.over) || undefined} onContextMenu={onMenu} {...dropping}>
      <button type="button" className={d.libArt} data-kind={i.kind} aria-label={`Show ${i.title}`} onClick={() => aside.select(i.look)} title={slim ? i.title : undefined}>
        {i.art}
        {i.on && (
          <span className={d.libArtKey} aria-hidden="true">
            <Waveform live={i.live} />
          </span>
        )}
      </button>
      {!slim && (
        <>
          <span className={d.libText}>
            <button type="button" className={d.libTitle} onClick={() => (i.kind === "station" ? aside.select(i.look) : i.open())}>
              {i.title}
            </button>
            <span className={d.libLine}>
              {kindWord ? `${kindWord} · ` : ""}
              {i.line}
            </span>
          </span>
          <button type="button" className={d.libPlay} aria-label={i.on && i.live ? `Pause ${i.title}` : `Play ${i.title}`} onClick={i.play}>
            <TransportGlyph name={i.on && i.live ? (i.kind === "station" ? "stop" : "pause") : "play"} size={13} />
          </button>
        </>
      )}
    </li>
  );
}

/**
 * The account, beside the search key: the avatar opens the desk's own menu (the kit's, as every menu
 * here is, kept inside the window), not the old library's pop-up. The same places as every rail's
 * account menu: the other workspaces you can go to, then the desk's settings, then Feedback (the one door every
 * menu shares, components/feedback-door) and signing out. The artist
 * studio lives on the website, so it opens in the browser rather than in a window that can't draw it.
 */
function AccountKey({ account }: { account: DeskAccount & { studioLabel?: string } }) {
  const router = useRouter();
  const cm = useContextMenu();
  // isCreator: anyone Studio lets in (an artist, a writer, a site admin); studioLabel: "Studio" for everyone
  const { user, isCreator, isAdmin, studioLabel = "Studio" } = account;
  const name = user.name?.trim() || user.email?.split("@")[0] || "Account";
  const items: MenuItem[] = [
    ...(user.email ? ([{ caption: user.email }] as MenuItem[]) : []),
    // the website opens Studio in place; only the desktop app, which can't draw it, hands it to the browser
    ...(isCreator ? ([{ label: studioLabel, onSelect: () => (inDesktopApp() ? openOutside(`${PUBLIC_SITE_URL}/studio`) : router.push("/studio")) }] as MenuItem[]) : []),
    ...(isAdmin ? ([{ label: "Admin", onSelect: () => (inDesktopApp() ? openOutside(`${PUBLIC_SITE_URL}/admin/pipeline`) : router.push("/admin/pipeline")) }] as MenuItem[]) : []),
    ...(isCreator || isAdmin ? (["separator"] as MenuItem[]) : []),
    { label: "Account", onSelect: () => router.push(`${DESK}/settings/account`) },
    { label: "Appearance", onSelect: () => router.push(`${DESK}/settings/appearance`) },
    { label: "Purchases", onSelect: () => router.push(`${DESK}/settings/purchases`) },
    { label: "Hidden", onSelect: () => router.push(`${DESK}/settings/hidden`) },
    "separator",
    feedbackMenuItem(),
    { label: "Sign out", onSelect: signOut },
  ];
  return (
    <span className={d.accountKey}>
      <button type="button" className={d.avatarKey} aria-label={`Account menu for ${name}`} title={name} onClick={(e) => cm.open(e, items)}>
        <AvatarDisc image={user.image} preset={user.avatarPreset} name={user.name} email={user.email} size={30} />
      </button>
      {cm.menu}
    </span>
  );
}

/**
 * A newer Mac app, beside the window's own buttons (close, minimise, zoom), in their line, the same
 * place open or folded (the founder, 2026-10-27; BUG-584: beside the account it squeezed the search
 * key off the window's edge, and folded it wasn't there at all). One click installs it and the app
 * restarts. Nothing while the app is current, or on the web. The window holds the check
 * (DeskShell), so the toolbar can step aside for it when the rail is folded.
 */
export function WindowUpdate({ version, installing, install }: ReturnType<typeof useDesktopUpdate>) {
  if (!version) return null;
  return (
    <button
      type="button"
      className={d.winUpdate}
      onClick={() => void install()}
      disabled={installing}
      data-installing={installing || undefined}
      aria-label={installing ? "Updating Cassette" : `Update to ${version}`}
      title={installing ? "Updating Cassette…" : `Cassette ${version} is ready. Installing it restarts the app.`}
    >
      <span className={d.updateDot} aria-hidden="true" />
      <span>{installing ? "Updating…" : "Update"}</span>
    </button>
  );
}

function Library({ slim }: { slim: boolean }) {
  const data = useDesk();
  const radio = useRadio();
  const savedStations = useSavedStations();
  const stationMenu = useStationMenu();
  const recordMenu = useRecordMenu();
  const queue = useQueueLines();
  const { track, status, playList, toggle } = useOwned();
  const { recent } = useListening();
  const st = useStartRecord();
  const router = useRouter();
  const cm = useContextMenu();
  const online = useOnline();
  const { showToast } = useShell();
  const [kind, setKind] = useState<Kind>("all");
  useEffect(() => {
    try {
      const k = localStorage.getItem(FILTER_KEY) as Kind | null;
      if (k === "playlist" || k === "station" || k === "record") setKind(k);
    } catch {}
  }, []);
  const pick = (k: Kind) => {
    setKind(k);
    try {
      localStorage.setItem(FILTER_KEY, k);
    } catch {}
  };
  const playing = status === "playing";
  const items = useMemo<Item[]>(() => {
    const playlists: Item[] = data.playlists.map((p) => ({
      key: `p-${p.id}`,
      kind: "playlist",
      title: p.name,
      line: `${p.songs} ${p.songs === 1 ? "song" : "songs"}`,
      look: { kind: "playlist", id: p.id },
      open: () => router.push(deskPlaylist(p.id)),
      playlist: { id: p.id, name: p.name },
      art: p.cover ? <Art src={p.cover} sizes="40px" size={40} /> : <WordArt name={p.name} accent="#6B5A44" />,
      on: false,
      live: false,
      play: async () => {
        const list = await playlistSongs(p.id).catch(() => [] as OwnedTrack[]);
        if (list.length) {
          playList(list, 0);
          playlistPlayed(p.id);
        } else router.push(deskPlaylist(p.id));
      },
      menu: [
        { label: "Play", onSelect: () => void playlistSongs(p.id).then((l) => l.length && (playList(l, 0), playlistPlayed(p.id))) },
        ...queue(() => playlistSongs(p.id)),
        "separator",
        { label: "Open the playlist", onSelect: () => router.push(deskPlaylist(p.id)) },
      ],
    }));
    const stations: Item[] = savedStations
      .map((slug) => data.stations.find((s) => s.slug === slug))
      .filter((s): s is (typeof data.stations)[number] => !!s)
      .map((s) => {
        const on = radio.isCurrent(s.slug) && radio.status !== "idle";
        return {
          key: `s-${s.slug}`,
          kind: "station",
          title: s.name,
          line: s.kicker,
          look: { kind: "station", slug: s.slug },
          open: () => (online || on ? radio.toggle(s.slug) : showToast("Radio needs the internet")),
          art: s.image ? <Art src={s.image} sizes="40px" size={40} /> : <WordArt name={s.name} accent={s.accent} />,
          on,
          live: on && radio.status === "playing",
          play: () => (online || on ? radio.toggle(s.slug) : showToast("Radio needs the internet")),
          menu: stationMenu(s.slug),
        };
      });
    const records: Item[] = recent.slice(0, 8).map((a) => {
      const on = track?.albumKey === a.key;
      return {
        key: `r-${a.key}`,
        kind: "record",
        title: a.title,
        line: a.artist,
        look: { kind: "record", key: a.key },
        open: () => router.push(deskAlbum(a)),
        art: <Art src={albumCovers(a, 40)} sizes="40px" size={40} />,
        on,
        live: on && playing,
        play: () => (on ? toggle() : void st.start(a.key)),
        menu: recordMenu(a, { play: [{ label: on ? (playing ? "Pause" : "Resume") : "Play", onSelect: () => (on ? toggle() : void st.start(a.key)) }] }),
      };
    });
    return [...playlists, ...stations, ...records];
  }, [data, savedStations, stationMenu, recent, radio, track, playing, playList, toggle, st, router, recordMenu, queue, online, showToast]);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const kinds = (["playlist", "station", "record"] as const).filter((k) => items.some((i) => i.kind === k));

  return (
    <section className={d.library} aria-label="Your library">
      {/* no heading of its own: the switch over the list says what it holds (the founder, 2026-10-22) */}
      {!slim && kinds.length > 1 && (
        <div className={d.libHead}>
          {/* the kit's switch: one lit at a time, and pressing the lit one again shows everything */}
          <Segmented<Exclude<Kind, "all">>
            label="Show only"
            size="small"
            clearable
            fill
            narrow={{ playlist: <Glyph name="playlist" size={13} />, station: <Glyph name="radio" size={13} />, record: <Glyph name="album" size={13} /> }}
            value={kind === "all" ? null : kind}
            onChange={(k) => pick(k ?? "all")}
            options={kinds.map((k) => [k, `${KIND_WORD[k]}s`])}
          />
        </div>
      )}
      <ul className={d.libList}>
        {shown.map((i) => (
          <LibraryRow key={i.key} i={i} slim={slim} kindWord={kind === "all" ? KIND_WORD[i.kind] : null} onMenu={(e) => cm.open(e, i.menu)} />
        ))}
      </ul>
      {cm.menu}
    </section>
  );
}

export function Sidebar({ slim, onSlim }: { slim: boolean; onSlim: (v: boolean) => void }) {
  const { offline: drawnOffline } = useDesk();
  const account = useDeskAccount();
  // offline when the window was drawn from the kept copy, or when the network has gone since
  const online = useOnline();
  const offline = drawnOffline || !online;
  const radio = useRadio();
  const router = useRouter();

  // "/" or Cmd/Ctrl-K (or Cmd-F) from anywhere that isn't a text field opens the search, at the top
  // of the page; the search page listens for "desk:find" to put the cursor in its field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.key === "/" && !typing) || (["k", "f"].includes(e.key.toLowerCase()) && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey)) {
        e.preventDefault();
        if (window.location.pathname !== `${DESK}/search`) router.push(`${DESK}/search`);
        window.dispatchEvent(new Event("desk:find"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const tuned = radio.station && radio.status !== "idle" ? radio.station : null;

  return (
    <nav className={d.side} aria-label="Library" data-slim={slim || undefined}>
      {/* in the Mac app's window: the room the window's buttons sit in, which moves the window */}
      <div className={d.sideBand} data-tauri-drag-region aria-hidden="true" />
      <div className={d.sideTop} data-tauri-drag-region="deep">
        {/* folded, the mark steps aside for the fold key, so nothing below moves */}
        {!slim && (
          <Link href={DESK} className={d.brand} title="Home">
            <LogoMark className={d.brandMark} />
            <span>Cassette</span>
          </Link>
        )}
        <button type="button" className={d.foldKey} aria-label={slim ? "Open the sidebar" : "Fold the sidebar"} title={slim ? "Open the sidebar" : "Fold the sidebar"} onClick={() => onSlim(!slim)}>
          <Glyph name="chevronRight" size={13} className={slim ? undefined : d.flip} />
        </button>
      </div>
      {/* no internet: the window is the copy kept on this Mac; the music still plays from it. Its own
          line under the name, so the name never gives up its room */}
      {offline && (
        <p className={d.offlineMark} title="No internet. Your music still plays from this computer.">
          Offline
        </p>
      )}

      {/* search is a key that opens the search at the top of the page (results come in as you type
          there), with your account beside it; folded, the key alone, in the same place */}
      <div className={d.sideFind}>
        {/* a link, so the shipped app has the search page ready before the click (prefetched) and a
            click always goes; on the search page it only puts the cursor back in the field */}
        <Link
          href={`${DESK}/search`}
          className={slim ? d.findKey : d.find}
          aria-label="Search (⌘K)"
          title="Search (⌘K)"
          onClick={(e) => {
            if (window.location.pathname === `${DESK}/search`) e.preventDefault();
            window.dispatchEvent(new Event("desk:find"));
          }}
        >
          <Glyph name="search" size={slim ? 15 : 14} />
          {!slim && <span>Search</span>}
        </Link>
        {!slim && account && <AccountKey account={account} />}
      </div>

      <Places folded={slim}>
        <RailPlace href={DESK} label="Home" glyph="home" exact />
        <RailPlace href={`${DESK}/albums`} label="Albums" glyph="album" />
        <RailPlace href={`${DESK}/artists`} label="Artists" glyph="artist" />
        <RailPlace href={`${DESK}/playlists`} label="Playlists" glyph="playlist" exact />
        <RailPlace
          href={`${DESK}/radio`}
          label="Radio"
          glyph="radio"
          live={
            tuned ? (
              <>
                <Waveform live={radio.status === "playing"} />
                {tuned.name}
              </>
            ) : undefined
          }
        />
        <RailPlace href={`${DESK}/devices`} label="Devices" glyph="laptop" />
      </Places>

      {/* a disc in the drive: one row, only while it's in (desk/disc.tsx) */}
      <DiscRow slim={slim} />

      <Library slim={slim} />
    </nav>
  );
}

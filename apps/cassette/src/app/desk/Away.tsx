"use client";

/**
 * The account's home on the website: what /desk is in a regular browser, where the masthead's Library goes and
 * where a brand-new account lands. Their music is files on their own computer, played by it, and the website
 * never reaches into that computer (lib/hub-origin, the founder 2026-10-22 and 2026-10-29), so the page doesn't
 * pretend to hold the library. It is a home away from home (the founder, 2026-11-08: "the goal for a new account
 * is get them into the app", and "ensure the user can DO things in their account"), in this order:
 *
 *   1. Getting the app, first and biggest until a computer is paired: the download for the computer this page is
 *      open on (the brand rule: platform names on download keys only), what it needs, and the other apps.
 *   2. What's theirs that the website can show: the records on their shelf (each one's page is here; the music
 *      plays in the app) and their radio stations, which play right here.
 *   3. Their account: who they are, Settings, Appearance, Purchases, Sign out, and Studio and Admin when the
 *      Studio door lets them in or they run the site (the same rule as every menu: desk/layout's flags).
 *   4. Around Cassette: Discover, Radio, Guides, Help, what I believe, for artists.
 *
 * Drawn on the website's page frame (masthead, account menu, footer) from the taste kit's parts. Only on the web:
 * inside the desktop app a missed answer from the Mac is a blip, said in the side view, and the window stays
 * (DeskShell's Where never draws this there). The site flow audit, 2026-11-08.
 */

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { PageFrame, PageHead } from "@/app/_taste/PageFrame";
import { SectionHead } from "@/app/_taste/SectionHead";
import { ArrowLink, buttonClass } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { Doors, type Door } from "@/app/_taste/Doors";
import { RecordGrid, type RecordTile } from "@/app/_taste/RecordGrid";
import { StationCard, StationGrid } from "@/app/_taste/radio/StationCard";
import { AvatarDisc } from "@/app/components/AvatarDisc";
import t from "@/app/_taste/taste.module.css";
import { RELEASE, type PlatformRelease } from "@/config/release";
import { signOut } from "@/lib/sign-out";
import { useDesk, useDeskAccount, type DeskAccount } from "./DeskShell";
import type { DeskAlbum, DeskData, DeskStation } from "./types";
import a from "./away.module.css";

/* ── the app for this computer ── */

type Out = PlatformRelease & { downloadUrl: string };
/** The computer apps with a real build to hand out (config/release.ts), in its order. */
const DESKTOP: Out[] = [RELEASE.macos, RELEASE.windows].filter(
  (r): r is Out => r.status === "available" && r.downloadUrl !== null,
);

type System = "macos" | "windows" | "phone" | "other";

function thisComputer(): System {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const ua = nav.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(ua) || (/mac/.test(ua) && nav.maxTouchPoints > 1)) return "phone";
  const os = (nav.userAgentData?.platform || nav.platform || ua).toLowerCase();
  if (os.includes("win")) return "windows";
  if (os.includes("mac")) return "macos";
  return "other";
}

const noChange = () => () => {};

function useSystem(): System {
  return useSyncExternalStore(noChange, thisComputer, (): System => "other");
}

function DownloadKey({ r, look }: { r: Out; look: "filled" | "outlined" }) {
  return (
    <a className={buttonClass(look)} href={r.downloadUrl}>
      Download for {r.label}
      {look === "filled" && <Icon name="arrow" />}
    </a>
  );
}

/** The first thing on the page until a computer is paired: the app, for the computer this page is open on. */
function GetTheApp() {
  const system = useSystem();
  const mine = DESKTOP.find((r) => r.platform === system) ?? null;
  const rest = DESKTOP.filter((r) => r !== mine);
  return (
    <section className={a.app} aria-labelledby="home-app">
      <SectionHead id="home-app">Get the app</SectionHead>
      {system === "phone" ? (
        <p className={a.say}>
          Cassette runs on your computer, where your music is. Open cassette.digital there, sign in, and download it
          from this page.
        </p>
      ) : (
        <p className={a.say}>
          Cassette plays the music on your own computer. The app finds the albums already there, and every record
          comes with its page.
        </p>
      )}
      {system !== "phone" && (
        <div className={a.keys}>
          {mine && <DownloadKey r={mine} look="filled" />}
          {rest.map((r) => (
            <DownloadKey key={r.platform} r={r} look="outlined" />
          ))}
        </div>
      )}
      {mine?.requirement && <p className={a.needs}>{mine.requirement}</p>}
      {mine?.note && <p className={a.note}>{mine.note}</p>}
      <div className={a.links}>
        <ArrowLink href="/apps">Every app, and the phones</ArrowLink>
        <ArrowLink href="/help/getting-the-apps">How setting up works</ArrowLink>
      </div>
    </section>
  );
}

/* ── what's theirs ── */

const SHELF_SIZE = 12;

/** Their records the website can show a page for: the ones played lately first, then the ones that arrived last. */
function shelfTiles(d: DeskData): RecordTile[] {
  const byKey = new Map(d.shelf.map((al) => [al.key, al]));
  const picked: DeskAlbum[] = [];
  const seen = new Set<string>();
  const take = (al: DeskAlbum | undefined) => {
    if (!al || !al.slug || seen.has(al.key) || picked.length >= SHELF_SIZE) return;
    seen.add(al.key);
    picked.push(al);
  };
  [...d.plays].sort((x, y) => y.at - x.at).forEach((p) => take(byKey.get(p.key)));
  [...d.shelf].sort((x, y) => (y.added ?? "").localeCompare(x.added ?? "")).forEach(take);
  return picked.map((al) => ({
    slug: al.slug as string,
    title: al.title,
    // their own pick of cover first, as the app shows it; the folder's own cover lives on their computer
    cover: al.overrideCover ?? al.catalogCover,
    meta: [al.artist, al.year].filter(Boolean).join(" · "),
  }));
}

function Shelf({ tiles, computer }: { tiles: RecordTile[]; computer: string }) {
  return (
    <section className={a.section} aria-labelledby="home-shelf">
      <SectionHead id="home-shelf">From your shelf</SectionHead>
      <p className={a.line}>Every record has its page here. The music plays in the app on {computer}.</p>
      <RecordGrid records={tiles} rows={2} priority={6} />
    </section>
  );
}

// the dial comes with the window's own data (from the cloud in the app), so no station list is kept here
function Stations({ d }: { d: DeskData }) {
  const lookup = (slug: string) => d.stations.find((s) => s.slug === slug);
  const saved = d.saved.map(lookup).filter((s): s is DeskStation => !!s);
  const theirs = saved.length > 0;
  const shown = theirs ? saved.slice(0, 6) : d.stations.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <section className={a.section} aria-labelledby="home-radio">
      <SectionHead id="home-radio" trail={<ArrowLink href="/radio">All stations</ArrowLink>}>
        {theirs ? "Your stations" : "Put a station on"}
      </SectionHead>
      <p className={a.line}>Real stations, live. They play right here in your browser.</p>
      <StationGrid wholeRows>
        {shown.map((s) => (
          <StationCard key={s.slug} station={s} />
        ))}
      </StationGrid>
    </section>
  );
}

/* ── their account ── */

function Account({ account, paired }: { account: DeskAccount | null; paired: boolean }) {
  if (!account) return null;
  const { user, isCreator: studio, isAdmin } = account;
  const shown = user.name?.trim() || user.email?.split("@")[0] || "Your account";
  const doors: Door[] = [
    ...(studio ? [{ href: "/studio", name: "Studio", line: "Your artist pages, releases and writing." }] : []),
    ...(isAdmin ? [{ href: "/admin/pipeline", name: "Admin", line: "The catalog, the people and the journal's inbox." }] : []),
    { href: "/settings", name: "Name, photo and password", line: "How you appear, and how you sign in." },
    { href: "/settings/appearance", name: "Appearance", line: "Light, dark or your device's setting, and your colours." },
    { href: "/settings/purchases", name: "Purchases", line: "Records you bought here, ready to download again." },
    ...(paired ? [{ href: "/apps", name: "Apps", line: "Cassette on another computer, and the phones." }] : []),
  ];
  return (
    <section className={a.section} aria-labelledby="home-account">
      <SectionHead id="home-account">Your account</SectionHead>
      <div className={a.account}>
        <div className={a.who}>
          <AvatarDisc image={user.image} preset={user.avatarPreset} name={user.name} email={user.email} size={72} />
          <div className={a.whoText}>
            <p className={a.name}>{shown}</p>
            {user.email && <p className={a.email}>{user.email}</p>}
          </div>
          <div className={a.keys}>
            <Link className={buttonClass("outlined")} href="/settings">
              Settings
            </Link>
            <button type="button" className={buttonClass("outlined")} onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        </div>
        <Doors doors={doors} max={2} line="caption" />
      </div>
    </section>
  );
}

/* ── around Cassette ── */

const AROUND: Door[] = [
  { href: "/discover", name: "Discover", line: "Records worth owning, new and older, picked by how they sound." },
  { href: "/radio", name: "Radio", line: "Real stations from all over, live, by mood, decade or city." },
  { href: "/guides", name: "Guides", line: "How Cassette works, help with it, and owning your music." },
  { href: "/manifesto", name: "What I believe", line: "Paying artists, finding music, and AI." },
  { href: "/for-artists", name: "For artists", line: "Claim your page, and sell your music direct." },
];

function Around() {
  return (
    <section className={a.section} aria-labelledby="home-around">
      <SectionHead id="home-around">Around Cassette</SectionHead>
      <Doors doors={AROUND} max={3} line="caption" />
    </section>
  );
}

/* ── the page ── */

/** The desk's own entry (DeskShell's Where): the page, from the window's data and account. */
export function Away({ mac }: { mac: DeskData["mac"] }) {
  return <AwayPage mac={mac} data={useDesk()} account={useDeskAccount()} />;
}

/** The page from plain data, so a dev-only preview can draw it without a signed-in window (proto/home-away). */
export function AwayPage({ mac, data: d, account }: { mac: DeskData["mac"]; data: DeskData; account: DeskAccount | null }) {
  const name = (d.user.name || account?.user.name || "").trim().split(/\s+/)[0] || null;
  const paired = !!mac;
  const tiles = paired ? shelfTiles(d) : [];
  const [title, lede] = !mac
    ? [
        name ? `Welcome, ${name}.` : "Welcome to Cassette.",
        "Start with the app. Everything else in your account is here too.",
      ]
    : [`Your library is on ${mac.name}.`, "Open Cassette there to play it. Everything else in your account is here."];
  return (
    <PageFrame>
      <PageHead title={title} lede={lede} />
      <div className={`${t.wrap} ${a.body}`}>
        {!paired && <GetTheApp />}
        {tiles.length > 0 && <Shelf tiles={tiles} computer={mac?.name ?? "your computer"} />}
        <Stations d={d} />
        <Account account={account} paired={paired} />
        <Around />
      </div>
    </PageFrame>
  );
}

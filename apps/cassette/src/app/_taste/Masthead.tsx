"use client";

/**
 * The masthead (P12), one on every page: a pill fixed at the top of the window that slips away while you
 * scroll down the page and comes back the moment you scroll up (and stays while anything in it has the
 * focus or a search is open). The mark goes home, in the accent. A page may add its own links and its one
 * action at the pill's end (the homepage's How it works and Get in line). The search key, "/" from
 * anywhere that isn't a text field, or Cmd/Ctrl-K turns the whole pill into a search field. As you type,
 * the catalog's fast name matches (artists, albums, songs: /api/search on Typesense, through the shared
 * useTypeahead, the old nav's own source) drop in a panel under the pill (SearchPanel, on the page's own
 * paper), and a pick goes straight to its page; Enter on "Search everything" (or with nothing picked)
 * opens the full /search, the home of the deep, interpreted results. Escape, or a click anywhere else,
 * closes the matches and keeps what was typed in the field (a click in it, a letter or an arrow brings
 * them back); a second Escape clears it and puts the search away, as the close key does. A screen reader
 * hears what was found once the matches settle. The product pages leave the pill's room at the top of
 * their body, so it never covers the opener at rest.
 *
 * `account` (the artist and album pages; the founder, 2026-10-21: "it IS missing necessary functions -
 * like account/dashboard stuff, mostly") ends the pill with the live site's account functions, the same
 * ones as its nav (src/app/sections/NavAuthIsland.tsx), read from next-auth's session on the client:
 *   signed in: "Account" (/account, the website's account window: the founder 2026-11-08, it is no longer
 *     the library, whose music plays only in the app) and the round account key, the person's photo or their
 *     initial, which opens the shared Menu: their name over Account, Apps (the downloads), Studio for anyone
 *     the Studio door lets in (StudioEntry below) and Admin for an admin (the website is the only way into
 *     either), Settings (/settings) and Sign out;
 *   signed out: one quiet link to /sign-in, "Sign in" and the empty face in the key's place;
 *   loading: the signed-out shape, invisible, so nothing flashes and nothing moves when it lands.
 * The two shapes are one width ("Account" and "Sign in" are seven letters each in the mono, and the key
 * and the empty face are one size), so the pill never changes size when the session lands, either way.
 * On a phone the word goes in both, leaving the mark, search and the key or the empty face.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TransitionEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { resolveAvatar } from "@/lib/avatar";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";
import { signOut } from "@/lib/sign-out";
import { useTypeahead } from "@/lib/search/use-typeahead";
import { LogoMark } from "./Brand";
import { Icon } from "./Icon";
import { Menu, MenuGroup, MenuItem } from "./Menu";
import { SearchPanel, toHits, useSearchPreview } from "./SearchPanel";
import t from "./taste.module.css";
import s from "./masthead.module.css";

/** The person in the account key: their photo when they have one, else their initial, round. */
function Face({ image, name, email }: { image?: string | null; name?: string | null; email?: string | null }) {
  const avatar = resolveAvatar(image, null);
  if (avatar.kind === "photo") {
    // a person's own photo from wherever their account keeps it, at the image ladder's size when it is ours
    return <Picture {...picture(avatar.url, "avatar")} frame={30} className={s.face} alt="" />;
  }
  const initial = (name?.trim() || email?.trim() || "?").charAt(0).toUpperCase();
  return (
    <span className={`${s.face} ${s.initial}`} aria-hidden="true">
      {initial}
    </span>
  );
}

/** "Sign in" and the empty face: the signed-out end of the pill, and (invisible) its reserve while the session loads. */
function SignIn({ reserve }: { reserve?: boolean }) {
  const body = (
    <>
      <span className={s.word}>Sign in</span>
      <span className={s.empty}>
        <Icon name="person" size={22} />
      </span>
    </>
  );
  return reserve ? (
    <span className={s.signin} data-reserve="" aria-hidden="true">
      {body}
    </span>
  ) : (
    <a href="/sign-in" className={s.signin} aria-label="Sign in">
      {body}
    </a>
  );
}

/** The page's one action. With the account end beside it, it is for people not yet in, so it steps aside for
 *  someone signed in (the homepage's Get in line). */
function Cta({ cta, account }: { cta: { href: string; label: string }; account: boolean }) {
  const { status } = useSession();
  if (account && status === "authenticated") return null;
  return (
    <a href={cta.href} className={s.cta}>
      {cta.label}
    </a>
  );
}

/**
 * Whether the account menu offers Studio, asked once per signed-in person per visit: the Studio door's own
 * rule (GET /api/account/studio, lib/writing/studio-reads getStudioEntry), not the session's is_creator flag,
 * which can be stale and knows nothing of writers. The menu is closed while it lands, so nothing moves.
 */
const studioAsked = new Map<string, Promise<boolean>>();
function askStudio(userId: string): Promise<boolean> {
  let asked = studioAsked.get(userId);
  if (!asked) {
    asked = fetch("/api/account/studio", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ show?: boolean }>) : { show: false }))
      .then((b) => b.show === true)
      .catch(() => false);
    studioAsked.set(userId, asked);
  }
  return asked;
}

function useStudioEntry(userId: string | undefined): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void askStudio(userId).then((v) => {
      if (live) setShow(v);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  return show;
}

/** The pill's account end: Account and the account key signed in, Sign in signed out, its room held while it loads. */
function Account() {
  const { data: session, status } = useSession();
  // the session carries the id and isAdmin (lib/auth.ts session callback); the browser's session type doesn't declare them
  const user = session?.user as (NonNullable<typeof session>["user"] & { id?: string; isAdmin?: boolean }) | undefined;
  const studio = useStudioEntry(status === "authenticated" ? user?.id : undefined);
  if (status === "loading") return <SignIn reserve />;
  if (!user) return <SignIn />;
  const who = user.name?.trim() || user.email?.split("@")[0] || "Your account";
  const isAdmin = user.isAdmin === true;
  return (
    <>
      <a href="/account" className={s.link}>
        Account
      </a>
      <Menu trigger="avatar" align="end" label="Your account" buttonLabel={`Account menu for ${who}`} face={<Face image={user.image} name={user.name} email={user.email} />}>
        <MenuGroup label={who}>
          <MenuItem href="/account">Account</MenuItem>
          {/* the downloads for every app this account may have (the founder, 2026-11-07: "easy to reach through my online account") */}
          <MenuItem href="/account/setup">Apps</MenuItem>
          {studio && <MenuItem href="/studio">Studio</MenuItem>}
          {isAdmin && <MenuItem href="/admin/pipeline">Admin</MenuItem>}
          <MenuItem href="/settings">Settings</MenuItem>
          <MenuItem onPick={signOut}>Sign out</MenuItem>
        </MenuGroup>
      </Menu>
    </>
  );
}

/** How many matches of each kind the panel lists. */
const PER_GROUP = 4;

export function Masthead({
  home,
  search = "/search",
  links = [],
  cta,
  account,
}: {
  home: string;
  search?: string;
  /** The page's own links, between the mark and the search key. */
  links?: Array<{ href: string; label: string }>;
  /** The page's one action, at the pill's end. */
  cta?: { href: string; label: string };
  /** End the pill with the person's account (Account and their key, or Sign in): the product pages. */
  account?: boolean;
}) {
  const nav = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const closedWidth = useRef(0);
  const refocus = useRef(false);
  const [searching, setSearching] = useState(false);
  // the matches closed (Escape, a click away) with what was typed kept in the field
  const [shut, setShut] = useState(false);
  const [away, setAway] = useState(false);
  const findId = `${useId()}-find`;
  const listId = `${findId}-list`;
  const router = useRouter();
  const [value, setValue] = useState("");
  const ta = useTypeahead(searching ? value : "", PER_GROUP);
  const { artists, albums, songs, order: groups } = ta;
  const hits = useMemo(() => toHits({ artists, albums, songs, order: groups }), [artists, albums, songs, groups]);
  const preview = useSearchPreview(hits);
  // the result the search is sure of leads on its own, above the groups; every other match follows in them
  const sure = ta.confident && ta.top ? `${ta.top.kind}:${ta.top.id}` : null;
  const lead = useMemo(() => (sure ? (hits.find((h) => h.id === sure) ?? null) : null), [hits, sure]);
  const rest = useMemo(() => (lead ? hits.filter((h) => h !== lead) : hits), [hits, lead]);
  const order = useMemo(() => [...(lead ? [lead.id] : []), ...rest.map((h) => h.id), "all"], [lead, rest]);
  const [lit, setLit] = useState("all");
  // a new set of matches lights the top result when the search is sure of it, else "Search everything"
  useEffect(() => setLit(sure && order.includes(sure) ? sure : "all"), [order, sure]);
  const leadName = ta.top?.kind === "artist" ? (ta.artists.find((a) => String(a.id) === ta.top!.id)?.name ?? null) : null;
  const namesakes =
    ta.hiddenNamesakes > 0 && leadName
      ? `${ta.hiddenNamesakes} more ${ta.hiddenNamesakes === 1 ? "artist" : "artists"} named ${leadName}`
      : null;
  const showResults = searching && ta.active && !shut;

  // What a screen reader hears, once the matches for what is typed now have settled and sat a moment
  // (not a word per letter): the sure result, or how many there are.
  const settled = showResults && !ta.loading && ta.forQuery === value.trim();
  const tell =
    ta.failed && showResults
      ? "Search is having trouble. Try again in a moment, or press Enter to search everything."
      : !settled
        ? null
        : hits.length === 0
          ? "No names match. Enter searches everything."
          : lead
            ? `${lead.name}, ${lead.kind}, top match${rest.length ? `, and ${rest.length} more` : ""}.`
            : `${hits.length} ${hits.length === 1 ? "match" : "matches"}.`;
  const [said, setSaid] = useState("");
  useEffect(() => {
    // emptied while nothing is current, so the next sentence is always news, even one that reads the same
    if (tell == null) return setSaid("");
    const id = setTimeout(() => setSaid(tell), 700);
    return () => clearTimeout(id);
  }, [tell]);

  // Down the page it slips away; any scroll back up brings it home. Near the top it always shows.
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        if (y < 120) {
          last = y;
          setAway(false);
          return;
        }
        if (Math.abs(y - last) < 8) return;
        setAway(y > last);
        last = y;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // The pill is sized by its contents, which a width can't animate from, so pin
  // the width it has now and let it grow to the search field's from there.
  const open = useCallback(() => {
    const el = nav.current;
    if (!el) return;
    closedWidth.current = el.offsetWidth;
    el.style.width = `${closedWidth.current}px`;
    void el.offsetWidth;
    el.style.width = `${Math.min(720, window.innerWidth - 24)}px`;
    setShut(false);
    setSearching(true);
  }, []);

  /** Puts the search away and clears it; the search key takes the focus back unless it was somewhere else. */
  const close = useCallback((focusKey = true) => {
    const el = nav.current;
    if (!el) return;
    el.style.width = `${closedWidth.current}px`;
    refocus.current = focusKey;
    setSearching(false);
    setValue("");
    setShut(false);
    setSaid("");
  }, []);

  // A pick goes to its page (a client move, so a song in the dock keeps playing); "all" opens the full search.
  const pick = useCallback(
    (rid: string) => {
      const q = value.trim();
      // results for an earlier spelling are stale: what is typed now goes to the full search
      const hit = ta.forQuery === q ? hits.find((h) => h.id === rid) : undefined;
      const to = hit ? hit.href : q ? `/search?q=${encodeURIComponent(q)}` : null;
      if (!to) return;
      close();
      router.push(to);
    },
    [hits, value, close, router, ta.forQuery],
  );

  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // the first closes the matches and keeps what was typed; the next clears it and puts the search away
      e.preventDefault(); // a search field would otherwise wipe itself on Escape
      if (showResults) setShut(true);
      else close();
      return;
    }
    if (!showResults) {
      // an arrow brings closed matches back, where it left them; Enter searches everything, in the page
      // (not the form's own full load, which would stop what the dock is playing)
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && searching && ta.active) {
        e.preventDefault();
        setShut(false);
      } else if (e.key === "Enter" && value.trim()) {
        e.preventDefault();
        pick("all");
      }
      return;
    }
    const at = order.indexOf(lit);
    // the arrows wrap, so from "Search everything" (last) one press down reaches the first match
    const move = (next: string) => {
      setLit(next);
      requestAnimationFrame(() => document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" }));
    };
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(order[(at + 1) % order.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(order[(at - 1 + order.length) % order.length]);
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      // Cmd/Ctrl-Enter previews the lit row where it can (the pointer's preview keys), else opens it
      e.preventDefault();
      if (preview.can(lit)) preview.press(lit);
      else pick(lit);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(lit);
    }
  };

  // Back to sizing itself once it has shrunk home.
  const onTransitionEnd = (e: TransitionEvent<HTMLElement>) => {
    if (e.target === nav.current && e.propertyName === "width" && !searching) nav.current.style.width = "";
  };

  // Focus follows the swap: into the field when it opens, back to the key once it's visible again.
  useEffect(() => {
    if (searching) field.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      opener.current?.focus();
    }
  }, [searching]);

  // "/" opens search from anywhere that isn't a text field (and goes back to it, matches and all, when it
  // is already open); Escape from anywhere else does what it does in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      // not while something modal is open over the page (the homepage's desktop app, pulled out of the hero)
      const modal = !!document.querySelector('[role="dialog"][aria-modal="true"]');
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (((e.key === "/" && !typing) || cmdK) && !modal) {
        if (searching) {
          // in the field itself the key keeps its own meaning (Ctrl-K cuts to the line's end on a Mac)
          if (e.target === field.current) return setShut(false);
          e.preventDefault();
          field.current?.focus();
          setShut(false);
          return;
        }
        e.preventDefault();
        setAway(false);
        open();
      } else if (e.key === "Escape" && searching && !e.defaultPrevented && !modal) {
        // only an Escape from the pill or from nowhere in particular is the search's: one meant for
        // something else on the page (a menu, a photo) leaves the kept query alone
        const at = document.activeElement;
        const ours = !at || at === document.body || !!nav.current?.contains(at) || !!panel.current?.contains(at);
        if (showResults) setShut(true);
        else if (ours) close(!!nav.current?.contains(at));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searching, showResults, open, close]);

  // A click or the focus anywhere but the pill and its matches closes the matches and keeps what was
  // typed; a click away from a search with nothing typed puts it away.
  useEffect(() => {
    if (!searching) return;
    const outside = (e: Event) => {
      const at = e.target as Node | null;
      return !!at && !nav.current?.contains(at) && !panel.current?.contains(at);
    };
    const onDown = (e: PointerEvent) => {
      if (!outside(e)) return;
      if (value.trim()) setShut(true);
      else close(false);
    };
    const onFocus = (e: FocusEvent) => {
      if (outside(e)) setShut(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("focusin", onFocus);
    };
  }, [searching, value, close]);

  return (
    <>
      <nav
        ref={nav}
        className={`${t.dark} ${s.mast}`}
        data-account={account || undefined}
        aria-label="Primary"
        data-search={searching || undefined}
        data-away={(away && !searching) || undefined}
        onTransitionEnd={onTransitionEnd}
      >
        <div className={s.bar} hidden={searching}>
          <a href={home} className={s.brand}>
            <LogoMark className={s.glyph} />
            Cassette
          </a>
          {links.map((l) => (
            <a key={l.href} href={l.href} className={s.link}>
              {l.label}
            </a>
          ))}
          <button ref={opener} type="button" className={s.key} onClick={open} aria-label="Search" aria-expanded={searching} aria-controls={findId}>
            <Icon name="search" />
          </button>
          {cta && <Cta cta={cta} account={!!account} />}
          {account && <Account />}
        </div>
        <form id={findId} className={s.find} action={search} method="get" role="search" hidden={!searching}>
          <Icon name="search" />
          <input
            ref={field}
            name="q"
            type="search"
            required
            placeholder="Search artists, albums, or a vibe"
            aria-label="Search"
            autoComplete="off"
            enterKeyHint="search"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShut(false);
            }}
            onClick={() => setShut(false)}
            onKeyDown={onFieldKey}
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showResults ? `${listId}-${lit}` : undefined}
          />
          <button type="button" className={s.key} onClick={() => close()} aria-label="Close search">
            <Icon name="close" />
          </button>
        </form>
      </nav>
      {/* the matches hang under the pill, not inside it: while it searches, the pill clips what it holds */}
      {showResults && (
        <SearchPanel
          id={listId}
          panelRef={panel}
          query={value.trim()}
          top={lead}
          hits={rest}
          namesakes={namesakes}
          loading={ta.loading}
          failed={ta.failed}
          lit={lit}
          preview={preview}
          onLight={setLit}
          onPick={pick}
        />
      )}
      <p className={s.said} role="status" aria-atomic="true">
        {searching ? said : ""}
      </p>
    </>
  );
}

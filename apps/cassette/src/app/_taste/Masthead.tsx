"use client";

/**
 * The masthead (P12), one on every page (the founder, 2026-11-14, masthead-sketches Study E): two pills
 * fixed at the top of the window that slip away while you scroll down the page and come back the moment
 * you scroll up (and stay while anything in them has the focus or a search is open).
 *
 *   the middle pill: the mark and the name, going home, then the places as icon keys: Discover, Radio,
 *     and the search key. The page you're on is the key that lifts out of the pill (the lens), and a key
 *     you press sinks it a touch and sends it over to that key before the page changes. Pointing at a key
 *     names it under the pill.
 *   the corner pill: the page's one action (the homepage's Save a seat), only for people not yet in, then
 *     the menu key: the menu's lines and the person's face (or the empty face for no one). Its menu says
 *     every place in words with the icon it wears in the pill (Discover, Radio, Search, Journal, Guides),
 *     the page's own links (the homepage's How it works) and Help, then the account: signed in, their name
 *     over Account (/account, the website's account window: the founder 2026-11-08, it is no longer the
 *     library, whose music plays only in the app), Apps (the downloads), Studio for anyone the Studio door
 *     lets in (StudioEntry below), Admin for an admin (the website is the only way into either), Settings
 *     and Sign out; signed out, Sign in. While the session loads the menu holds the places alone and the
 *     key the empty face, so nothing in the pill moves when it lands.
 *
 * Narrow windows (masthead.module.css): the pills join into one bar, then the name's word goes, then Save
 * a seat moves to the top of the menu. Nothing ever overlaps.
 *
 * The search key, "/" from anywhere that isn't a text field, or Cmd/Ctrl-K turns the middle pill (the whole
 * bar, when joined) into a search field. As you type, the catalog's fast name matches (artists, albums,
 * songs: /api/search on Typesense, through the shared useTypeahead, the old nav's own source) drop in a
 * panel under the pill (SearchPanel, on the page's own paper), and a pick goes straight to its page; Enter
 * on "Search everything" (or with nothing picked) opens the full /search, the home of the deep, interpreted
 * results. Escape, or a click anywhere else, closes the matches and keeps what was typed in the field (a
 * click in it, a letter or an arrow brings them back); a second Escape clears it and puts the search away,
 * as the close key does. A screen reader hears what was found once the matches settle. The product pages
 * leave the masthead's room at the top of their body, so it never covers the opener at rest.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type TransitionEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { resolveAvatar } from "@/lib/avatar";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";
import { signOut } from "@/lib/sign-out";
import { openFeedback } from "@/app/components/feedback-door";
import { useTypeahead } from "@/lib/search/use-typeahead";
import { LogoMark } from "./Brand";
import { Icon, type IconName } from "./Icon";
import { Menu, MenuItem, MenuLine, MenuPerson } from "./Menu";
import { siteMenu, sitePlaceOf, type SitePlace } from "./site-menu";
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

/** The places in the middle pill, in order; the lens moves 44px (a key and the gap) per place. */
const KEYS = [
  { id: "discover", href: "/discover", label: "Discover", icon: "compass" },
  { id: "radio", href: "/radio", label: "Radio", icon: "radio" },
] as const satisfies ReadonlyArray<{ id: string; href: string; label: string; icon: IconName }>;
const SEARCH_AT = KEYS.length;

type Link = { href: string; label: string; icon?: IconName };

/**
 * The corner pill's menu: the site's menu (site-menu.ts, the same places in the same order as every app rail's
 * account menu), drawn with the shared menu, each place with the icon it wears in the pill.
 */
function MainMenu({
  links,
  account,
  cta,
  here,
  onSearch,
}: {
  links: Link[];
  account: boolean;
  cta?: { href: string; label: string };
  here: SitePlace;
  onSearch: () => void;
}) {
  const { data: session, status } = useSession();
  // the session carries the id and isAdmin (lib/auth.ts session callback); the browser's session type doesn't declare them
  const user = session?.user as (NonNullable<typeof session>["user"] & { id?: string; isAdmin?: boolean }) | undefined;
  const signedIn = account && status === "authenticated" && !!user;
  const studio = useStudioEntry(signedIn ? user?.id : undefined);
  const who = user?.name?.trim() || user?.email?.split("@")[0] || "Your account";
  const face = signedIn ? (
    <Face image={user?.image} name={user?.name} email={user?.email} />
  ) : account ? (
    <span className={s.empty}>
      <Icon name="person" size={24} />
    </span>
  ) : null;
  const entries = siteMenu({
    who: signedIn ? "in" : account && status !== "loading" ? "out" : "loading",
    name: who,
    studio,
    admin: user?.isAdmin === true,
    here,
    cta,
    links,
  });
  return (
    <Menu trigger="menu" align="end" label="Cassette" buttonLabel={signedIn ? `Menu and account for ${who}` : "Menu"} face={face}>
      {entries.map((e, i) =>
        e.kind === "line" ? (
          <MenuLine key={`line-${i}`} />
        ) : e.kind === "person" ? (
          <MenuPerson key="person" href={e.href} face={<Face image={user?.image} name={user?.name} email={user?.email} />} name={e.name} sub="Your account" />
        ) : (
          <MenuItem
            key={e.label}
            href={e.href}
            onPick={e.action === "search" ? onSearch : e.action === "signOut" ? signOut : e.action === "feedback" ? openFeedback : undefined}
            icon={e.icon}
            current={e.current}
            className={e.seat ? s.seat : undefined}
          >
            {e.label}
          </MenuItem>
        ),
      )}
    </Menu>
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
  /** The page's own links, in the menu after the places. */
  links?: Link[];
  /** The page's one action, at the corner pill's start, for people not yet in. */
  cta?: { href: string; label: string };
  /** Hold the person's account in the menu (their face on the key, or Sign in). */
  account?: boolean;
}) {
  const row = useRef<HTMLDivElement>(null);
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
  const here = sitePlaceOf(usePathname() ?? "");
  const { status } = useSession();
  // the action is for people not yet in, so it steps aside for someone signed in
  const showCta = !!cta && !(account && status === "authenticated");
  // Until the session answers, the page draws for whoever this browser was last time: the root layout's script
  // put that on <html> as data-who before the first paint, and the stylesheet keeps Save a seat (and the room
  // it takes) away while it says "in". Once the session answers, the mark is made true for this page and the
  // next one.
  useEffect(() => {
    if (!account || status === "loading") return;
    const who = status === "authenticated" ? "in" : "out";
    document.documentElement.setAttribute("data-who", who);
    try {
      localStorage.setItem("cs-who", who);
    } catch {
      // private window or storage blocked: the next page asks the session again, as before
    }
  }, [account, status]);
  // the lifted key: the page's own, or the one just pressed while the page changes
  const homeAt = here === "search" ? SEARCH_AT : KEYS.findIndex((k) => k.id === here);
  const [goingTo, setGoingTo] = useState<number | null>(null);
  const [pressing, setPressing] = useState(false);
  const at = goingTo ?? (homeAt >= 0 ? homeAt : null);
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

  // Down the page it slips away; a scroll back up brings it home. Near the top it always shows.
  // Each way needs a real scroll to count, measured from where the page last turned, so a nudge or a trackpad
  // settling never flips it: 24px down to go, 48px back up to return (the founder, 2026-11-17: at 8px either way it
  // felt "a little bit erratic at times").
  // Whatever a page pins to the top of the window (a bar marked data-pins-top: the radio dial's sections) takes
  // that much of the top, and the masthead sits that much lower, below it, easing there as the bar pins and back
  // up as it lets go. The masthead stays a scroll away on every page, and it simply answers to what's pinned
  // above it (the founder, 2026-11-17: "always dynamically respond to whatever is pinned to the top of the page";
  // nav is important and shouldn't be conditional).
  const header = useRef<HTMLElement>(null);
  const awayNow = useRef(away);
  useEffect(() => {
    awayNow.current = away;
  }, [away]);
  useEffect(() => {
    const GO = 24;
    const RETURN = 48;
    // where the page last turned: the highest it has been while the masthead shows, the lowest while it's away
    let turn = window.scrollY;
    let frame = 0;
    let inset = -1;
    const flip = (to: boolean, y: number) => {
      turn = y;
      if (awayNow.current === to) return;
      awayNow.current = to;
      setAway(to);
    };
    // how much of the window's top is taken: down to the lowest edge of what's pinned there, below the player
    // along the top (which the masthead already sits under)
    const taken = (head: HTMLElement) => {
      const dock = parseFloat(getComputedStyle(head).getPropertyValue("--top-dock-h")) || 0;
      let low = dock;
      document.querySelectorAll<HTMLElement>("[data-pins-top]").forEach((bar) => {
        const r = bar.getBoundingClientRect();
        const pin = parseFloat(getComputedStyle(bar).top) || 0;
        if (r.top <= pin + 0.5 && r.bottom > 0) low = Math.max(low, r.bottom);
      });
      return Math.round(low - dock);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const head = header.current;
        if (head) {
          const now = taken(head);
          if (now !== inset) {
            inset = now;
            head.style.setProperty("--mast-inset", `${now}px`);
          }
        }
        const y = window.scrollY;
        if (y < 120) return flip(false, y);
        if (!awayNow.current) {
          if (y < turn) turn = y;
          else if (y - turn >= GO) flip(true, y);
        } else {
          if (y > turn) turn = y;
          else if (turn - y >= RETURN) flip(false, y);
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    // a page opened partway down (Back restores where it was) starts in the right state, not on the first scroll
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // The pill is sized by its contents, which a width can't animate from, so pin
  // the width it has now and let it grow to the search field's from there.
  // Joined into one bar, the field takes the whole bar; apart, the middle pill grows to 720 at most.
  const open = useCallback(() => {
    const el = nav.current;
    const bar = row.current;
    if (!el || !bar) return;
    const joined = getComputedStyle(el).position === "static";
    closedWidth.current = el.offsetWidth;
    el.style.width = `${closedWidth.current}px`;
    void el.offsetWidth;
    el.style.width = `${joined ? bar.clientWidth - 12 : Math.min(720, bar.clientWidth)}px`;
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
      <header
        ref={header}
        className={`${t.dark} ${s.mast}`}
        data-cta={showCta || undefined}
        data-search={searching || undefined}
        data-away={(away && !searching) || undefined}
      >
        <div ref={row} className={s.row}>
          <nav ref={nav} className={`${s.pill} ${s.places}`} aria-label="Primary" onTransitionEnd={onTransitionEnd}>
            <div className={s.bar} hidden={searching}>
              <a href={home} className={s.brand} aria-label="Cassette, home">
                <LogoMark className={s.glyph} />
                <span className={s.word}>Cassette</span>
              </a>
              <span className={s.keys}>
                <span
                  className={s.lens}
                  hidden={at === null}
                  data-press={pressing || undefined}
                  style={{ "--at": at ?? 0 } as CSSProperties}
                  aria-hidden="true"
                />
                {KEYS.map((k, i) => (
                  <a
                    key={k.id}
                    href={k.href}
                    className={s.key}
                    aria-label={k.label}
                    data-tip={k.label}
                    aria-current={here === k.id ? "page" : undefined}
                    onPointerDown={() => setPressing(true)}
                    onPointerUp={() => setPressing(false)}
                    onPointerLeave={() => setPressing(false)}
                    onClick={() => setGoingTo(i)}
                  >
                    <Icon name={k.icon} />
                  </a>
                ))}
                <button
                  ref={opener}
                  type="button"
                  className={s.key}
                  onClick={open}
                  aria-label="Search"
                  data-tip="Search /"
                  aria-current={here === "search" ? "page" : undefined}
                  aria-expanded={searching}
                  aria-controls={findId}
                >
                  <Icon name="search" />
                </button>
              </span>
            </div>
            <form id={findId} className={s.find} action={search} method="get" role="search" hidden={!searching}>
              <Icon name="search" />
              <input
                ref={field}
                name="q"
                type="search"
                required
                placeholder="Artists, albums or a vibe"
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
          <div className={`${s.pill} ${s.you}`}>
            {showCta && cta && (
              <a href={cta.href} className={s.cta}>
                {cta.label}
              </a>
            )}
            <MainMenu links={links} account={!!account} cta={cta} here={here} onSearch={open} />
          </div>
        </div>
      </header>
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

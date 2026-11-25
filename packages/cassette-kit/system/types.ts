/**
 * The design system's record types (design wave 2, board #1152). Types only, so the records (intent.ts, parts.ts,
 * words.ts) import them with `import type` and plain Node can read the records with its type stripping, the way
 * `pnpm design` does.
 */

/** Every rule, part and change names one or more of these. "The app" means nothing on its own. */
export type Surface = "website" | "panes" | "desktop-mac" | "desktop-windows" | "iphone" | "android" | "email";

/**
 * What a rule can really promise (the proposal's 2.1):
 *   type         the part has no way to express the mistake, so the build fails
 *   check        a script reads the code: refused at commit and push in Cassette's files, red online
 *   probe        caught when a page is drawn (samples, and the daily signed-out run); never gates a push
 *   provisional  written from code or a rebuild, never seen live: counted, never refusing
 *   review       only the founder can judge it, or nothing holds it yet
 */
export type Level = "type" | "check" | "probe" | "provisional" | "review";

/** What holds a rule. A rule names at least one. */
export type Enforcer =
  /** a part's props: the part's file, from the repository's top */
  | { type: string }
  /** a section of the design check (scripts/ci/design.mjs) */
  | { check: string }
  /** a test file in `pnpm test:design`, from the repository's top */
  | { test: string }
  /** a measure the drawn-page probe takes (scripts/ci/design-probe.mjs) */
  | { probe: string }
  /** nothing holds it yet: the wave that builds it, and what will hold it then */
  | { wave: string; then: string }
  /** no machine can see it: why, and who looks */
  | { seen: string };

/**
 * Where the founder's word is. A session can't tell the founder's words from its own, so every entry says where they
 * are, and only these count.
 */
export type Source =
  /** the 11-22 audit page's database (artifact Dcxwv1Fbzn1GD3LZ5RYeX1), as the founder saved it: the collection, the
   *  doc, the moment it was saved (UTC) and the option the founder picked, word for word */
  | { audit: "decisions" | "calls"; doc: string; at: string; choice: string }
  /** the audit's lean on a call the founder left to it ("the other 33 are decided on my lean"), and the day */
  | { lean: string; at: string }
  /** a memory note on the founder's laptop (~/.claude/projects/<this repo>/memory/), and the day the founder said it */
  | { memory: string; date: string }
  /** a doc or a file in git (or the founder's own docs/reference) that records the call, and its day */
  | { doc: string; date: string }
  /** a board card whose top line is the founder's own "DECIDED <date> in Admin: ..." */
  | { card: number };

/**
 * A rule in force.
 *   decided    the founder's own pick, on the audit page or in a memory note, with its date
 *   delegated  decided on the audit's lean because the founder left it to the audit; the founder can take one back
 *              ("Ask me" on the audit page, or a word on a card)
 *   recorded   a call the founder made before the board, written down from its memory note with the day; it stands as
 *              written. The set of recorded entries never grows: a new call comes in through a card (confirmed)
 *   confirmed  the founder's answer is a board card's top line
 */
export type Status = "decided" | "delegated" | "recorded" | "confirmed";

export type Rule = {
  id: string;
  /** the rule, in one line */
  says: string;
  level: Level;
  surfaces: Surface[];
  /** the founder's own words, exactly as said (absent when only a picked option or a session's summary exists) */
  words?: string;
  /** the day the founder said it, YYYY-MM-DD (the founder's own day, Central time) */
  date: string;
  status: Status;
  source: Source[];
  enforcedBy: Enforcer[];
  /** what it replaced: an older call, or the audit's lean */
  overrides?: string;
  /** other calls this one settles */
  answers?: string[];
  /** named places it doesn't hold, each with why */
  exceptions?: string[];
};

/** A call only the founder makes. Until they do, a session holds today's look and never picks an option. */
export type Open = {
  id: string;
  question: string;
  options?: string[];
  /** what a session does meanwhile */
  meanwhile: string;
  /** files a session may not change the look of while the call is open (from the repository's top) */
  freezes: string[];
  /** the day it was put to the founder, or "not yet: <why>" */
  asked: string;
  card?: number;
  source: Source[];
  /** calls it withdraws */
  withdraws?: string[];
};

/** A one-off kept on purpose: don't fix it, don't spread it (a second page asks the founder on a card, D6). */
export type Kept = {
  id: string;
  what: string;
  /** where it may live, from the repository's top; a path ending in "/" is a folder */
  files: string[];
  why: string;
  date: string;
  status: Status;
  source: Source[];
  fate: "keep" | "debt" | "promote";
  /** the part it becomes, for a one-off to promote */
  promoteTo?: string;
};

/** What a retired look leaves behind in the code, so it can be found and never rebuilt. */
export type Tell = {
  /** a regular expression's source, matched across a file's whole text */
  pattern: string;
  flags?: string;
  in: "code" | "comments" | "copy";
  /** only in files whose path starts with this (from the repository's top) */
  files?: string;
};

/** A look the founder turned down. Never rebuild it; what still draws it is debt. */
export type Retired = {
  id: string;
  was: string;
  /** the day it was retired */
  retired: string;
  words?: string;
  source: Source[];
  replacedBy: string[];
  tells: Tell[];
};

/** A call taken back by the founder, kept so no session builds on it. */
export type Withdrawn = {
  id: string;
  was: string;
  withdrawn: string;
  source: Source[];
  replacedBy: string;
};

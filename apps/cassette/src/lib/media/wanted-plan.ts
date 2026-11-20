/**
 * The media "wanted" list: the one queue every scheduled media job reads, and the rules for it
 * (docs/CASSETTE_MEDIA_FLOW_SPEC_2026-11-18.md, sections 2 and 8). Pure: no database, so the tests run
 * it directly (wanted-plan.test.ts). The SQL that carries these rules out is in wanted.ts beside it.
 *
 * What it is for. Every media job (songs, covers, videos, tags, press) works three lanes, so a backlog
 * never starves a new record and a new record never starves a backlog:
 *   - fresh:   records that just became visible (FRESH_DAYS) or sit in someone's library;
 *   - wanted:  records on this list, put there by the daily gap check (scripts/media-gap-check.ts) when
 *              people suddenly look at a page that has a gap, by the player when a song won't play, or by the
 *              Discover page when it shows a record with no song to play (discover-wants.ts, drizzle/0139);
 *   - backlog: the job's own walk, by who people look at, keeping its place in its run row.
 * planShares() splits a run's cap between them. The list is a table (media_wanted, drizzle/0137), not a
 * pipeline_status marker, because the albums table has no index on pipeline_status: finding marked rows
 * would read all three million albums every run.
 *
 * One row per (entity, need). A need is one missing piece, and NEED_OWNER names the one job that fills
 * it; that job asks the list for its due rows (isDue), tries, and records what happened (afterTry):
 *   - found:  the piece is there now; the row is done.
 *   - none:   looked and there is nothing yet (no art exists, no own upload); asked again RETRY_NONE_DAYS
 *             later, and after MAX_TRIES of these the row is parked: no job asks for it again. Only a new
 *             signal brings it back, and only once PARK_DAYS have passed (shouldReopen; tries start again at 0).
 *   - failed: something transient (a timeout, a 5xx); asked again RETRY_FAILED_DAYS later. Counts
 *             towards MAX_TRIES too, so a record that always fails cannot loop.
 * The gap check also closes rows itself when it sees the piece arrived another way (the backlog walk
 * found it first), and a new signal reopens a done or parked row only under shouldReopen().
 *
 * Guards against a runaway (the $900 lesson was a loop doing the same work for two weeks): a hard
 * ceiling on new or reopened rows per UTC day across every writer (MAX_NEW_WANTS_PER_DAY, the player's
 * share inside it, enforced in the insert itself), every try counted, nothing tried twice inside its wait,
 * and a row that used its MAX_TRIES is never due again on its own: a parked row that came back by itself
 * every month would, oldest first, push each day's new wants out of every lane.
 *
 * Which needs the gap check may ask for: only those whose owning job says, in its latest run row, that its
 * wanted lane served them (metadata.wanted_needs, WANTED_NEEDS_KEY). A need whose lane is switched off is
 * never put on the list, so it can't use the day's room or turn the alarm red.
 */

export const NEEDS = [
  "songs",
  "cover",
  "cover_storage",
  "videos",
  "video_recheck",
  "press",
  "tags",
  "song_tags",
  "artist_photo",
  "artist_channel",
] as const;
export type Need = (typeof NEEDS)[number];

/** Why a record was put on the list: the signal that noticed it. "discover": the Discover page showed it with no
 *  song to play (allowed by drizzle/0139; until that is applied the page writes nothing). */
export const WHYS = ["views", "radio", "people", "wikipedia", "top_pages", "player", "discover"] as const;
export type Why = (typeof WHYS)[number];

export type EntityType = "album" | "artist";

/** The kind of row each need sits on. */
export const NEED_ENTITY: Record<Need, EntityType> = {
  songs: "album",
  cover: "album",
  cover_storage: "album",
  videos: "album",
  video_recheck: "album",
  press: "album",
  tags: "album",
  song_tags: "album",
  artist_photo: "artist",
  artist_channel: "artist",
};

/** The one job that fills each need (its pipeline_runs job name). Nothing else tries a need. */
export const NEED_OWNER: Record<Need, string> = {
  songs: "catalog-songs-job",
  cover: "cover-backfill-job",
  cover_storage: "cover-backfill-job",
  artist_photo: "cover-backfill-job",
  videos: "owned-videos-job",
  video_recheck: "owned-videos-job",
  artist_channel: "owned-videos-job",
  press: "press-recent-job",
  tags: "new-release-tags-job",
  song_tags: "new-release-tags-job",
};

export type Outcome = "found" | "none" | "failed";

/** A record's videos count as there once at least this share of its songs has one (the gap check's "videos
 *  for most songs" and the videos job's wanted lane read the same number). */
export const VIDEOS_FOUND_SHARE = 0.5;
/** Days a record counts as fresh once it became visible. */
export const FRESH_DAYS = 30;
/** Share of a run's cap held for the wanted lane (and the most it may take). */
export const WANTED_SHARE = 0.25;
/** Share of a run's cap held for the fresh lane before the backlog walk takes the rest. */
export const FRESH_SHARE = 0.5;
/** New or reopened rows a day across every writer: the gap check, the player, anything later. */
export const MAX_NEW_WANTS_PER_DAY = 300;
/** Of those, the most the player's reports may add (a song that won't play). */
export const MAX_PLAYER_WANTS_PER_DAY = 100;
/** Of those, the most the Discover page may add (records it showed with no song to play): about what the videos job's
 *  wanted lane gets through in its ten minutes a night, and half the day's room, so the gap check keeps the rest. */
export const MAX_DISCOVER_WANTS_PER_DAY = 150;
export const MAX_TRIES = 3;
export const RETRY_NONE_DAYS = 7;
export const RETRY_FAILED_DAYS = 1;
export const PARK_DAYS = 30;
/** A done row is not reopened by a new signal for this long: the piece was just filled. */
export const REOPEN_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

export type WantRow = {
  /** bigserial; loadDue turns the driver's string into a number (ids stay far below 2^53). */
  id: number;
  entity_type: EntityType;
  entity_id: number;
  need: Need;
  why: Why;
  wanted_at: string;
  tries: number;
  last_try_at: string | null;
  last_outcome: Outcome | null;
  done_at: string | null;
  parked_until: string | null;
};

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** The run-row metadata key where each job lists the needs its wanted lane served on that run (an empty list
 *  or no key: none). The gap check reads it to know which needs are worth asking for. */
export const WANTED_NEEDS_KEY = "wanted_needs";

/** Whether the need's owner should try this row now. A row that used its tries is not, even once its park
 *  has run out: only a new signal reopens it (shouldReopen, which starts its tries again). */
export function isDue(row: Pick<WantRow, "done_at" | "parked_until" | "last_try_at" | "last_outcome" | "tries">, now: number): boolean {
  if (row.done_at) return false;
  if (row.tries >= MAX_TRIES) return false;
  const parked = ms(row.parked_until);
  if (parked !== null && parked > now) return false;
  const last = ms(row.last_try_at);
  if (last === null) return true;
  const wait = row.last_outcome === "failed" ? RETRY_FAILED_DAYS : RETRY_NONE_DAYS;
  return now - last >= wait * DAY_MS;
}

/** The row's new state after one try. Pure twin of recordTrySql in wanted.ts (pinned by the tests). */
export function afterTry(
  row: Pick<WantRow, "tries">,
  outcome: Outcome,
  now: number,
): { tries: number; last_try_at: string; last_outcome: Outcome; done_at: string | null; parked_until: string | null } {
  const at = new Date(now).toISOString();
  const tries = row.tries + 1;
  if (outcome === "found") return { tries, last_try_at: at, last_outcome: outcome, done_at: at, parked_until: null };
  const parked_until = tries >= MAX_TRIES ? new Date(now + PARK_DAYS * DAY_MS).toISOString() : null;
  return { tries, last_try_at: at, last_outcome: outcome, done_at: null, parked_until };
}

/** Whether a new signal on a row that exists reopens it (tries back to 0). An open row is left as it
 *  is (its waits still hold); a parked one stays parked; a done one reopens only once it has been done
 *  for REOPEN_AFTER_DAYS (something filled it, and a week later it is missing again). */
export function shouldReopen(row: Pick<WantRow, "done_at" | "parked_until">, now: number): boolean {
  const parked = ms(row.parked_until);
  if (parked !== null && parked > now) return false;
  const done = ms(row.done_at);
  if (done === null) return parked !== null; // open: leave it; parked and the park has run out: reopen
  return now - done >= REOPEN_AFTER_DAYS * DAY_MS;
}

export type LaneCounts = { fresh: number; wanted: number; backlog: number };

/**
 * Split a run's cap between the three lanes. Each lane is held its share (fresh FRESH_SHARE, wanted
 * WANTED_SHARE, the backlog what is left), and a lane with less waiting than its share hands the
 * difference on: fresh to wanted to backlog, then anything still unused back to fresh and wanted. The
 * wanted lane never takes more than its share, so a flood of signals can't push the backlog out.
 * `available` is how many each lane has waiting (Infinity for a walk that always has more).
 */
export function planShares(cap: number, available: LaneCounts): LaneCounts {
  const total = Math.max(0, Math.floor(cap));
  const avail = {
    fresh: Math.max(0, available.fresh),
    wanted: Math.max(0, available.wanted),
    backlog: Math.max(0, available.backlog),
  };
  const wantedCeil = Math.floor(total * WANTED_SHARE);
  let fresh = Math.min(avail.fresh, Math.floor(total * FRESH_SHARE));
  let wanted = Math.min(avail.wanted, wantedCeil);
  let backlog = Math.min(avail.backlog, total - fresh - wanted);
  let left = total - fresh - wanted - backlog;
  if (left > 0) {
    const more = Math.min(left, avail.fresh - fresh);
    fresh += more;
    left -= more;
  }
  if (left > 0) {
    const more = Math.min(left, wantedCeil - wanted, avail.wanted - wanted);
    wanted += Math.max(0, more);
    left -= Math.max(0, more);
  }
  return { fresh, wanted, backlog };
}

/** The ISO date FRESH_DAYS before `now`, for comparing with stored timestamps. */
export function freshSince(now: number): string {
  return new Date(now - FRESH_DAYS * DAY_MS).toISOString();
}

/**
 * The player's "this song won't play" report: the rules (docs/CASSETTE_MEDIA_FLOW_SPEC_2026-11-18.md,
 * section 5.4). Pure and import-free on purpose: the preview player (src/app/_taste/player.tsx, a
 * "use client" file) reads the browser half of it, so nothing here may pull in the database, node's
 * crypto or the queue's SQL (BUG-954). The tests (player-report-plan.test.ts) hold it to that.
 *
 * What happens. When YouTube refuses every upload of a song in the preview player, the browser sends
 * one small report: the song's catalog id, the upload YouTube refused and YouTube's code for it. Once
 * per song per browser per day, never anything about the person, never for the stall case (a song
 * that ended at once, or a refusal with no code) and never for a code that means the browser itself
 * is the problem. POST /api/preview/unplayable (src/app/api/preview/unplayable/route.ts) checks the
 * report, looks the song up (it must be on a visible album and hold that exact upload in its stored
 * YouTube rows, so a forged report can't put an arbitrary record on the list), and asks the shared
 * wanted list for a video_recheck of the album. The videos job takes it next morning and asks YouTube
 * about the album's uploads before letting any go, so a false report costs a lookup, never a video.
 *
 * Only while the videos job's wanted lane is taking re-checks (recheckServed): its latest finished run says
 * so in its row (metadata.wanted_needs lists video_recheck), the same rule the gap check asks by
 * (scripts/lib/media-gap-plan.ts lanesServed; the tests hold the two together). With that lane off
 * (OWNED_VIDEOS_WANTED unset) nobody would ever try the row, so a report then writes nothing: it would
 * only take a place in the day's room on the list that the gap check needs.
 *
 * Off unless NEXT_PUBLIC_PLAYER_UNPLAYABLE_REPORT reads exactly "on" (unplayableReportsOn): one switch for
 * both halves, so until it is on the browser sends nothing at all (no new call to the site, nothing kept in
 * the browser) and the endpoint answers 204 and reads nothing. It is read when the site is built, so turning
 * it on or off takes a redeploy.
 *
 * Only reports from listeners in the United States count (fromListenerRegion). Our videos are judged for a
 * listener there (LISTENER_REGION in src/lib/providers/youtube.ts), so an upload locked out of another
 * country refuses to play abroad (101 or 150) and still plays here; a report from abroad would put the
 * record on the list, the videos job would find nothing wrong, and the same listener would put it back a
 * week later, every week. The country is the one Vercel puts on every request.
 *
 * Bounded three ways: BROWSER_DAY_MAX songs a browser a day, PLAYER_REPORTS_PER_IP_HOUR a network an hour,
 * and the wanted list's own daily ceiling for the player (MAX_PLAYER_WANTS_PER_DAY, enforced inside its
 * insert); and nothing at all is written while the videos job's wanted lane is off.
 */

import type { EntityType, Need, Why } from "./wanted-plan";

/** Where the browser sends a report. */
export const REPORT_PATH = "/api/preview/unplayable";

/**
 * YouTube's refusal codes that say something about the upload itself, so a re-check can find it gone:
 *   100  the video is gone or private;
 *   101, 150  its owner keeps it off other sites (or out of the listener's country, which is why only
 *        reports from LISTENER_REGION count), which the videos job's re-check confirms from its side
 *        before anything is let go.
 * Left out on purpose, because they say something about the listener's browser, not the upload, and one
 * browser would report every song it touched:
 *   2    a malformed request (we check the id's shape ourselves);
 *   5    the browser's own player failed, often a network blip;
 *   152, 153  the browser hid which site asked (a privacy setting).
 */
export const REPORT_CODES: readonly number[] = [100, 101, 150];

/** The most songs one browser reports in a day: a browser that can't play anything stops here. */
export const BROWSER_DAY_MAX = 30;
/** The most reports one network may send in an hour (the app's own limiter, src/lib/rate-limit.ts). */
export const PLAYER_REPORTS_PER_IP_HOUR = 30;
/** A report is about 60 bytes; anything far bigger is not one. */
export const MAX_REPORT_BYTES = 512;
/** Where the browser keeps the songs it reported today. */
export const REPORTED_KEY = "cassette.unplayable";

const MAX_INT4 = 2_147_483_647;

/** The report as it travels: nothing about the person, nothing but these three. */
export type Report = { trackId: number; videoId: string; code: number };

/** The exact-word switch: on only when it reads exactly "on". */
export function reportsOn(value: string | null | undefined): boolean {
  return value === "on";
}

/**
 * The one switch, for the browser and the endpoint both: NEXT_PUBLIC_PLAYER_UNPLAYABLE_REPORT, on only when
 * it reads exactly "on". Next writes a NEXT_PUBLIC_ value into the code when the site is built, so both
 * halves see the same word and changing it takes a redeploy. Written out in full on purpose: read any other
 * way (by a name held in a variable, or from a copied or destructured env) Next can't write it in and the
 * browser reads nothing.
 */
export function unplayableReportsOn(): boolean {
  return reportsOn(process.env.NEXT_PUBLIC_PLAYER_UNPLAYABLE_REPORT);
}

/** The header Vercel sets on every request it serves: the visitor's country (ISO 3166-1 alpha-2, "US"). It is
 *  Vercel's own, written at its edge, so a browser can't pick it; off Vercel it is missing. */
export const COUNTRY_HEADER = "x-vercel-ip-country";

/**
 * Whether the report comes from a listener in the country our videos are judged for (pass LISTENER_REGION
 * from src/lib/providers/youtube.ts). Only an exact match counts: a missing header (a local run, a request
 * that didn't come through Vercel) or any other country says no, so a region lock seen abroad never puts a
 * record on the list.
 */
export function fromListenerRegion(headers: { get(name: string): string | null }, region: string): boolean {
  return region !== "" && headers.get(COUNTRY_HEADER) === region;
}

/** A catalog song id: a whole number the tracks table can hold. */
export function isTrackId(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= MAX_INT4;
}

/** A YouTube video id: exactly 11 characters from YouTube's alphabet (the same rule as youtube-match.ts). */
export function isYouTubeId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{11}$/.test(v);
}

/** A refusal code that counts (REPORT_CODES). */
export function countsAsDead(v: unknown): v is number {
  return typeof v === "number" && REPORT_CODES.includes(v);
}

/**
 * The browser's half: what to report for a song YouTube refused, or null for nothing. `codes` are the
 * frame's refusals in the order it tried the uploads (videoId, then each fallback), so they must line up
 * one for one with the song's ids; when they don't (the song changed under the frame) nothing is said.
 * The first upload whose code counts is the one reported. No code at all (the stall case) says nothing.
 */
export function pickReport(
  track: { trackId: number; videoId: string; fallbackVideoIds: readonly string[] } | null | undefined,
  codes: readonly number[],
): Report | null {
  if (!track || !isTrackId(track.trackId)) return null;
  const ids = [track.videoId, ...(track.fallbackVideoIds ?? [])];
  if (codes.length === 0 || codes.length !== ids.length) return null;
  for (let i = 0; i < ids.length; i++) {
    const code = codes[i];
    const videoId = ids[i];
    if (countsAsDead(code) && isYouTubeId(videoId)) return { trackId: track.trackId, videoId, code };
  }
  return null;
}

/** The day a report counts against, in UTC (YYYY-MM-DD). */
export function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Whether the browser sends this song's report today, and what to keep afterwards. `stored` is what the
 * browser kept under REPORTED_KEY (or null); only today's songs are kept, so it never grows past
 * BROWSER_DAY_MAX. `next` is null when nothing needs keeping (the report is not sent).
 */
export function noteReport(stored: string | null, trackId: number, day: string): { send: boolean; next: string | null } {
  let ids: number[] = [];
  try {
    const kept = stored ? (JSON.parse(stored) as { d?: unknown; ids?: unknown }) : null;
    if (kept && kept.d === day && Array.isArray(kept.ids)) ids = kept.ids.filter(isTrackId).slice(0, BROWSER_DAY_MAX);
  } catch {
    // something else was kept under the key: start the day afresh
  }
  if (ids.includes(trackId) || ids.length >= BROWSER_DAY_MAX) return { send: false, next: null };
  return { send: true, next: JSON.stringify({ d: day, ids: [...ids, trackId] }) };
}

/** The endpoint's half: the parsed body as a report, or null when it isn't one. Extra fields are ignored. */
export function parseReport(raw: unknown): Report | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isTrackId(r.trackId) || !isYouTubeId(r.videoId) || !countsAsDead(r.code)) return null;
  return { trackId: r.trackId, videoId: r.videoId, code: r.code };
}

/** A request from our own pages: its Origin names this host, or, with no Origin, the browser says it is
 *  same-origin (the affiliate click beacon's rule, src/app/api/affiliate/click/route.ts). */
export function sameOrigin(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "";
  const origin = headers.get("origin");
  if (origin) {
    try {
      return host !== "" && new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return headers.get("sec-fetch-site") === "same-origin";
}

/** One stored YouTube row of the reported song on a visible album (player-report.ts reads it). */
export type StoredRow = { album_id: number; external_id: string };

/** The one need a report asks for. */
export const RECHECK_NEED: Extract<Need, "video_recheck"> = "video_recheck";

/** How old the videos job's latest finished run may be and still speak for its wanted lane: the gap check's
 *  allowance for a daily job (scripts/lib/media-gap-plan.ts ownerFreshMinutes; the tests hold them equal). */
export const SERVED_FRESH_MINUTES = 36 * 60;

/** The videos job's latest run that finished well (done or partial): its age in minutes, null when it has
 *  none, and what its row says its wanted lane served (metadata.wanted_needs, as stored). */
export type OwnerRun = { ageMin: number | null; wantedNeeds: unknown };

/** player-report.ts's row (wanted_needs, age_min) as an OwnerRun, or null when there is no row. The twin of
 *  the gap check's ownerRunsFrom. */
export function ownerRunOf(row: { wanted_needs?: unknown; age_min?: unknown } | null | undefined): OwnerRun | null {
  if (!row) return null;
  const age = row.age_min == null ? NaN : Number(row.age_min);
  return { ageMin: Number.isFinite(age) ? age : null, wantedNeeds: row.wanted_needs ?? null };
}

/**
 * Whether the videos job's wanted lane is taking re-checks, by the gap check's rule (lanesServed): its latest
 * finished run is no older than SERVED_FRESH_MINUTES and its wanted_needs lists video_recheck. No run, a run
 * too old to speak for today, one that doesn't say, or one whose lane was off or found no list: no.
 */
export function recheckServed(run: OwnerRun | null | undefined): boolean {
  if (!run || run.ageMin === null || !Number.isFinite(run.ageMin)) return false;
  if (run.ageMin > SERVED_FRESH_MINUTES) return false;
  return Array.isArray(run.wantedNeeds) && run.wantedNeeds.includes(RECHECK_NEED);
}

/** What the endpoint asks the wanted list for: the shape of want() in wanted.ts. */
export type PlayerWant = {
  entityType: Extract<EntityType, "album">;
  entityId: number;
  need: Extract<Need, "video_recheck">;
  why: Extract<Why, "player">;
  detail: { code: number; trackId: number; videoId: string };
};

/** The want for a report whose upload is among the song's stored rows on a visible album, else null. */
export function wantFor(report: Report, rows: readonly StoredRow[]): PlayerWant | null {
  const hit = rows.find((r) => r.external_id === report.videoId && isTrackId(Number(r.album_id)));
  if (!hit) return null;
  return {
    entityType: "album",
    entityId: Number(hit.album_id),
    need: RECHECK_NEED,
    why: "player",
    detail: { code: report.code, trackId: report.trackId, videoId: report.videoId },
  };
}

export type ReportDeps = {
  /** The per-network limiter: false when this network has sent its hour's reports. */
  allow: (network: string) => Promise<boolean>;
  /** Whether the videos job's wanted lane is taking re-checks (recheckServed on its latest finished run). */
  served: () => Promise<boolean>;
  /** The song's stored YouTube rows with this exact id, on a visible album only. */
  stored: (trackId: number, videoId: string) => Promise<StoredRow[]>;
  /** The wanted list's want(); answers its result (added, reopened, unchanged, capped, not_ready). */
  want: (w: PlayerWant) => Promise<string>;
};

/** One checked report, start to finish: the limiter, then whether the videos job's wanted lane is taking
 *  re-checks, then the lookup, then at most one want. Answers "limited", "not_served", "no_match", or
 *  want()'s own result. */
export async function takeReport(report: Report, network: string, deps: ReportDeps): Promise<string> {
  if (!(await deps.allow(network))) return "limited";
  if (!(await deps.served())) return "not_served";
  const w = wantFor(report, await deps.stored(report.trackId, report.videoId));
  if (!w) return "no_match";
  return deps.want(w);
}

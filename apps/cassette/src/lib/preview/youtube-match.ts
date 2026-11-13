/**
 * Pure matching helpers for the YouTube preview resolver — no DB, no network, so
 * they can be unit-tested in isolation (see youtube-match.test.ts). The DB/API
 * orchestration lives in youtube-resolve.ts and imports from here.
 *
 * Two questions are answered here, per track:
 *   1. WHICH uploads are this song at all (title + duration matching), and
 *   2. WHAT KIND each one is — a "video" (the official music video, the
 *      showcase the founder wants up front), "audio" (a Topic / Art Track
 *      upload: cover art + the album cut, the dependable fallback), or "other"
 *      (a live take, a lyric video: still a valid best-overall match, never
 *      the preferred showcase). Another version of the song (a remix, another
 *      mix, an edit, a demo) is not this song at all and never gets this far
 *      (BUG-578).
 * The resolver stores the best of each kind so the player can lead with the
 * video and fall back to the audio upload when the video refuses to embed.
 */

import type { DiscogsVideo } from "@/lib/providers/discogs-video";

export interface TrackForMatch {
  id: number;
  title: string;
  durationSeconds: number | null;
}

export type VideoKind = "video" | "audio" | "other";

export interface MatchedVideo {
  videoId: string;
  url: string;
  kind: VideoKind;
}

export interface MatchedVideosByKind {
  /** Best match regardless of kind — what the legacy `youtube` row stores. */
  canonical: MatchedVideo | null;
  /** Best official music video, when one is marked as such. */
  video: MatchedVideo | null;
  /** Best cover-art/audio upload (Topic channel, "(Official Audio)", or a plain
   *  unmarked upload) — the dependable fallback. */
  audio: MatchedVideo | null;
}

/** The three kinds of stored video row, one per (track, source) in track_external_ids (see
 *  youtube-resolve.ts): the legacy best-overall match, the official video, the audio upload. */
export const YT_SOURCE = "youtube";
export const YT_VIDEO_SOURCE = "youtube_video";
export const YT_AUDIO_SOURCE = "youtube_audio";

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** YouTube ids are exactly 11 chars from this alphabet. */
export function isVideoId(id: string | null | undefined): id is string {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** Pull a video id out of a youtube.com/watch, youtu.be, or /embed URL. */
export function extractYouTubeId(uri: string): string | null {
  try {
    const u = new URL(uri);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return isVideoId(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return isVideoId(id) ? id : null;
      }
      const m = u.pathname.match(/^\/(?:embed|v|shorts)\/([^/?#]+)/);
      if (m && isVideoId(m[1])) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

/** Spell "&" as "and" so "Young & Beautiful" and "Young And Beautiful" compare equal (BUG-573). Applied
 *  to titles before normalize(), which would otherwise drop the "&" and keep the "and". Kept out of
 *  normalize() itself, since isArtistsOwn uses that for channel names where "Simon & Garfunkel" matters. */
export function foldAmpersand(s: string): string {
  return s.replace(/\s*&\s*/g, " and ");
}

/**
 * Fold titles to a comparable core: no diacritics, brackets, or punctuation. Letters and numbers of every
 * script are kept (BUG-792): a name in Chinese, Japanese, Cyrillic or Arabic used to fold to nothing, so no
 * channel was ever "the artist's own" and no song of theirs ever matched. Only the Latin-style accents NFKD
 * splits off (é → e, the marks in U+0300 to U+036F) are dropped; the marks that belong to other scripts (a
 * Japanese voicing mark, an Indic vowel sign) stay with their letter, and the result is put back together
 * (NFC, so Hangul reads as syllables again). A name still folds to nothing only when it has no letter or
 * number at all ("!!!").
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // the accents NFKD split off a Latin, Greek or Cyrillic letter (é → e)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\bfeat\.?\b.*$/g, " ")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .replace(/(^|\s)\p{M}+/gu, "$1") // a mark with no letter before it (an emoji's variation selector) is not a word
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop a leading "Artist - " / "Artist – " prefix (Discogs titles its videos
 *  "Artist - Title (...)"). Bounded to ≤40 chars so it can't eat a real title. */
function stripArtistPrefix(title: string): string {
  return title.replace(/^.{1,40}?\s[-–—]\s/, "");
}

// ─── Which version a title names (BUG-578) ─────────────────────────────────
// normalize() drops brackets, so "System XXX (mix 1)" and "System XXX (Mix 2)", or "Whole" and
// "Whole (Extended Mix)", compared as one title and a song got another mix of itself. These read
// the brackets and the " - " suffixes that normalize() throws away and say which version, if any,
// a title names. A remaster, "Official Video", "Lyrics", "HD", "Visualizer" or "feat. X" names none.

/** Words that name another version of a song on their own: "(Remix)", "(Radio Edit)", "(Demo)".
 *  A live take is NOT on this list, on purpose: a live record's songs are almost never titled
 *  "(Live)" (78 of 20,000 songs on live records, 2026-11-10) and no album says reliably that it is
 *  live, so refusing "(Live)" uploads would take every live record's own videos away. A live take
 *  stays what it was, an "other" match (classifyVideoKind) that never leads. Same for "Unplugged",
 *  "Session" and "En Vivo". */
const VERSION_WORDS = new Set([
  "remix", "remixed", "rmx", "demo", "extended", "dub", "edit", "acoustic", "acustico", "acustica",
  "instrumental", "inst", "instr", "acapella", "acappella", "cappella", "karaoke", "rework", "reworked",
  "remake", "redux", "rerecorded", "bootleg", "mashup", "vip", "reprise", "outtake", "rehearsal",
  "alternate", "alt", "cover", "orchestral", "mixed", "sped", "slowed", "nightcore", "8d",
]);
/** Words that name a version only with something saying which: "(Mix 1)", "(Single Version)". */
const GENERIC_VERSION_WORDS = new Set(["mix", "version", "ver"]);
/** Words that say a title is the plain recording, or say nothing about the recording at all:
 *  "(Original Mix)", "(Album Version)", "(Remastered Version)", "(Official Video)". */
const PLAIN_WORDS = new Set([
  "original", "album", "lp", "studio", "main", "full", "stereo", "mono", "explicit", "clean", "dirty",
  "censored", "uncensored", "deluxe", "expanded", "special", "anniversary", "edition", "bonus", "track",
  "digital", "digitally", "official", "oficial", "video", "videoclip", "audio", "music", "lyric", "lyrics",
  "visualizer", "visualiser", "hd", "hq", "4k",
]);
const STOP_WORDS = new Set(["a", "an", "the", "at", "in", "on", "of", "from", "for", "to", "by", "and", "y", "en", "de"]);
/** Everything after these in a bracket is a guest or a credit, never a version. */
const CREDIT_WORDS = new Set(["feat", "ft", "featuring", "with"]);
const isPlainWord = (w: string) => PLAIN_WORDS.has(w) || w.startsWith("remaster");

/** What one bracket or " - " suffix says about the version: null when it names none, otherwise the
 *  words that say which one ("mix 1" → 1, "Extended Mix" → extended, "Skrillex Remix" → skrillex, remix). */
function versionWordsIn(descriptor: string): string[] | null {
  const words: string[] = [];
  for (const w of normalize(descriptor).split(" ")) {
    if (CREDIT_WORDS.has(w)) break;
    if (w) words.push(w);
  }
  const takeNumber = words.some((w, i) => w === "take" && /^\d+$/.test(words[i + 1] ?? ""));
  const named =
    takeNumber ||
    words.some((w) => VERSION_WORDS.has(w)) ||
    (words.some((w) => GENERIC_VERSION_WORDS.has(w)) && !words.some(isPlainWord));
  if (!named) return null;
  return words.filter((w) => !GENERIC_VERSION_WORDS.has(w) && !isPlainWord(w) && !STOP_WORDS.has(w));
}

export interface VersionNamed {
  /** Whether the title names a version other than the plain recording. */
  named: boolean;
  /** The words that say which version, when it does. */
  words: Set<string>;
}

function versionOf(descriptors: string[]): VersionNamed {
  const out: VersionNamed = { named: false, words: new Set() };
  for (const d of descriptors) {
    const words = versionWordsIn(d);
    if (!words) continue;
    out.named = true;
    for (const w of words) out.words.add(w);
  }
  return out;
}

const SPACED_DASH = /\s[-–—]\s/;

function splitBrackets(title: string): { groups: string[]; rest: string } {
  const groups: string[] = [];
  const rest = title.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_m, round?: string, square?: string) => {
    groups.push(round ?? square ?? "");
    return " ";
  });
  return { groups, rest };
}

/** A song's own title: its brackets and every " - " suffix may name its version
 *  ("Whole (Extended Mix)", "Song - Live"); the first piece is the song. */
export function songVersion(title: string): VersionNamed & { core: string } {
  const { groups, rest } = splitBrackets(foldAmpersand(title));
  const pieces = rest.split(SPACED_DASH);
  return { core: normalize(pieces[0] ?? ""), ...versionOf([...groups, ...pieces.slice(1)]) };
}

/** An upload's title, read for the song whose bare name is `songCore`: its brackets, and whatever
 *  follows the song's name ("Whole - Extended Mix", "Artist - Whole - Live"). What comes before the
 *  song's name is the artist (a band called Live is not a live take) and is not read. */
export function uploadVersion(title: string, songCore: string): VersionNamed {
  const { groups, rest } = splitBrackets(foldAmpersand(title));
  const pieces = rest.split(SPACED_DASH).map(normalize);
  const after: string[] = [];
  if (songCore) {
    const at = pieces.indexOf(songCore);
    if (at >= 0) after.push(...pieces.slice(at + 1));
    else {
      const within = pieces.findIndex((p) => ` ${p} `.includes(` ${songCore} `));
      if (within >= 0) {
        const p = pieces[within];
        const k = ` ${p} `.indexOf(` ${songCore} `);
        after.push(p.slice(k + songCore.length), ...pieces.slice(within + 1));
      }
    }
  }
  return versionOf([...groups, ...after]);
}

const within = (a: Set<string>, b: Set<string>) => [...a].every((w) => b.has(w));

/**
 * Whether an upload is the song's own version, by title alone:
 *   "same"      both plain, or both name a version and agree ("Live" and "Live at Wembley");
 *   "different" the upload names a version the song doesn't ("Whole" / "Whole (Extended Mix)"), or
 *               both name one and they disagree ("mix 1" / "Mix 2");
 *   "unsaid"    the song names a version and the upload says nothing; only its length can tell.
 */
export function versionAgreement(songTitle: string, uploadTitle: string): "same" | "different" | "unsaid" {
  const song = songVersion(songTitle);
  const upload = uploadVersion(uploadTitle, song.core);
  if (!song.named) return upload.named ? "different" : "same";
  if (!upload.named) return "unsaid";
  return within(song.words, upload.words) || within(upload.words, song.words) ? "same" : "different";
}

// Markers are read from the RAW upload title (normalize() strips brackets, and
// the brackets are exactly where uploaders put "(Official Video)").
const VIDEO_MARKERS =
  /\b(official\s+(?:hd\s+|4k\s+)?(?:music\s+)?video|music\s+video|video\s+oficial|videoclip|video\s*clip|clip\s+officiel|official\s+clip|m\/v)\b|[([]\s*video\s*[)\]]/i;
const AUDIO_MARKERS = /\b(official\s+audio|audio\s+only|art\s*track|provided\s+to\s+youtube)\b|[([]\s*audio\s*[)\]]/i;
// Anything that is this song but NOT the studio showcase: still a legitimate
// best-overall match, never the preferred video and never the audio fallback.
const OTHER_MARKERS =
  /\b(live|lyric|lyrics|karaoke|cover|remix|remixes|edit|teaser|trailer|behind\s+the\s+scenes|making\s+of|acoustic|session|sessions|unplugged|rehearsal|reaction|instrumental|sped\s+up|slowed|8d|nightcore)\b/i;

/**
 * Classify one upload for a given track. The track's own title is removed from
 * the upload title before the "other" test, so a song called "Live Forever" or
 * "Cover Me" is not misread as a live take or a cover.
 */
export function classifyVideoKind(
  uploadTitle: string,
  trackTitle: string,
  channelTitle?: string | null,
): VideoKind {
  if (channelTitle && /-\s*topic\s*$/i.test(channelTitle.trim())) return "audio";
  const rest = removeTrackTitle(uploadTitle, trackTitle);
  if (OTHER_MARKERS.test(rest)) return "other";
  if (VIDEO_MARKERS.test(rest)) return "video";
  if (AUDIO_MARKERS.test(rest)) return "audio";
  // An unmarked upload ("Artist - Title") is how Art Tracks and most audio
  // uploads are titled on Discogs — treat it as the audio tier.
  return "audio";
}

function removeTrackTitle(uploadTitle: string, trackTitle: string): string {
  const t = trackTitle.trim();
  if (!t) return uploadTitle;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return uploadTitle.replace(new RegExp(escaped, "i"), " ");
}

interface Scored {
  videoId: string;
  kind: VideoKind;
  score: number;
  diff: number;
}

/**
 * Score every upload that could be this track.
 *
 * Title match drives correctness. We compare the normalized track title against
 * BOTH the full video title and its artist-prefix-stripped form, and split into:
 *   • EXACT title match → accept even when the video is a fair bit longer/shorter
 *     (official videos carry intros/outros — the 222s album cut vs the 259s
 *     "Lorde - Perfect Places" video). Only a wild >150s gap (full-album upload)
 *     is rejected.
 *   • substring-only match → require a TIGHT duration (≤12s), because a short
 *     title is a substring of a different song ("Sober" ⊂ "Sober II") and only a
 *     near-identical length makes it safe.
 * Either way the upload must be the song's own version (versionAgreement): a
 * remix, an extended or numbered mix, an edit or a demo of a song is not it.
 * Then rank by exact-ness, embeddability, and closeness of duration.
 */
function scoreCandidates(track: TrackForMatch, videos: DiscogsVideo[]): Scored[] {
  const normTitle = normalize(foldAmpersand(track.title));
  if (!normTitle) return [];

  const out: Scored[] = [];
  for (const v of videos) {
    const id = extractYouTubeId(v.uri);
    if (!id) continue;

    const full = normalize(foldAmpersand(v.title));
    const stripped = normalize(foldAmpersand(stripArtistPrefix(v.title)));
    const exact = full === normTitle || stripped === normTitle;
    const contains = full.includes(normTitle) || stripped.includes(normTitle);
    if (!exact && !contains) continue;

    const diff =
      track.durationSeconds && v.duration
        ? Math.abs(v.duration - track.durationSeconds)
        : Number.POSITIVE_INFINITY;

    if (exact) {
      if (diff > 150) continue; // exact title but ~2.5min off = wrong upload
    } else if (!(diff <= 12)) {
      continue; // loose title needs a near-exact length to be trusted
    }

    // Another version of the song is not the song (BUG-578): an upload naming a version the song
    // doesn't, or a different one, is refused; one that says nothing about the version the song
    // names is held to the same near-exact length as a loose title.
    const version = versionAgreement(track.title, v.title);
    if (version === "different") continue;
    if (version === "unsaid" && !(diff <= 12)) continue;

    let score = 1;
    if (exact) score += 5;
    if (v.embed) score += 2;
    if (diff <= 3) score += 4;
    else if (diff <= 10) score += 2;
    else if (diff <= 30) score += 1;

    out.push({ videoId: id, kind: classifyVideoKind(v.title, track.title), score, diff });
  }
  return out;
}

function better(a: Scored, b: Scored | null): boolean {
  return !b || a.score > b.score || (a.score === b.score && a.diff < b.diff);
}

function toMatched(s: Scored | null): MatchedVideo | null {
  return s ? { videoId: s.videoId, url: watchUrl(s.videoId), kind: s.kind } : null;
}

/** Choose the best Discogs video for one track, regardless of kind. */
export function bestVideoForTrack(
  track: TrackForMatch,
  videos: DiscogsVideo[],
): { videoId: string; url: string } | null {
  let best: Scored | null = null;
  for (const s of scoreCandidates(track, videos)) if (better(s, best)) best = s;
  const m = toMatched(best);
  return m ? { videoId: m.videoId, url: m.url } : null;
}

/**
 * Choose the best upload of EACH kind for one track (plus the best overall).
 * Any of the three can be null; `video` and `audio` may point at the same id
 * only when a single upload is all that exists.
 */
export function bestVideosByKind(
  track: TrackForMatch,
  videos: DiscogsVideo[],
): MatchedVideosByKind {
  let canonical: Scored | null = null;
  let video: Scored | null = null;
  let audio: Scored | null = null;
  for (const s of scoreCandidates(track, videos)) {
    if (better(s, canonical)) canonical = s;
    if (s.kind === "video" && better(s, video)) video = s;
    if (s.kind === "audio" && better(s, audio)) audio = s;
  }
  return { canonical: toMatched(canonical), video: toMatched(video), audio: toMatched(audio) };
}

/**
 * Order stored ids into what the player should try, first to last: the
 * showcase video, then the audio upload, then the legacy best-overall row.
 * Duplicates collapse, so a track with one id yields one candidate.
 */
export function orderPlayback(ids: {
  video?: string | null;
  audio?: string | null;
  canonical?: string | null;
}): string[] {
  const out: string[] = [];
  for (const id of [ids.video, ids.audio, ids.canonical]) {
    if (isVideoId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

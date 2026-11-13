/**
 * Sending a song from the window (the founder, 2026-10-27: right-click, Copy Link and Share…, no note on
 * this surface). The cloud's /api/share/song does the work, as for the web and the phones: GET says
 * whether a song can be sent now (one of its videos still plays), POST saves the share under a code made
 * here, so the link is known before the save lands.
 *
 * Copy Link hands the clipboard a promise of the link, so the clipboard takes it only once the share is
 * saved: a quick paste into Messages never reaches a page that says the song isn't there. Share… opens
 * the Mac's own share menu with the link at once (a page may only ask inside the click), and the save
 * lands while the person picks where to send it.
 *
 * One link per song per window: copying it twice, or copying then sharing, hands out the same link.
 */

import type { MenuItem } from "@discovery/cassette-kit";
import { PUBLIC_SITE_URL as SITE } from "@/lib/urls";
import type { OwnedTrack } from "./types";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEEP_MS = 30 * 60 * 1000;

type Say = (msg: string, opts?: { variant?: "info" | "success" | "error" }) => void;
type Song = Pick<OwnedTrack, "subsonicTrackId" | "cassetteLocalId">;
type Miss = "no_video" | "not_in_catalog" | "not_found" | "not_visible" | "taken" | "signed_out" | "failed";

/** An 8-character code like the phone's, from the browser's own randomness (no letter favoured). */
export function newShareCode(): string {
  let out = "";
  while (out.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 248 && out.length < 8) out += ALPHABET[b % 62];
  }
  return out;
}

const keyOf = (t: Song) => (t.subsonicTrackId ? `s:${t.subsonicTrackId}` : t.cassetteLocalId ? `l:${t.cassetteLocalId}` : null);
const idsOf = (t: Song) => ({
  ...(t.subsonicTrackId ? { subsonic_track_id: t.subsonicTrackId } : {}),
  ...(t.cassetteLocalId ? { cassette_local_id: t.cassetteLocalId } : {}),
});

/** What a person reads when a song can't be sent. */
export function missWords(m: Miss): string {
  if (m === "no_video") return "No video to share yet";
  if (m === "not_in_catalog" || m === "not_found" || m === "not_visible") return "Cassette doesn't know this song yet";
  if (m === "signed_out") return "Sign in to share";
  return "That link didn't save. Try again.";
}

/* ── can it be sent: asked as a menu opens, kept half an hour ── */

type Answer = { ok: true } | { ok: false; miss: Miss };
const answers = new Map<string, { a: Answer; at: number }>();
const asking = new Map<string, Promise<Answer | null>>();

function known(key: string): Answer | null {
  const got = answers.get(key);
  return got && Date.now() - got.at < KEEP_MS ? got.a : null;
}

/** The cloud's answer, one question per song at a time; null when it couldn't say (offline, an error). */
function ask(t: Song, key: string): Promise<Answer | null> {
  const already = asking.get(key);
  if (already) return already;
  const q = new URLSearchParams(idsOf(t));
  const p = fetch(`/api/share/song?${q}`, { cache: "no-store" })
    .then(async (res): Promise<Answer | null> => {
      if (res.status === 401) return { ok: false, miss: "signed_out" };
      if (!res.ok) return null;
      const j = (await res.json()) as { shareable?: boolean; reason?: Miss };
      return j.shareable ? { ok: true } : { ok: false, miss: j.reason ?? "not_found" };
    })
    .catch(() => null)
    .then((a) => {
      asking.delete(key);
      // signed out isn't the song's answer: ask again once they're in
      if (a && !(a.ok === false && a.miss === "signed_out")) answers.set(key, { a, at: Date.now() });
      return a;
    });
  asking.set(key, p);
  return p;
}

/* ── the save ── */

const codes = new Map<string, string>();
const saved = new Set<string>();
const saving = new Map<string, Promise<void>>();

class ShareMiss extends Error {
  constructor(readonly miss: Miss) {
    super(miss);
  }
}

function linkOf(key: string): { code: string; url: string } {
  let code = codes.get(key);
  if (!code) codes.set(key, (code = newShareCode()));
  return { code, url: `${SITE}/s/${code}` };
}

/** Save the share under its code; resolves once the link leads to the song, rejects with a ShareMiss. */
function save(t: Song, key: string, code: string): Promise<void> {
  if (saved.has(key)) return Promise.resolve();
  const already = saving.get(key);
  if (already) return already;
  const p = fetch("/api/share/song", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: code, ...idsOf(t) }),
  })
    .then(async (res) => {
      if (res.status === 401) throw new ShareMiss("signed_out");
      const j = (await res.json().catch(() => null)) as { ok?: boolean; reason?: Miss } | null;
      if (!j?.ok) {
        const miss = j?.reason ?? "failed";
        // someone else holds that code: the next try makes a new one
        if (miss === "taken") codes.delete(key);
        else if (miss !== "failed") answers.set(key, { a: { ok: false, miss }, at: Date.now() });
        throw new ShareMiss(miss);
      }
      saved.add(key);
      answers.set(key, { a: { ok: true }, at: Date.now() });
    }, () => {
      throw new ShareMiss("failed");
    })
    .finally(() => saving.delete(key));
  saving.set(key, p);
  return p;
}

const missOf = (e: unknown): Miss => (e instanceof ShareMiss ? e.miss : "failed");

/** Copy Link: the clipboard is handed the link once the share is saved, then "Link copied". */
export function copySongLink(t: Song, say: Say) {
  const key = keyOf(t);
  if (!key) return say(missWords("not_in_catalog"), { variant: "error" });
  const { code, url } = linkOf(key);
  const ready = save(t, key, code);
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  // asked inside the click, so the browser lets it write; it waits on the save before it does
  const wrote =
    clip?.write && typeof ClipboardItem !== "undefined"
      ? clip.write([new ClipboardItem({ "text/plain": ready.then(() => new Blob([url], { type: "text/plain" })) })])
      : ready.then(() => clip?.writeText(url));
  Promise.allSettled([ready, wrote]).then(async ([r, w]) => {
    if (r.status === "rejected") return say(missWords(missOf(r.reason)), { variant: "error" });
    if (w.status === "fulfilled") return say("Link copied");
    // a browser that wouldn't take the promise: the plain write, now the link is ready
    try {
      await clip?.writeText(url);
      say("Link copied");
    } catch {
      say("Couldn't copy the link. Try again.", { variant: "error" });
    }
  });
}

/** Share…: the Mac's own share menu with the link (the clipboard where there's none). */
export function shareSong(t: Song, say: Say) {
  const key = keyOf(t);
  if (!key) return say(missWords("not_in_catalog"), { variant: "error" });
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return copySongLink(t, say);
  const { code, url } = linkOf(key);
  save(t, key, code).catch((e) => say(missWords(missOf(e)), { variant: "error" }));
  navigator.share({ url }).catch((e: unknown) => {
    if ((e as { name?: string })?.name !== "AbortError") say("Couldn't open the share menu", { variant: "error" });
  });
}

/**
 * The menu's Copy Link and Share…: greyed, with why, when the song can't be sent. Known: at once.
 * Not yet asked: on at once (as the phone leaves Share on while it doesn't know), and they change in
 * place if the answer, asked now, says no.
 */
export function shareLines(t: Song, say: Say): MenuItem[] {
  const lines = (a: Answer | null): MenuItem[] => {
    const off = a?.ok === false;
    return [
      { label: "Copy Link", onSelect: () => copySongLink(t, say), disabled: off },
      { label: "Share…", onSelect: () => shareSong(t, say), disabled: off },
      ...(a?.ok === false ? [{ caption: missWords(a.miss) }] : []),
    ];
  };
  const key = keyOf(t);
  if (!key) return lines({ ok: false, miss: "not_in_catalog" });
  const a = known(key);
  return a ? lines(a) : [{ later: ask(t, key).then(lines), until: lines(null) }];
}

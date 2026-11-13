/**
 * "Open on YouTube" — hand a list of video ids to YouTube as a temporary
 * playlist, with no account, no login, and no Data API quota.
 *
 * YouTube's `watch_videos?video_ids=a,b,c` endpoint turns the list into an
 * on-the-fly playlist (it redirects to `watch?v=a&list=TL…`). On a phone the
 * link opens in the YouTube app when it is installed, where a Premium member
 * gets background play — YouTube's own sanctioned way to put a Cassette
 * mixtape in someone's pocket. The endpoint is long-lived but undocumented, so
 * this helper is the ONE place the URL shape lives.
 *
 * Caps at 50 ids (the endpoint's practical limit); a single id becomes a plain
 * watch link, since a one-item "playlist" is just noise.
 */

import { isVideoId, watchUrl } from "./youtube-match";

export const YOUTUBE_TEMP_PLAYLIST_MAX = 50;

/** Distinct, valid ids in order, capped to what the endpoint accepts. */
export function playableIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (isVideoId(id) && !out.includes(id)) out.push(id);
    if (out.length >= YOUTUBE_TEMP_PLAYLIST_MAX) break;
  }
  return out;
}

/** The link, or null when there is nothing playable. */
export function youtubeTempPlaylistUrl(
  ids: ReadonlyArray<string | null | undefined>,
): string | null {
  const list = playableIds(ids);
  if (list.length === 0) return null;
  if (list.length === 1) return watchUrl(list[0]);
  return `https://www.youtube.com/watch_videos?video_ids=${list.join(",")}`;
}

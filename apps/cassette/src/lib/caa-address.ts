/**
 * The Cover Art Archive's own address for a cover saved from one of archive.org's
 * storage hosts (BUG-439, BUG-566).
 *
 * CAA answers every image request with a redirect to whichever archive.org host holds
 * the file that day (dn710404.ca.archive.org one week, ia801604.us.archive.org the
 * next), and the cover backfill used to store that redirect target. The image resizer
 * only accepts coverartarchive.org, and the storage host moves, so the CAA address is
 * the one to serve and to store. It points at the same file: same release, same image id.
 *
 * No imports, so scripts can use it without the app's module chain.
 */

// archive.org/download/mbid-<release>/mbid-<release>-<image id>.<ext>, or the same file on a
// storage host: <node>.<region>.archive.org/<n>/items/mbid-<release>/mbid-<release>-<image id>.<ext>
const ARCHIVE_COPY =
  /^https?:\/\/(?:[a-z0-9-]+\.)*archive\.org\/(?:download|\d+\/items)\/mbid-([0-9a-f-]{36})\/mbid-\1-(\d+)\.(jpe?g|png|gif|webp)$/i;

/** The coverartarchive.org address for an archive.org copy of a CAA image; null for anything else. */
export function caaAddressForArchiveCopy(url: string): string | null {
  const m = ARCHIVE_COPY.exec(url);
  return m ? `https://coverartarchive.org/release/${m[1]!.toLowerCase()}/${m[2]}.${m[3]!.toLowerCase()}` : null;
}

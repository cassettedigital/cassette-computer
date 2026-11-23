/**
 * Client-side album-cover commit pipeline, shared by every "set a personal
 * cover" entry point (the rail hover-pencil and the Edit-album cover editor):
 * normalize → presign → PUT to R2 → save the per-album override
 * (user_album_cover_override) → write it into the user's folder cover.jpg.
 *
 * THE FOLDER COVER IS THE SOURCE OF TRUTH. Every satellite reads it (iOS via
 * Navidrome, desktop, web), and the cloud row is a copy that lets us render and
 * re-attempt. A pick is therefore not finished until the folder has it: on
 * success we confirm it (mirrored_at, 0084), and on a miss the row stays pending
 * so the sweep retries. An unreachable or sleeping hub is a DELAY, never a
 * dropped edit — and never a reason to push our copy at their devices instead.
 * DECOUPLED from album identity.
 *
 * normalizeCoverImage redraws any browser-readable image at NATIVE ratio
 * (longest side capped) and re-encodes as JPEG — strips metadata, normalizes the
 * format for the presign allowlist, never crops to square.
 */

import { replaceAlbumCover } from "@/lib/library-remote";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { bumpLocalCoverEpoch } from "@/lib/local-cover-epoch";
import { putSignedUpload } from "@/lib/signed-upload";

export type CoverSource = "upload" | "paste" | "url" | "caa";

/** Record that this pick reached the user's folder. Never throws: the cover IS on
 *  disk at this point, so a failed confirmation only means the sweep re-attempts a
 *  write that is already correct — harmless, and far safer than marking a pick
 *  applied when it is not. */
export async function confirmCoverMirrored(
  encodedGroupKey: string,
  coverUrl: string
): Promise<void> {
  try {
    await fetch(`/api/sync/library/album/${encodedGroupKey}/cover/mirrored`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coverUrl }),
    });
  } catch {
    // pending is the safe state — leave it
  }
}

export async function normalizeCoverImage(
  src: Blob,
  maxSide = 1400
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const url = URL.createObjectURL(src);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("decode"));
      i.src = url;
    });
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (!w || !h) return null;
    const longest = Math.max(w, h);
    if (longest > maxSide) {
      const s = maxSide / longest;
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92)
    );
    if (!blob) return null;
    return { blob, width: w, height: h };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type CommitCoverResult =
  | { ok: true; mirrorMissed: boolean }
  | { ok: false; error: string };

/**
 * Commit a raw image blob as the album's personal cover. Handles normalize →
 * presign → upload → save → best-effort disk mirror. Returns a discriminated
 * result the caller turns into a toast.
 */
export async function commitAlbumCover(opts: {
  groupKey: string;
  blob: Blob;
  source: CoverSource;
  /** Any owned track in the album — anchors the sidecar folder write. Null skips
   *  it (then only the cloud copy exists, and only if R2 is configured). */
  localCoverTrackId: string | null;
}): Promise<CommitCoverResult> {
  const norm = await normalizeCoverImage(opts.blob);
  if (!norm) return { ok: false, error: "Couldn't read that image." };

  const encodedKey = toBase64Url(opts.groupKey);

  // ── The cloud copy (best-effort) ──────────────────────────────────────────
  // Presign → PUT to R2 → save the override row. This is what makes a pick render
  // on the WEB and reach other devices. It is deliberately NOT fatal: the desktop
  // app's bundled server carries no R2 upload creds (they are stripped from the
  // distributable), so its presign returns storage_unconfigured. That used to fail
  // the whole action with "Cover upload isn't available right now" — but the folder
  // write below is the REAL save (the folder cover is the source of truth every
  // satellite reads), so a missing cloud copy must not block setting a cover. Web
  // runs this first because it is fast (Vercel) and is web's only save path.
  let cloudSaved = false;
  let cloudPublicUrl: string | null = null;
  let cloudError: string | null = null;
  try {
    const presignRes = await fetch(`/api/sync/library/album/${encodedKey}/cover/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // the link is signed for exactly this many bytes (BUG-1012)
      body: JSON.stringify({ contentType: "image/jpeg", fileSize: norm.blob.size }),
    });
    if (presignRes.ok) {
      const { presignedUrl, publicUrl } = (await presignRes.json()) as {
        presignedUrl: string;
        publicUrl: string;
      };
      // from the app through its own server, which the store lets in (BUG-1075)
      if (await putSignedUpload(presignedUrl, norm.blob, "image/jpeg")) {
        const saveRes = await fetch(`/api/sync/library/album/${encodedKey}/cover`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            coverUrl: publicUrl,
            source: opts.source,
            width: norm.width,
            height: norm.height,
            bytes: norm.blob.size,
          }),
        });
        if (saveRes.ok) {
          cloudSaved = true;
          cloudPublicUrl = publicUrl;
        } else cloudError = "Couldn't save that cover.";
      } else cloudError = "The cover didn't upload. Try again.";
    } else {
      const b = await presignRes.json().catch(() => ({}) as { message?: string });
      cloudError = b.message ?? "Couldn't upload that cover.";
    }
  } catch {
    cloudError = "Couldn't upload that cover.";
  }

  // ── Their library (the real save) ─────────────────────────────────────────
  // Write it into the folder cover.jpg the hub holds — the source of truth every
  // satellite (this desktop app, iOS via Navidrome, web's sidecar reads) resolves
  // covers from. On the desktop app this is a local write that works fully offline;
  // on the web it reaches the hub only when it is awake and reachable.
  let folderWrote = false;
  if (opts.localCoverTrackId) {
    const local = await replaceAlbumCover(opts.localCoverTrackId, norm.blob);
    folderWrote = local.reachable && local.ok;
    // Mark the cloud row mirrored only when BOTH copies landed (nothing to confirm
    // when there is no cloud row, e.g. the desktop app with R2 unconfigured).
    if (folderWrote && cloudSaved && cloudPublicUrl) {
      await confirmCoverMirrored(encodedKey, cloudPublicUrl);
    }
  }

  // The cover is set if it landed ANYWHERE renderable — the folder (desktop /
  // reachable hub) or the cloud (web). Only a total miss is an error.
  if (!cloudSaved && !folderWrote) {
    return { ok: false, error: cloudError ?? "Couldn't set that cover." };
  }
  // Folder cover is rewritten in place at a stable URL — bust every local <img>
  // so the desktop grid/rail/transport refetch immediately (BUG-106).
  if (folderWrote) bumpLocalCoverEpoch();
  // mirrorMissed drives the "your phone copy will update on the next sync" toast:
  // it means we saved a cloud copy but couldn't reach the hub to write the folder.
  // On desktop the folder write succeeds, so this is false → a plain "Cover updated."
  const mirrorMissed = Boolean(opts.localCoverTrackId) && !folderWrote;
  return { ok: true, mirrorMissed };
}

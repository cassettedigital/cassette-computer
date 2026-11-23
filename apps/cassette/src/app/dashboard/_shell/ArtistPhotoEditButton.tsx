"use client";

/**
 * ArtistPhotoEditButton — "just for my library" artist photo. Mirrors
 * AlbumCoverReplaceButton (hover-reveal pencil → CoverCropper → upload) with
 * two differences: the source can also be a clipboard paste (an image blob,
 * or a plain URL relayed through /api/sync/library/image-fetch — see that
 * route for why it's proxied server-side instead of fetched directly), and
 * confirming writes to BOTH the R2+DB override (what the web app renders)
 * and the sidecar's local folder mirror (see replaceArtistFolderPhoto,
 * cover-art.go). Either one landing is a save (see saveToCloud below).
 *
 * Paste is armed by hovering the photo (mirroring the hover-reveal pencil
 * itself) so Cmd+V works without an extra click to focus anything first.
 */

import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "@/app/components/Modal";
import { CoverCropper } from "@/app/dashboard/library/components/CoverCropper";
import { replaceArtistPhoto } from "@/lib/library-remote";
import { bumpLocalCoverEpoch } from "@/lib/local-cover-epoch";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { putSignedUpload } from "@/lib/signed-upload";
import { useShell } from "./shell-context";
import styles from "./ArtistPhotoEditButton.module.css";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function ArtistPhotoEditButton({
  groupKey,
  trackId,
  onReplaced,
}: {
  groupKey: string;
  /** Any owned track by this artist — anchors the sidecar's local-folder
   *  write (see replaceArtistPhoto). Optional: the R2+DB override still
   *  works with none, e.g. an artist whose tracks failed to resolve a
   *  subsonicTrackId; that write is just skipped. */
  trackId: string | null;
  onReplaced: () => void;
}) {
  const { showToast } = useShell();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!ALLOWED_TYPES.has(f.type)) {
      showToast("Please choose a JPEG, PNG, or WebP image.", { variant: "error" });
      return;
    }
    setFile(f);
  }

  async function fetchPastedUrl(url: string) {
    try {
      const r = await fetch("/api/sync/library/image-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}) as { message?: string });
        showToast(body.message ?? "Couldn't load that image.", { variant: "error" });
        return;
      }
      const blob = await r.blob();
      setFile(new File([blob], "pasted-image", { type: blob.type || "image/jpeg" }));
    } catch {
      showToast("Couldn't load that image.", { variant: "error" });
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            setFile(new File([blob], "pasted-image", { type: blob.type }));
            return;
          }
        }
      }
    }
    const text = e.clipboardData?.getData("text/plain")?.trim();
    if (text && /^https?:\/\//i.test(text)) {
      e.preventDefault();
      void fetchPastedUrl(text);
    }
  }

  // The cloud copy (R2 + the override row, what the web renders) and the copy in the artist's folder
  // on the Mac (what the Mac and the desktop app show). Either one landing is a save. Like an album cover
  // (commitAlbumCover), the cloud copy is best-effort beside the folder write; from the app it goes up
  // through the app's own server, since the store refuses the window itself (BUG-1075: it never landed).
  async function saveToCloud(blob: Blob): Promise<boolean> {
    const encodedKey = toBase64Url(groupKey);
    const presignRes = await fetch(`/api/sync/library/artist/${encodedKey}/photo/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // the link is signed for exactly this many bytes (BUG-1012)
      body: JSON.stringify({ contentType: "image/jpeg", fileSize: blob.size }),
    }).catch(() => null);
    if (!presignRes?.ok) return false;
    const { presignedUrl, publicUrl } = (await presignRes.json()) as { presignedUrl: string; publicUrl: string };
    if (!(await putSignedUpload(presignedUrl, blob, "image/jpeg"))) return false;
    const saveRes = await fetch(`/api/sync/library/artist/${encodedKey}/photo`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: publicUrl }),
    }).catch(() => null);
    return !!saveRes?.ok;
  }

  async function onCropped(blob: Blob) {
    setUploading(true);
    try {
      const [cloud, local] = await Promise.all([saveToCloud(blob), trackId ? replaceArtistPhoto(trackId, blob) : Promise.resolve(null)]);
      const onMac = !!local?.ok;
      if (!cloud && !onMac) {
        showToast("Couldn't save that photo.", { variant: "error" });
        return;
      }
      if (onMac) bumpLocalCoverEpoch();
      if (cloud && !onMac) {
        showToast("Photo updated. Your computer isn't answering, so its copy wasn't updated.", { variant: "info" });
      } else {
        showToast("Artist photo updated.", { variant: "success" });
      }
      onReplaced();
    } finally {
      setUploading(false);
      setFile(null);
    }
  }

  return (
    <>
      <button
        ref={editButtonRef}
        type="button"
        className={styles.editHint}
        onClick={() => fileInputRef.current?.click()}
        onPaste={onPaste}
        // Focusing on hover — not just on click — is what lets a bare Cmd+V
        // over the photo work, matching the hover-reveal affordance itself;
        // paste events only fire on the currently focused element.
        onMouseEnter={() => editButtonRef.current?.focus({ preventScroll: true })}
        onMouseLeave={() => editButtonRef.current?.blur()}
        aria-label="Replace artist photo — click to upload, or paste an image or image URL"
        disabled={uploading}
      >
        <Pencil size={13} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={onFileSelected}
      />
      <Modal
        isOpen={file !== null}
        onOpenChange={(open) => {
          if (!open) setFile(null);
        }}
        title="Replace artist photo"
      >
        {() => (file ? <CoverCropper file={file} onCancel={() => setFile(null)} onCropped={onCropped} /> : null)}
      </Modal>
    </>
  );
}

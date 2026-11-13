"use client";

/**
 * ProfileAvatarPicker: wear a Y2K sticker or upload your own photo.
 *
 * A featured row (upload chip + a spread of stickers + an expand chip) reveals
 * the whole set on click. Choosing a sticker stores its R2 url in users.image,
 * the same field an uploaded photo uses, so it renders on every surface with no
 * sticker-aware rendering code and syncs to the phones on the next GET
 * /api/sync/account. New accounts get one at random (see the signup default);
 * this is where a person changes it.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ChevronDown } from "lucide-react";
import { Note } from "@discovery/cassette-kit";
import { AvatarDisc } from "@/app/components/AvatarDisc";
import { coerceAvatarPreset, type AvatarPresetId } from "@/lib/avatar";
import { normalizeCoverImage } from "@/lib/library-cover";
import { AVATAR_STICKERS, featuredStickers, isStickerUrl } from "@/lib/avatar-stickers";
import styles from "./ProfileAvatarPicker.module.css";

export function ProfileAvatarPicker({
  currentImage,
  currentPreset,
  name,
  email,
}: {
  currentImage: string | null;
  currentPreset: string;
  name: string | null;
  email: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(currentImage);
  const [preset, setPreset] = useState<AvatarPresetId>(coerceAvatarPreset(currentPreset));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false);

  async function save(body: { image_url?: string | null; avatar_preset?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/avatar", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "Couldn't save that.");
      }
      const data = (await res.json()) as { image: string | null; avatarPreset: string };
      setImage(data.image);
      setPreset(coerceAvatarPreset(data.avatarPreset));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  async function pickSticker(url: string) {
    if (busy || url === image) return;
    setImage(url);
    await save({ image_url: url });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) {
      setError("Please choose an image.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const norm = await normalizeCoverImage(file, 800);
      if (!norm) throw new Error("Couldn't read that image.");

      const presignRes = await fetch("/api/account/avatar/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        // the link is signed for exactly this many bytes (BUG-1012)
        body: JSON.stringify({ contentType: "image/jpeg", fileSize: norm.blob.size }),
      });
      if (!presignRes.ok) {
        const data = (await presignRes.json().catch(() => null)) as { message?: string } | null;
        throw new Error(data?.message ?? "Upload isn't available right now.");
      }
      const { presignedUrl, publicUrl } = (await presignRes.json()) as {
        presignedUrl: string;
        publicUrl: string;
      };
      const putRes = await fetch(presignedUrl, {
        method: "PUT",
        body: norm.blob,
        headers: { "Content-Type": "image/jpeg" },
      });
      if (!putRes.ok) throw new Error("Upload failed, try again.");

      setImage(publicUrl);
      await save({ image_url: publicUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that.");
      setBusy(false);
    }
  }

  const featured = featuredStickers();
  // The upload chip lights when the current avatar is an uploaded photo (an
  // image that isn't one of our stickers).
  const photoActive = Boolean(image) && !isStickerUrl(image);

  return (
    <div className={styles.picker}>
      <AvatarDisc image={image} preset={preset} name={name} email={email} size={64} />

      <div>
        <div className={styles.row}>
          {/* Upload an image — first chip. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            aria-pressed={photoActive}
            aria-label={photoActive ? "Replace your photo" : "Upload an image"}
            title={photoActive ? "Replace your photo" : "Upload an image"}
            className={`${styles.chip} ${photoActive ? styles.chipSelected : ""}`}
          >
            <span className={styles.actionDisc}>
              <Upload size={18} strokeWidth={1.75} />
            </span>
          </button>

          {featured.map((s) => {
            const on = image === s.url;
            return (
              <button
                key={s.id}
                type="button"
                disabled={busy}
                onClick={() => void pickSticker(s.url)}
                aria-pressed={on}
                aria-label={`Sticker ${s.id}`}
                className={`${styles.chip} ${on ? styles.chipSelected : ""}`}
              >
                <AvatarDisc image={s.url} preset={null} name={name} email={email} size={44} />
              </button>
            );
          })}

          {/* Expand: reveals the whole set. Drawn like upload: it's an
              action, not a sticker. */}
          <button
            type="button"
            onClick={() => setLibOpen((v) => !v)}
            aria-expanded={libOpen}
            aria-label={libOpen ? "Hide all stickers" : "Show all stickers"}
            title={libOpen ? "Hide all stickers" : "Show all stickers"}
            className={styles.chip}
          >
            <span className={styles.actionDisc}>
              <ChevronDown
                size={18}
                strokeWidth={1.75}
                className={`${styles.moreChev} ${libOpen ? styles.moreChevOpen : ""}`}
              />
            </span>
          </button>
        </div>

        {libOpen && (
          <div className={styles.panel}>
            <div className={styles.libgrid}>
              {AVATAR_STICKERS.map((s) => {
                const on = image === s.url;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void pickSticker(s.url)}
                    aria-pressed={on}
                    aria-label={`Sticker ${s.id}`}
                    className={`${styles.chip} ${on ? styles.chipSelected : ""}`}
                  >
                    <AvatarDisc image={s.url} preset={null} name={name} email={email} size={40} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {error && <Note tone="danger">{error}</Note>}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e)} />
    </div>
  );
}

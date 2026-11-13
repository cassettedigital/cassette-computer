"use client";

/**
 * AvatarDisc — one circular profile mark for every surface (sidebar footer,
 * account picker preview, etc.). Photo wins; else silhouette / initials / emoji.
 *
 * Silhouette matches iOS: cream person.circle.fill glyph (circle with the
 * person cut out), no brown disc. Initials / emoji sit on the same milled
 * grey key as IconButton.
 */

import {
  avatarInitials,
  presetEmoji,
  resolveAvatar,
  type AvatarPresetId,
} from "@/lib/avatar";
import styles from "./AvatarDisc.module.css";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";

export function AvatarDisc({
  image,
  preset,
  name,
  email,
  size = 30,
}: {
  image: string | null | undefined;
  preset: string | null | undefined;
  name?: string | null;
  email?: string | null;
  size?: number;
}) {
  const resolved = resolveAvatar(image, preset);
  const fontSize = Math.round(size * 0.4);

  if (resolved.kind === "photo") {
    return (
      <span className={styles.photo} style={{ width: size, height: size }}>
        <Picture
          {...picture(resolved.url, "avatar")}
          frame={size}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </span>
    );
  }

  if (resolved.preset === "silhouette") {
    return (
      <span
        className={styles.silhouette}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <PersonCircleGlyph size={size} />
      </span>
    );
  }

  if (resolved.preset === "initials") {
    return (
      <span className={`${styles.key} ${styles.initials}`} style={{ width: size, height: size, fontSize }}>
        {avatarInitials(name, email)}
      </span>
    );
  }

  const emoji = presetEmoji(resolved.preset);
  return (
    <span
      className={`${styles.key} ${styles.emoji}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      title={emoji ?? undefined}
    >
      <span aria-hidden="true">{emoji}</span>
    </span>
  );
}

/** Cream person.circle.fill — filled circle with person knocked out (iOS default). */
function PersonCircleGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2ZM8.5 9.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0ZM12 14c-2.5 0-4.7 1.35-5.85 3.35A7.96 7.96 0 0 0 12 20a7.96 7.96 0 0 0 5.85-2.65C16.7 15.35 14.5 14 12 14Z"
      />
    </svg>
  );
}

export type { AvatarPresetId };

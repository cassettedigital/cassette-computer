'use client';

import { useEffect, useState } from "react";
import { Picture } from "@discovery/cassette-kit/picture";
import { HubPicture } from "./HubPicture";
import { picture } from "@/lib/images/picture";
import { artistPhotoURL, SIDECAR_SAME_ORIGIN } from "@/lib/playback-remote";
import styles from "./ArtistPhoto.module.css";

interface ArtistPhotoProps {
  imageUrl?: string | null;
  name: string;
  /**
   * Owned-library Subsonic track id anchoring the artist's on-disk folder, for
   * the sidecar's local artist-photo proxy. In the desktop app (same-origin
   * sidecar) this materialized on-disk photo is PREFERRED — instant, offline,
   * no CDN/optimizer — the artist parallel of CoverArt's localCoverTrackId. On
   * the web it's ignored (no sidecar). Unset → catalog / initials only.
   */
  localArtistPhotoTrackId?: string | null;
  /** True when `imageUrl` is a cover the USER PICKED (an override) rather than our
   *  catalog image. On the web (no local hub) a pick leads. On desktop, the local
   *  on-disk photo leads instead — it already holds any pick the user made (see
   *  ArtistPhotoEditButton, which mirrors an override write into the sidecar file
   *  the same way AlbumCoverReplaceButton does for albums). Same precedence shape
   *  as CoverArt/AlbumCover's shared pickAlbumCoverTier (album-tier.ts). */
  imageIsOverride?: boolean;
  /** Explicit pixel size (square). Omit for fill mode — the parent sizes it. */
  size?: number;
  className?: string;
  /** The (square) frame's width for the browser's pick: needed in fill mode, or when CSS sizes the box. */
  sizes?: string;
  priority?: boolean;
  /**
   * Render bare — no `.wrap`, no overlay, no ghost-initials fallback — so the
   * photo drops into a caller-owned frame (hero well). Returns null when the
   * image is missing or errors; the caller owns the empty state. Fill mode
   * (no `size`) needs a positioned parent. Supported replacement for a bare
   * <img> photo.
   */
  bare?: boolean;
  /**
   * Decorative blurred backdrop (the card "glow"). Implies bare, hidden from
   * assistive tech. Always the ladder's smallest size: resolution is irrelevant
   * once the parent `.glow` blurs it. Returns null when there is no photo.
   */
  decorative?: boolean;
  /** Fired when bare mode has nothing left to show after a load failure. */
  onError?: () => void;
}

/** Circular artist photo with dark overlay, or ghost initials if missing or on load error. */
export function ArtistPhoto({
  imageUrl,
  localArtistPhotoTrackId,
  imageIsOverride = false,
  name,
  size,
  className = "",
  sizes,
  priority = false,
  bare = false,
  decorative = false,
  onError,
}: ArtistPhotoProps) {
  const [catalogError, setCatalogError] = useState(false);
  const [localError, setLocalError] = useState(false);
  useEffect(() => {
    setCatalogError(false);
    setLocalError(false);
  }, [imageUrl, localArtistPhotoTrackId]);

  const art = picture(imageUrl, "photo");
  // The caller's `sizes` when it gave one, else a fixed size is its own frame, else a small circle's.
  const frame = sizes ? { sizes, square: true } : size ? { frame: size } : { sizes: "120px", square: true };

  // Decorative glow backdrop: blurred + sized by the parent `.glow`, hidden
  // from AT, always the catalog source (blurred, so local-vs-catalog is
  // imperceptible), at the smallest size.
  if (decorative) {
    if (!imageUrl) return null;
    return <Picture {...art} rung={120} alt="" aria-hidden="true" fill className={className || undefined} />;
  }

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  const displaySize = size ?? 300;
  // The local photo is the hub's, so only where this page can reach a hub (never the website in a
  // regular browser: lib/hub-origin).
  const localSrc = localArtistPhotoTrackId && !localError ? artistPhotoURL(localArtistPhotoTrackId, displaySize * 2) : null;
  const localAvail = localSrc !== null;
  const catalogAvail = Boolean(imageUrl && !catalogError);
  // Same precedence formula as pickAlbumCoverTier (album-tier.ts), adapted to
  // this component's data shape (one `imageUrl`, flagged override-or-not,
  // rather than two separate URLs — override and catalog render identically
  // below, so only the local-vs-imageUrl ordering actually matters). Desktop
  // app (SIDECAR_SAME_ORIGIN): the local on-disk photo leads outright — it's
  // instant, offline, and already mirrors any pick (see imageIsOverride's doc).
  // Web (no local hub): a pick leads, then catalog. Previously this computed
  // showOverride first unconditionally, which let a cloud override beat the
  // local photo on desktop too — the reverse of what AlbumCover does for
  // album covers, and a real "wrong photo shown" bug (BUG-286).
  const imageAvail = imageIsOverride && catalogAvail;
  const showLocal = localAvail && (SIDECAR_SAME_ORIGIN || !imageAvail);
  const showOverride = imageAvail && !showLocal;
  const showCatalog = catalogAvail && !showLocal && !showOverride;

  // Bare mode: just the image — no wrap, no overlay, no ghost. Null on miss/error.
  // Notify the caller from image onError handlers only (never during render).
  if (bare) {
    if (showLocal && localSrc) {
      const onLocalError = () => {
        setLocalError(true);
        // No catalog left to fall through to → caller owns the empty state.
        if (!imageUrl || catalogError) onError?.();
      };
      return size ? (
        <HubPicture src={localSrc} alt={name} priority={priority} width={size} height={size} className={className || undefined} onError={onLocalError} />
      ) : (
        <HubPicture
          src={localSrc}
          alt={name}
          priority={priority}
          className={className || undefined}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          onError={onLocalError}
        />
      );
    }
    if (showCatalog || showOverride) {
      const common = {
        ...art,
        ...frame,
        alt: name,
        priority,
        className: className || undefined,
        onError: () => {
          setCatalogError(true);
          onError?.();
        },
      };
      return size ? <Picture {...common} width={size} height={size} /> : <Picture {...common} fill />;
    }
    return null;
  }

  const inlineStyle = size ? { width: size, height: size } : undefined;

  // A local <img> and a catalog <Picture> both drop into the same sized `.wrap`
  // (`.img` is 100%/100% object-fit:cover), so size and fill are handled by the
  // wrap for either source.
  if (showLocal || showCatalog || showOverride) {
    return (
      <div className={`${styles.wrap} ${className}`} style={inlineStyle}>
        {showLocal && localSrc ? (
          <HubPicture src={localSrc} alt={name} priority={priority} className={styles.img} onError={() => setLocalError(true)} />
        ) : (
          <Picture
            {...art}
            {...frame}
            alt={name}
            width={size}
            height={size}
            fill={!size}
            priority={priority}
            className={styles.img}
            onError={() => setCatalogError(true)}
          />
        )}
        <div className={styles.overlay} />
      </div>
    );
  }

  return (
    <div className={`${styles.wrap} ${styles.ghost} ${className}`} style={inlineStyle}>
      <span className={styles.initials}>{initials || "?"}</span>
    </div>
  );
}

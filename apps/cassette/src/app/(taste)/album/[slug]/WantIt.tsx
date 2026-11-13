"use client";

/**
 * Want it: the record on this person's wishlist (/api/shop/wishlist, the old page's AlbumWishlistButton),
 * a square key of the buttons' height beside Buy, the bookmark filled in the record's colour once it is
 * on the list. It flips at once and puts it back if the save fails; signed out, it goes to sign-in and
 * back. A wish to buy, not the Saved "+" (the OWNED / SAVED / SHOP doctrine in db/schema.ts).
 */

import { useState } from "react";
import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import a from "./album.module.css";

export function WantIt({ albumId, slug, signedIn, initial }: { albumId: number; slug: string; signedIn: boolean; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (!signedIn) {
      window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(`/album/${slug}`)}`;
      return;
    }
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    try {
      const res = await fetch("/api/shop/wishlist", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ album_id: albumId }),
      });
      if (!res.ok) setOn(!next);
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      look="outlined"
      className={a.want}
      data-on={on || undefined}
      aria-pressed={on}
      aria-label={on ? "On your wishlist" : "Want it: add to your wishlist"}
      title={on ? "On your wishlist" : "Want it"}
      icon={<Icon name="bookmark" size={18} />}
      onClick={toggle}
    />
  );
}

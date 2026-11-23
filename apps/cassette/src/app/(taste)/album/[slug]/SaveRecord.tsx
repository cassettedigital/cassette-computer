"use client";

/**
 * The record's Save key (the founder, 2026-11-23, board #1162): "+ Save", then "✓ Saved" once kept, and a second
 * press takes it back, as a station's Save does. A saved record you don't own is the wishlist (/api/shop/wishlist,
 * the store's own line, never the library), and it waits in Saved for later at the top of Discover. A record that
 * is the person's own shows no key: it's theirs already (Opener leaves it out).
 *
 * On the shared outlined Button beside Preview and Buy, in every window. It flips at once and puts it back if
 * the save fails; signed out, a press goes to sign-in and back.
 */

import { useState } from "react";
import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { Say } from "@/app/_taste/Say";

export function SaveRecord({ albumId, slug, title, signedIn, initial }: { albumId: number; slug: string; title: string; signedIn: boolean; initial: boolean }) {
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
      give="word"
      icon={<Icon name={on ? "check" : "plus"} size={14} />}
      aria-pressed={on}
      aria-label={on ? `Saved ${title}. Remove it` : `Save ${title}`}
      onClick={toggle}
    >
      <Say whole={on ? "Saved" : "Save"} />
    </Button>
  );
}

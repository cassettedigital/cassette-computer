"use client";

/**
 * The artist's one key, on the ladder (lib/artist-ladder-rules.ts; the founder, 2026-11-23, board #1162), the same on
 * the website, the iPhone app's page and the Mac app's window:
 *
 *   + Save        nothing yet: keep them to come back to (Saved for later, the top of Discover)
 *   ✓ Saved ⌄     saved: its menu follows them, or takes the save away
 *   ✓ Following ⌄ following, by owning a record of theirs or by choice: its menu unfollows (only the news stops)
 *   + Follow      an artist you own and unfollowed
 *
 * One request for where the person stands once mounted (signed in on the website; always in the apps, which carry the
 * person's device sign-in rather than the website's session: `app`); until it answers the key holds its place unseen,
 * never guessing Save for someone who follows them (the founder saw Gordi flip from Save to Following, 2026-11-23).
 * Then every press flips the key at once and
 * puts it back if the save fails; signed out, a press goes to sign-in and back (/api/follows answers 401). The menu is
 * the house menu every page button uses (Buy's). On the shared outlined Button, as Preview beside it.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { Menu, MenuItem } from "@/app/_taste/Menu";
import { Say } from "@/app/_taste/Say";

type Level = "none" | "saved" | "following";
type Standing = { level: Level; owned: boolean };

const asStanding = (d: unknown): Standing | null => {
  const x = d as { level?: unknown; owned?: unknown } | null;
  return x && (x.level === "none" || x.level === "saved" || x.level === "following")
    ? { level: x.level, owned: x.owned === true }
    : null;
};

export function ArtistKey({ slug, name, source, app }: { slug: string; name: string; source: string; app: boolean }) {
  const [st, setSt] = useState<Standing>({ level: "none", owned: false });
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState(false);
  const { status } = useSession();
  const asks = app || status === "authenticated";
  // the key says something once it knows: signed out on the website at once, otherwise when its question is answered
  const known = asks ? heard : status !== "loading";

  // only someone signed in stands anywhere: on the website nobody else's visit asks; the apps are always signed in
  useEffect(() => {
    if (!asks) return;
    let alive = true;
    fetch(`/api/follows?${new URLSearchParams({ type: "artist", id: slug })}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const s = asStanding(d);
        if (alive && s) setSt(s);
      })
      .catch(() => {})
      .finally(() => alive && setHeard(true));
    return () => {
      alive = false;
    };
  }, [slug, asks]);

  const act = async (method: "POST" | "DELETE", body: Record<string, string>, guess: Level) => {
    if (busy) return;
    const was = st;
    setSt({ ...st, level: guess });
    setBusy(true);
    try {
      const res = await fetch("/api/follows", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "artist", id: slug, ...body }),
      });
      if (res.status === 401) {
        window.location.href = `/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
        return;
      }
      setSt((res.ok && asStanding(await res.json().catch(() => null))) || was);
    } catch {
      setSt(was);
    } finally {
      setBusy(false);
    }
  };
  const save = () => act("POST", { level: "saved", source }, "saved");
  const follow = () => act("POST", { level: "following", source }, "following");
  const unfollow = () => act("DELETE", { action: "unfollow" }, "none");
  const remove = () => act("DELETE", { action: "remove" }, "none");

  if (st.level === "saved" || st.level === "following") {
    const word = st.level === "saved" ? "Saved" : "Following";
    return (
      <Menu
        trigger="button"
        give="keep"
        align="start"
        label={`${name}: ${word.toLowerCase()}`}
        buttonLabel={`${word} ${name}`}
        title={
          <>
            <Icon name="check" size={14} />
            {word}
          </>
        }
      >
        {st.level === "saved" ? (
          <>
            <MenuItem onPick={follow}>Follow</MenuItem>
            <MenuItem onPick={remove}>Remove from Saved</MenuItem>
          </>
        ) : (
          <MenuItem onPick={unfollow}>Unfollow</MenuItem>
        )}
      </Menu>
    );
  }

  // an artist you own and unfollowed takes Follow back; anyone else starts at Save
  const word = st.owned ? "Follow" : "Save";
  return (
    <Button
      look="outlined"
      give="word"
      icon={<Icon name="plus" size={14} />}
      aria-label={`${word} ${name}`}
      aria-hidden={known ? undefined : true}
      tabIndex={known ? undefined : -1}
      style={known ? undefined : { visibility: "hidden" }}
      onClick={st.owned ? follow : save}
    >
      <Say whole={word} />
    </Button>
  );
}

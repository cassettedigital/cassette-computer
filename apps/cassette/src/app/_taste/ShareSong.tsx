"use client";

/**
 * Share one song (CASSETTE_SHARING.md). A small key with the share glyph. Pressing it asks the server for
 * the song's link (a saved share when signed in, so the friend sees who it's from; the plain song link
 * otherwise), which checks first that one of its stored videos still plays outside YouTube, so a
 * link never goes out to nothing (the sender's side settles it, never the friend's). Then the phone's own
 * share sheet when there is one, or the link copied, said in a one-line bubble beside the key.
 *
 * A song the page already knows has no video shows its key greyed out, so nobody starts a share that
 * can't go anywhere; pressing it only says why. A video that stopped playing since the page loaded gets
 * the same one line.
 */

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import s from "./share.module.css";

type Answer =
  | { ok: true; url: string; title: string; text: string }
  | { ok: false; reason: "no_video" };

type State =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "copied" }
  | { kind: "miss" }
  | { kind: "failed" };

/** The phone's share sheet when it has one (a touch screen with navigator.share); otherwise the clipboard. */
async function hand(link: { url: string; title: string; text?: string }): Promise<"shared" | "copied" | "cancelled"> {
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: link.title, text: link.text, url: link.url });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // a refused sheet falls through to copying
    }
  }
  await navigator.clipboard.writeText(link.url);
  return "copied";
}

export function ShareSong({
  albumSlug,
  trackId,
  title,
  hasVideo,
  className,
}: {
  albumSlug: string;
  trackId: number;
  /** The song's title, for the key's spoken name. */
  title: string;
  /** False when the page already knows the song has no video: the key is greyed out. */
  hasVideo: boolean;
  className?: string;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const wrap = useRef<HTMLSpanElement>(null);

  // every bubble is one line and fades on its own
  useEffect(() => {
    if (state.kind === "idle" || state.kind === "asking") return;
    const t = setTimeout(() => setState({ kind: "idle" }), 2400);
    return () => clearTimeout(t);
  }, [state.kind]);

  // a click outside, or Escape, closes the bubble
  useEffect(() => {
    if (state.kind === "idle" || state.kind === "asking") return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setState({ kind: "idle" });
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setState({ kind: "idle" });
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [state.kind]);

  // Signed in: a saved share (/s/<code>), so the friend's page says who it's from. Signed out, or the
  // save failing for any reason: the plain song link (/album/<slug>?song=), checked the same way.
  async function saved(): Promise<Answer | null> {
    try {
      const res = await fetch("/api/share/song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: trackId }),
      });
      if (!res.ok) return null;
      const a = (await res.json()) as Answer | { ok: false; reason: string };
      return a.ok || a.reason === "no_video" ? (a as Answer) : null;
    } catch {
      return null;
    }
  }
  async function plain(): Promise<Answer> {
    const res = await fetch(`/api/album/${encodeURIComponent(albumSlug)}/share?track=${trackId}`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Answer;
  }

  async function share() {
    if (state.kind === "asking") return;
    if (!hasVideo) {
      setState({ kind: "miss" });
      return;
    }
    setState({ kind: "asking" });
    try {
      const a = (await saved()) ?? (await plain());
      if (!a.ok) {
        setState({ kind: "miss" });
        return;
      }
      const how = await hand(a);
      setState(how === "copied" ? { kind: "copied" } : { kind: "idle" });
    } catch {
      setState({ kind: "failed" });
    }
  }

  return (
    <span ref={wrap} className={`${s.wrap} ${className ?? ""}`} data-open={state.kind !== "idle" || undefined}>
      <button
        type="button"
        className={s.key}
        aria-label={hasVideo ? `Share ${title}` : `${title}: no video to share yet`}
        aria-disabled={!hasVideo || undefined}
        aria-busy={state.kind === "asking" || undefined}
        data-busy={state.kind === "asking" || undefined}
        data-off={!hasVideo || undefined}
        title={hasVideo ? undefined : "No video to share yet"}
        onClick={share}
      >
        <Icon name="share" size={16} />
      </button>
      {state.kind === "copied" && (
        <span className={s.bubble} role="status">
          Link copied
        </span>
      )}
      {state.kind === "failed" && (
        <span className={s.bubble} role="status">
          Couldn&rsquo;t share that. Try again.
        </span>
      )}
      {state.kind === "miss" && (
        <span className={s.bubble} role="status">
          No video to share yet.
        </span>
      )}
    </span>
  );
}

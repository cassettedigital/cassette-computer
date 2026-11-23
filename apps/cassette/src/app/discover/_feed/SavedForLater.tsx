"use client";

/**
 * Saved for later, Discover's second view (views.tsx switches them from the title; the founder, 2026-11-23): what you
 * saved and don't own yet (lib/saves.ts). It lives here, with discovery, never in the library: a record or song you
 * don't own can only play as a preview, and nothing in a person's library plays YouTube. Signed out there is only the
 * day's page.
 *
 * The saved pane is the house's own parts, one section each, in the order a person comes back for them:
 *
 *   Artists   their face and name as the artist page's rows draw them; one with a record out lately says "New: <it>"
 *   Records   the cover grid, each a door to its page (Preview and Buy are there)
 *   Songs     search's song rows: a press previews the song, its check takes it back out, its arrow opens the record
 *
 * Nothing saved yet, the pane says quietly what it is for and how something gets here (a section head and a line, not a
 * page's headline under Discover's title). The same drawing in the website and
 * the Mac app.
 */

import { useState } from "react";
import Link from "next/link";
import { ArtistRows } from "@/app/_taste/ArtistRows";
import { Icon } from "@/app/_taste/Icon";
import { RecordGrid } from "@/app/_taste/RecordGrid";
import { SectionHead } from "@/app/_taste/SectionHead";
import { SongList, type SongItem } from "@/app/_taste/SongList";
import { albumHref } from "@/app/_taste/links";
import type { Playable } from "@/app/_taste/play";
import type { SavedForLater as Saved, SavedSong } from "@/lib/saves-types";
import songs from "@/app/_taste/songs.module.css";
import o from "./order.module.css";

/** A saved song's preview: the page's own look-up (search's), so a press plays it in the dock. */
async function lookUp(x: SavedSong): Promise<Playable | null> {
  try {
    const res = await fetch(`/api/preview/youtube?trackId=${encodeURIComponent(String(x.trackId))}`);
    const data = (await res.json()) as { videoId?: string | null; fallbackVideoIds?: string[] };
    if (!data?.videoId) return null;
    return {
      trackId: x.trackId,
      title: x.title,
      artist: x.artist,
      artistSlug: "",
      album: x.albumTitle,
      albumSlug: x.albumSlug || null,
      cover: x.cover,
      videoId: data.videoId,
      fallbackVideoIds: data.fallbackVideoIds ?? [],
      seconds: null,
    };
  } catch {
    return null;
  }
}

/** The songs, each with its check (saved: a press takes it back out, and back in) and the way to its record. */
function Songs({ list }: { list: SavedSong[] }) {
  const [out, setOut] = useState<Set<number>>(() => new Set());
  const flip = async (x: SavedSong) => {
    const was = out.has(x.trackId);
    const set = (gone: boolean) =>
      setOut((prev) => {
        const n = new Set(prev);
        if (gone) n.add(x.trackId);
        else n.delete(x.trackId);
        return n;
      });
    set(!was);
    try {
      const res = await fetch("/api/sync/saved-songs", {
        method: was ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: x.trackId }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      set(was);
    }
  };
  const items: SongItem[] = list.map((x) => {
    const on = !out.has(x.trackId);
    return {
      key: x.trackId,
      title: x.title,
      meta: [x.artist, x.albumTitle].filter(Boolean).join(" · "),
      cover: x.cover,
      sleeve: x.albumTitle || x.title,
      seconds: null,
      play: null,
      resolve: () => lookUp(x),
      end: (
        <>
          <button
            type="button"
            className={songs.key}
            aria-pressed={on}
            aria-label={on ? `Saved ${x.title}. Remove it` : `Save ${x.title}`}
            title={on ? "Saved" : "Save"}
            onClick={() => void flip(x)}
          >
            <Icon name={on ? "check" : "plus"} />
          </button>
          <Link className={songs.key} href={albumHref(x.albumSlug)} aria-label={`Go to ${x.albumTitle || "its album"}`} title="Go to the album">
            <Icon name="arrow" />
          </Link>
        </>
      ),
    };
  });
  return <SongList items={items} />;
}

/** What you saved and don't own yet, one house section each. */
export function SavedPane({ saved }: { saved: Saved }) {
  const artists = [...saved.artists.filter((a) => a.latest), ...saved.artists.filter((a) => !a.latest)];
  if (artists.length + saved.records.length + saved.songs.length === 0) {
    // a quiet invite in the tab's own column, never a page's worth of headline under Discover's title
    return (
      <section className={o.savedEmpty} aria-label="Saved for later">
        <SectionHead size="small">Nothing saved yet</SectionHead>
        <p>Save an artist, a record or a song you don&rsquo;t own yet, from its page or from search, and it waits here to come back to.</p>
      </section>
    );
  }
  return (
    <div className={o.saved}>
      {artists.length > 0 && (
        <section aria-label="Saved artists">
          <SectionHead size="small">Artists</SectionHead>
          <ArtistRows
            rows={artists.map((a) => ({ slug: a.slug, name: a.name, photo: a.photo, cover: a.cover, line: a.latest ? `New: ${a.latest.title}` : undefined }))}
            wholeRows={false}
          />
        </section>
      )}
      {saved.records.length > 0 && (
        <section aria-label="Saved records">
          <SectionHead size="small">Records</SectionHead>
          <RecordGrid records={saved.records.map((r) => ({ slug: r.slug, title: r.title, cover: r.cover, meta: r.artist }))} />
        </section>
      )}
      {saved.songs.length > 0 && (
        <section aria-label="Saved songs">
          <SectionHead size="small">Songs</SectionHead>
          <Songs list={saved.songs} />
        </section>
      )}
    </div>
  );
}


"use client";

/**
 * Correcting a record in your library, from the desk: the old library's own editor (AlbumEditPanel,
 * with its cover search, upload and paste, its name, year, label and genre, its song titles and its
 * catalog match), opened from a record's menu, its page and the side view. The editor is the
 * dashboard's, mounted as it is: the desk runs inside the same ShellProvider it needs.
 *
 * An artist (useEditArtist): their name, corrected across every record of theirs (the same cloud
 * correction a record's band name is: no file is touched), and their photo, through the old library's
 * own photo key (a file, a paste, an image's address).
 *
 * Opening reads what the editor pre-fills (the record's corrections so far, and its songs from the
 * Mac's list the window holds). A save drops the desk's kept copies (the routes call
 * deskLibraryChanged, lib/desk/library-changed) and the window reads again, so the change shows now.
 * Only a cover writes into the person's folder (the named exception, CASSETTE_FILE_WRITEBACK.md);
 * everything else is a correction kept in the cloud.
 */

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlbumEditPanel, type EditTrack, type LinkedAlbum } from "@/app/dashboard/_shell/AlbumEditPanel";
import { ArtistPhotoEditButton } from "@/app/dashboard/_shell/ArtistPhotoEditButton";
import { inheritedArtistGroupKey } from "@/lib/dashboard/library-group-keys";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { Dialog, Field, Input, Key, tokens as kit } from "@discovery/cassette-kit";
import t from "@/app/_taste/taste.module.css";
import { Art, albumCovers, artistCovers } from "./Art";
import { useOwned } from "./owned";
import { loadSongs } from "./songs";
import { deskAlbum, deskArtistOf, recordId, type DeskAlbum } from "./types";
import d from "./desk.module.css";

type Open = { a: DeskAlbum; year: number | null; label: string | null; genre: string | null; tracks: EditTrack[] };

const Ctx = createContext<((a: DeskAlbum) => void) | null>(null);
const ArtistCtx = createContext<((name: string, albums: DeskAlbum[]) => void) | null>(null);

/** Open the editor for an artist (their records as the shelf has them). */
export function useEditArtist(): (name: string, albums: DeskAlbum[]) => void {
  const v = useContext(ArtistCtx);
  if (!v) throw new Error("useEditArtist outside EditorsProvider");
  return v;
}

/** Open the editor for a record. */
export function useEditRecord(): (a: DeskAlbum) => void {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditRecord outside EditorsProvider");
  return v;
}

type Override = {
  rawYear: number | null;
  rawLabel: string | null;
  rawGenre: string | null;
  displayTitle: string | null;
  displayArtist: string | null;
  displayYear: number | null;
  displayLabel: string | null;
  displayGenre: string | null;
};

export function EditorsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const { recordTracks } = useOwned();
  const { showToast } = useShell();
  const router = useRouter();
  const pathname = usePathname();

  const edit = useCallback(
    (a: DeskAlbum) => {
      void (async () => {
        const [meta, songs] = await Promise.all([
          fetch(`/api/sync/library/album/${toBase64Url(a.key)}/display-override`, { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<Override>) : null))
            .catch(() => null),
          recordTracks(a.key).catch(() => []),
        ]);
        if (!meta && !navigator.onLine) {
          showToast("Editing an album needs the internet");
          return;
        }
        setOpen({
          a,
          year: meta?.displayYear ?? meta?.rawYear ?? (a.year ? Number(a.year) || null : null),
          label: meta?.displayLabel ?? meta?.rawLabel ?? null,
          genre: meta?.displayGenre ?? meta?.rawGenre ?? null,
          tracks: songs.filter((t) => t.cassetteLocalId).map((t) => ({ cassetteLocalId: t.cassetteLocalId!, title: t.title, discNumber: null })),
        });
      })();
    },
    [recordTracks, showToast],
  );

  // the window reads again: the page (its server data) and the Mac's song list (titles, the side view)
  const reread = useCallback(() => {
    router.refresh();
    void loadSongs({ fresh: true }).catch(() => {});
  }, [router]);

  const onLinked = useCallback(
    (album: LinkedAlbum) => {
      const was = open?.a;
      setOpen(null);
      showToast(`Matched to ${album.title}`);
      // a record matched to the catalog may have a new address: follow it if its page is open
      if (was && pathname === deskAlbum(was) && album.slug && album.slug !== recordId(was)) router.replace(deskAlbum(album.slug));
      reread();
    },
    [open, pathname, router, reread, showToast],
  );

  const [artist, setArtist] = useState<{ name: string; albums: DeskAlbum[] } | null>(null);
  const editArtist = useCallback((name: string, albums: DeskAlbum[]) => setArtist({ name, albums }), []);

  const value = useMemo(() => edit, [edit]);
  return (
    <Ctx.Provider value={value}>
    <ArtistCtx.Provider value={editArtist}>
      {children}
      {artist && <EditArtist name={artist.name} albums={artist.albums} onClose={() => setArtist(null)} onSaved={reread} />}
      {open && (
        <AlbumEditPanel
          groupKey={open.a.key}
          title={open.a.title}
          artist={open.a.artist}
          coverSrc={albumCovers(open.a, 300)[0] ?? null}
          hasCoverOverride={!!open.a.overrideCover}
          localCoverTrackId={open.a.localTrackId}
          year={open.year}
          label={open.label}
          genre={open.genre}
          tracks={open.tracks}
          onClose={() => setOpen(null)}
          onLinked={onLinked}
          onSaved={reread}
          onCoverReplaced={reread}
        />
      )}
    </ArtistCtx.Provider>
    </Ctx.Provider>
  );
}



/**
 * The artist editor: their name (a correction on each of their records, keeping each record's other
 * corrections as they are) and their photo (the old library's key, over the picture). The kit's dialog,
 * so Esc or the backdrop closes it. It's mounted beside the window rather than in it (EditorsProvider
 * wraps the window), so it takes the window's paper itself: without it the dialog had no colours at all.
 */
function EditArtist({ name, albums, onClose, onSaved }: { name: string; albums: DeskAlbum[]; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(0);
  const { showToast } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const trackId = albums.find((a) => a.localTrackId)?.localTrackId ?? null;
  const nameId = useId();
  // the name ready to type: after the dialog has opened (its own effect runs first), as the browser's
  // own first focus would land on the photo's pencil
  useEffect(() => document.getElementById(nameId)?.focus(), [nameId]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === name) return onClose();
    setSaving(true);
    try {
      // each record's corrections as they stand, with the artist's name changed
      for (const a of albums) {
        const url = `/api/sync/library/album/${toBase64Url(a.key)}/display-override`;
        const now = await fetch(url, { credentials: "include" }).then((r) => (r.ok ? (r.json() as Promise<Override>) : null));
        const res = await fetch(url, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayTitle: now?.displayTitle ?? null,
            displayArtist: next,
            displayYear: now?.displayYear ?? null,
            displayLabel: now?.displayLabel ?? null,
            displayGenre: now?.displayGenre ?? null,
          }),
        });
        if (!res.ok) throw new Error(`Couldn't rename ${a.title}`);
      }
      showToast(`Renamed to ${next}`);
      onClose();
      onSaved();
      // their page follows the new name (a matched artist keeps the catalog's address)
      const was = deskArtistOf({ artist: name, artistSlug: albums[0]?.artistSlug ?? null });
      if (pathname === was) router.replace(deskArtistOf({ artist: next, artistSlug: albums[0]?.artistSlug ?? null }));
    } catch (e) {
      showToast((e as Error).message || "Couldn't save that", { variant: "error" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={`${t.follows} ${kit.kit} ${kit.follow} ${d.editorScope}`}>
      <Dialog open onClose={onClose} title="Edit artist" width={520}>
        <div className={d.dialogBody}>
          <div className={d.dialogFace}>
            <Art key={bump} src={artistCovers(albums, 300)} sizes="120px" />
            <span className={d.artistFacePen}>
              <ArtistPhotoEditButton groupKey={inheritedArtistGroupKey(name)} trackId={trackId} onReplaced={() => setBump((n) => n + 1)} />
            </span>
          </div>
          <div className={d.dialogFields}>
            <Field label="Name" htmlFor={nameId}>
              <Input id={nameId} value={value} onChange={(e) => setValue(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
            </Field>
            <p className={d.dialogNote}>
              Renames them on {albums.length === 1 ? "their album" : `all ${albums.length} of their albums`} here, without touching your files. The pencil on the picture changes their photo.
            </p>
          </div>
        </div>
        <div className={d.dialogKeys}>
          <Key tone="plain" onClick={onClose}>
            Cancel
          </Key>
          <Key tone="fill" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Key>
        </div>
      </Dialog>
    </div>
  );
}

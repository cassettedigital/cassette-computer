"use client";

/**
 * Hide and Delete in the Mac app (the founder, 2026-10-29: in an album's or an artist's "…" menu, with a yes
 * or no first; on the computer only). lib/library-actions does the work, the same as the old library's
 * rail; this asks before a Hide too, then lets the window catch up: the side view lets go of what's gone,
 * its page goes back to the list, and the desk's library reloads.
 */

import { useRouter } from "next/navigation";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { askToConfirm } from "@/lib/ask";
import { inheritedArtistGroupKey } from "@/lib/dashboard/library-group-keys";
import { deleteFromLibrary, hideFromLibrary, type LibraryTarget, type Notify } from "@/lib/library-actions";
import { useAside, type Look } from "./DeskShell";
import { DESK, deskAlbum, deskArtistOf, type DeskAlbum } from "./types";

type Album = Pick<DeskAlbum, "key" | "slug" | "title" | "artist" | "artistSlug">;

export function useRemoveFromLibrary() {
  const router = useRouter();
  const aside = useAside();
  const { showToast } = useShell();
  const notify: Notify = (message, variant) => showToast(message, variant ? { variant } : undefined);

  const gone = (look: Look, page: string, back: string) => {
    if (aside.showing(look)) aside.follow();
    if (window.location.pathname === page) router.replace(back);
    router.refresh();
  };

  const albumTarget = (a: Album): LibraryTarget => ({ scope: "album", groupKey: a.key, artistName: a.artist, albumName: a.title });
  const artistTarget = (name: string): LibraryTarget => ({ scope: "artist", groupKey: inheritedArtistGroupKey(name), artistName: name });
  const albumGone = (a: Album) => gone({ kind: "record", key: a.key }, deskAlbum(a), `${DESK}/albums`);
  const artistGone = (name: string, slug: string | null) =>
    gone({ kind: "artist", name, slug }, deskArtistOf({ artist: name, artistSlug: slug }), `${DESK}/artists`);

  return {
    hideAlbum: async (a: Album) => {
      const yes = await askToConfirm(`Hide "${a.title}"?\n\nIt leaves your library and your phones. Its files stay on your computer, and Hidden in your account menu brings it back.`, { ok: "Hide" });
      if (yes && (await hideFromLibrary(albumTarget(a), notify))) albumGone(a);
    },
    deleteAlbum: (a: Album) => void deleteFromLibrary(albumTarget(a), notify, () => albumGone(a)),
    hideArtist: async (name: string, slug: string | null) => {
      const yes = await askToConfirm(`Hide ${name}?\n\nTheir albums leave your library and your phones. The files stay on your computer, and Hidden in your account menu brings them back.`, { ok: "Hide" });
      if (yes && (await hideFromLibrary(artistTarget(name), notify))) artistGone(name, slug);
    },
    deleteArtist: (name: string, slug: string | null) => void deleteFromLibrary(artistTarget(name), notify, () => artistGone(name, slug)),
  };
}

import { SavedSongs } from "../SavedSongs";

/** Saved songs: the songs of yours you saved, pinned first in Playlists (board #1162). */
export const metadata = { title: "Saved songs" };

export default function DeskSavedSongs() {
  return <SavedSongs />;
}

import "server-only";

/**
 * The public copy's stand-in: the hidden albums come from the cloud in the app (/api/player/library/hidden,
 * settings/_bodies/HiddenBody), never from a database here.
 */

import type { HiddenAlbumCard } from "./player-answers";

export async function loadHiddenPlayerData(_userId: string): Promise<HiddenAlbumCard[]> {
  throw new Error("hidden albums: this copy of Cassette reads them from the cloud (CASSETTE_PLAYER_TOKEN)");
}

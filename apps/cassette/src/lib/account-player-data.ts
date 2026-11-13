import "server-only";

/**
 * The public copy's stand-in: the account page's data comes from the cloud in the app (/api/player/account,
 * settings/_bodies/AccountBody), never from a database here.
 */

import type { AccountPlayerData } from "./player-answers";

export type { AccountPlayerData } from "./player-answers";

export async function loadAccountPlayerData(_userId: string): Promise<AccountPlayerData> {
  throw new Error("the account page: this copy of Cassette reads it from the cloud (CASSETTE_PLAYER_TOKEN)");
}

import "server-only";

/**
 * The public copy's stand-in for the desk's database side (the website's app/desk/web.ts). The computer app
 * always asks the cloud for its pages (source.ts viaCloud: it runs with a device token), so nothing here is
 * ever called; a server started without a token stops here with a plain reason instead of a database error.
 */

import type { AlbumLoad } from "@/app/(taste)/album/[slug]/types";
import type { ArtistLoad } from "@/app/(taste)/artist/_lib/types";
import type { DiscoverView } from "@/app/discover/_feed/view";
import type { DeskData, DeskDevices, DeskPlaylistPage, DeskRecordPage } from "./types";

function cloudOnly(what: string): never {
  throw new Error(
    `${what}: this copy of Cassette reads everything from the cloud. Start it inside the Cassette app, or with ` +
      `CASSETTE_PLAYER_TOKEN set to this computer's sign-in key (apps/cassette-player/desktop/scripts/run-token-mode.sh).`,
  );
}

export const loadDesk = async (_userId: string, _name: string | null): Promise<DeskData> => cloudOnly("the desk");
export const loadDevices = async (_userId: string): Promise<DeskDevices | null> => cloudOnly("your devices");
export const loadPlaylist = async (_userId: string, _id: string): Promise<DeskPlaylistPage | null> => cloudOnly("a playlist");
export const loadRecord = async (_userId: string, _key: string): Promise<DeskRecordPage | null> => cloudOnly("a record");
export const ownedBySlug = async (_userId: string, _slug: string): Promise<string | null> => cloudOnly("a record");
export const loadAlbumPage = async (_slug: string, _userId?: string | null): Promise<AlbumLoad | null> => cloudOnly("an album page");
export const loadArtistPage = async (_slug: string, _userId?: string | null): Promise<ArtistLoad | null> => cloudOnly("an artist page");
export const loadDiscover = async (_userId: string): Promise<DiscoverView> => cloudOnly("Discover");
export const webFlags = async (_userId: string): Promise<[{ show: boolean; label: "Studio" }, boolean]> => cloudOnly("your account");
export const webHasPurchases = async (_userId: string): Promise<boolean> => cloudOnly("your account");

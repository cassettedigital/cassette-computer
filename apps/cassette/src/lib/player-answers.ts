/**
 * The shapes of the cloud's answers to the Mac app (the /api/player/* routes): what fields come back, never
 * how they were made. The website makes them from its database (lib/dashboard-rail-data,
 * lib/account-player-data, lib/dashboard/library-hidden, api/account/sign-ins) and the paired app draws them,
 * so the screens that draw them need only this file. Types only.
 */

import type { SidebarDevice } from "@/app/dashboard/_shell/Sidebar";
import type { AvatarPresetId } from "@/lib/avatar";

/** Everything the left rail renders, minus the identity (which the shell already
 *  holds), as one JSON-serializable shape shared by the web loader replica and
 *  the token endpoint. `devices` is pre-computed (status/online/light resolved on
 *  the server) so the client renders it verbatim. */
export type DashboardRailData = {
  playlists: { id: string; name: string; coverImageUrl: string | null }[];
  playlistTotal: number;
  devices: SidebarDevice[];
  hasHidden: boolean;
  wishlistCount: number;
  isCreator: boolean;
  isAdmin: boolean;
};

/** Everything the account page renders about the caller, minus React — one
 *  serializable shape shared by the web page (via replication) and the token
 *  endpoint. */
export type AccountPlayerData = {
  name: string | null;
  email: string;
  image: string | null;
  avatarPreset: AvatarPresetId;
  serverMode: boolean;
  diagnosticsConsent: boolean;
  hasPassword: boolean;
  isBetaTester: boolean;
};

export type HiddenAlbumCard = {
  groupKey: string;
  albumName: string;
  artistName: string;
  trackCount: number;
  coverUrl: string | null;
  dominantColor: string | null;
};

export type SignIn = {
  id: string;
  kind: "computer" | "iphone" | "android";
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
  /** The sign-in asking: this computer, in the desktop app. */
  current: boolean;
};

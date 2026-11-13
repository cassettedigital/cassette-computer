/**
 * Hidden albums: the way back from Hide (BUG-638). The albums someone hid, each with Unhide, wired to POST
 * /api/sync/library/unhide. Deleted albums never show here (getHiddenAlbumCards): Delete moved their files
 * to the computer's Trash and can't be undone.
 *
 * Drawn in the website's Settings window and in the desk's window (`fill`). In the app (token mode, no
 * database) the list comes from the cloud over the device token; on the website the SAME read runs here.
 */

import { redirect } from "next/navigation";
import { Key } from "@discovery/cassette-kit";
import { isTokenMode, fetchPlayer } from "@/lib/player-client";
import { getDashboardSession } from "@/lib/dashboard/session";
import { loadHiddenPlayerData } from "@/lib/hidden-player-data";
import type { HiddenAlbumCard } from "@/lib/player-answers";
import { AlbumCover } from "@/app/components/AlbumCover";
import { DesktopNotice } from "@/app/dashboard/components/DesktopNotice";
import { UnhideButton } from "@/app/dashboard/library/hidden/UnhideButton";
import { RowItem, Rows, Thumb } from "@/app/studio/_kit/parts";
import { SettingsEmpty, SettingsPage } from "../_parts/parts";

export async function HiddenBody({ here, fill }: { here: string; fill?: boolean }) {
  const session = await getDashboardSession();
  if (session.kind === "unauth") redirect(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);

  let loaded: HiddenAlbumCard[] | null;
  if (isTokenMode()) {
    try {
      loaded = await fetchPlayer<HiddenAlbumCard[]>("/api/player/library/hidden");
    } catch {
      return <DesktopNotice pageTitle="Hidden albums" cardTitle="You're offline" body="Reconnect to see your hidden albums." />;
    }
  } else {
    loaded = await loadHiddenPlayerData(session.user.id);
  }
  const cards = loaded ?? [];

  return (
    <SettingsPage
      title="Hidden albums"
      line="Albums you hid wait here with their files untouched. Unhide one to bring it back to your library and your phones."
      fill={fill}
    >
      {cards.length === 0 ? (
        <SettingsEmpty
          head="Nothing hidden"
          line="Hide an album from its menu in your library and it waits here, files untouched, until you bring it back."
        >
          <Key href="/desk">Open your library</Key>
        </SettingsEmpty>
      ) : (
        <Rows label="Hidden albums">
          {cards.map((c) => (
            <RowItem
              key={c.groupKey}
              art={
                <Thumb initials={c.coverUrl ? undefined : c.albumName.slice(0, 1).toUpperCase()}>
                  {c.coverUrl ? <AlbumCover bare imageUrl={c.coverUrl} title={c.albumName} size={64} sizes="64px" /> : undefined}
                </Thumb>
              }
              title={c.albumName}
              meta={`${c.artistName} · ${c.trackCount} ${c.trackCount === 1 ? "track" : "tracks"}`}
              end={<UnhideButton groupKey={c.groupKey} />}
            />
          ))}
        </Rows>
      )}
    </SettingsPage>
  );
}

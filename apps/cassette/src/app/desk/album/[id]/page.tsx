import type { Metadata } from "next";
import { albumName } from "@/lib/search-line";
import { notFound } from "next/navigation";
import { isSlug } from "@/app/(taste)/_kit/links";
import { AlbumBody } from "@/app/(taste)/album/[slug]/AlbumBody";
import { fromBase64Url } from "@/lib/dashboard/library-group-keys";
import { OwnedRecord, RecordFromMac } from "../../Shelves";
import { deskUser } from "../../session";
import { NotKeptOffline, deskAlbumPage, deskRecord, deskWindow } from "../../source";

/**
 * A record inside the app. When it's on your Mac, your copy comes first: its cover from its folder, its
 * songs as they sit on the Mac, played by the Mac, and the press underneath (the founder's default,
 * 2026-10-21). A record that isn't on the Mac, or `?page=1`, is the real album page (the taste one), laid
 * out by the window's room, its songs previewed from YouTube in the booth, with no share key and no Want it,
 * and its Buy opening the browser (the desk's surface, Q5).
 *
 *   /desk/album/<slug>      a catalog record: yours if it's on the Mac, else its page
 *   /desk/album/k-<key>     a record on the Mac the catalog doesn't know (an unmatched rip), by its key
 */

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

async function resolve(id: string, page: string | undefined) {
  const user = await deskUser();
  if (id.startsWith("k-")) {
    let key: string;
    try {
      key = fromBase64Url(id.slice(2));
    } catch {
      return null;
    }
    try {
      const r = await deskRecord(user.id, "key", key);
      return r ? ({ kind: "owned", r } as const) : null;
    } catch (e) {
      // offline and never opened here: the Mac still has it, so draw it from what the window holds
      if (e instanceof NotKeptOffline) return { kind: "fromMac", key } as const;
      throw e;
    }
  }
  if (!isSlug(id)) return null;
  if (page !== "1") {
    try {
      const r = await deskRecord(user.id, "slug", id);
      if (r) return { kind: "owned", r } as const;
    } catch (e) {
      if (!(e instanceof NotKeptOffline)) throw e;
      const mine = (await deskWindow(user.id, user.name)).shelf.find((a) => a.slug === id);
      if (mine) return { kind: "fromMac", key: mine.key } as const;
    }
  }
  const p = await deskAlbumPage(user.id, id);
  return p ? ({ kind: "page", p } as const) : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const x = await resolve(id, page);
  if (!x) return { title: "Not found" };
  if (x.kind === "fromMac") return { title: "In your library" };
  return { title: x.kind === "owned" ? albumName(x.r.album.title, x.r.album.artist) : albumName(x.p.title, x.p.artist) };
}

export default async function DeskAlbum({ params, searchParams }: Props) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const x = await resolve(id, page);
  if (!x) notFound();
  if (x.kind === "fromMac") return <RecordFromMac key={x.key} albumKey={x.key} />;
  return x.kind === "owned" ? <OwnedRecord key={x.r.album.key} r={x.r} /> : <AlbumBody key={x.p.slug} p={x.p} surface="desk" />;
}

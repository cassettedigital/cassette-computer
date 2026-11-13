import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isSlug } from "@/app/(taste)/_kit/links";
import { ArtistBody } from "@/app/(taste)/artist/[slug]/ArtistBody";
import { fromBase64Url } from "@/lib/dashboard/library-group-keys";
import { ArtistView } from "../../Artist";
import { deskUser } from "../../session";
import { deskArtistPage, deskWindow } from "../../source";

/**
 * An artist inside the app. When you have records by them on your Mac, yours come first: their records
 * on the Mac, every song of theirs you have, Play and Shuffle from the Mac, then the way on to their
 * page (the founder's default for records, 2026-10-21, carried to artists). Otherwise, or with
 * `?page=1`, the real artist page (the taste one), as the desk draws it: Preview only, no Follow or Claim.
 *
 *   /desk/artist/<slug>      a catalog artist: yours if you have their records, else their page
 *   /desk/artist/k-<name>    an artist the catalog doesn't know, by their name as the Mac has it
 */

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

async function resolve(id: string, page: string | undefined) {
  const user = await deskUser();
  if (id.startsWith("k-")) {
    let name: string;
    try {
      name = fromBase64Url(id.slice(2));
    } catch {
      return null;
    }
    const { shelf } = await deskWindow(user.id, user.name);
    return shelf.some((a) => a.artist === name) ? ({ kind: "owned", name, slug: null } as const) : null;
  }
  if (!isSlug(id)) return null;
  if (page !== "1") {
    const { shelf } = await deskWindow(user.id, user.name);
    const mine = shelf.find((a) => a.artistSlug === id);
    if (mine) return { kind: "owned", name: mine.artist, slug: id } as const;
  }
  const p = await deskArtistPage(user.id, id);
  return p ? ({ kind: "page", p } as const) : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const x = await resolve(id, page);
  return { title: !x ? "Not found" : x.kind === "owned" ? x.name : x.p.name };
}

export default async function DeskArtist({ params, searchParams }: Props) {
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  const x = await resolve(id, page);
  if (!x) notFound();
  return x.kind === "owned" ? <ArtistView key={x.name} name={x.name} slug={x.slug} size="page" /> : <ArtistBody key={x.p.slug} p={x.p} surface="desk" />;
}

import { Albums } from "../Shelves";

export const metadata = { title: "Albums" };

export default async function DeskAlbums({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  return <Albums q={(Array.isArray(q) ? q[0] : q)?.trim().slice(0, 80) ?? ""} />;
}

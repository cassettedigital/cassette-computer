import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlaylistPage } from "../../Shelves";
import { deskUser } from "../../session";
import { deskPlaylist } from "../../source";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const p = await deskPlaylist((await deskUser()).id, id);
  return { title: p ? p.name : "Not found" };
}

export default async function DeskPlaylist({ params }: Props) {
  const { id } = await params;
  const p = await deskPlaylist((await deskUser()).id, id);
  if (!p) notFound();
  return <PlaylistPage key={p.id} p={p} />;
}

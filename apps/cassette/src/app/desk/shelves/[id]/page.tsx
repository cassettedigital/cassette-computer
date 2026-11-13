import type { Metadata } from "next";
import { ShelfPage } from "../../Reach";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Shelf" };

/** One of today's shelves, opened (lib/home, read in the window through home.ts). */
export default async function DeskShelf({ params }: Props) {
  const { id } = await params;
  return <ShelfPage id={decodeURIComponent(id)} />;
}

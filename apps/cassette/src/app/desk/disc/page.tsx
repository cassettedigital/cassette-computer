import { DiscPage } from "../disc";

export const metadata = { title: "Disc" };

/** The disc in the drive (desk/disc.tsx). `?choose=1` opens the drive panel's own choosing steps. */
export default async function DeskDisc({ searchParams }: { searchParams: Promise<{ choose?: string }> }) {
  const { choose } = await searchParams;
  return <DiscPage choose={choose === "1"} />;
}

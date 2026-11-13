import type { Metadata } from "next";
import { MixRoute } from "../../MadeForYou";

interface Props {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = { title: "Made for you" };

/** A made-for-you playlist: made in the cloud for the day (lib/taste/made-for-you.ts), read in the window (mixes.ts). */
export default async function DeskMix({ params }: Props) {
  const { id } = await params;
  return <MixRoute id={decodeURIComponent(id)} />;
}

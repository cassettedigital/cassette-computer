import type { Metadata } from "next";
import { Lost } from "./_taste/Lost";
import { PageFrame } from "./_taste/PageFrame";

/** Every address with no page behind it, outside the artist and album pages (which keep their own inside their player frame). BUG-544. */
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PageFrame>
      <Lost />
    </PageFrame>
  );
}

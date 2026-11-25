import type { Metadata } from "next";
import { Lost } from "./_taste/Lost";
import { PageFrame } from "./_taste/PageFrame";
import { LeftTheApp } from "./desk/LeftTheApp";

/** Every address with no page behind it, outside the artist and album pages (which keep their own inside their player frame). BUG-544.
 *  Inside the computer app, a website page the app doesn't carry goes to the browser instead (LeftTheApp). */
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <PageFrame>
      <LeftTheApp />
      <Lost />
    </PageFrame>
  );
}

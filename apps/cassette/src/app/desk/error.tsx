"use client";

/**
 * A desk page that couldn't load. Most often: no internet, and this page has never been opened on this
 * Mac, so there's no copy of it here yet (BUG-542). The window, the rail and the deck stay; your records
 * still play from the Mac.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReportWebError } from "@/lib/diagnostics/use-report-web-error";
import { DESK } from "./types";
import d from "./desk.module.css";

export default function DeskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useReportWebError(error, "desk/error.tsx");
  // Only blame the internet when it is actually gone (BUG-868); anything else is our failure, said as one.
  const [offline, setOffline] = useState(false);
  useEffect(() => setOffline(!navigator.onLine), []);
  return (
    <div className={d.lost}>
      <p className={d.lostHead}>{offline ? "This page needs the internet." : "This page didn't load."}</p>
      <p className={d.quiet}>Everything in your library still plays.</p>
      <p className={d.lostKeys}>
        <button type="button" className={d.lostLink} onClick={reset}>
          Try again
        </button>
        <Link href={DESK} className={d.lostLink}>
          Home
        </Link>
      </p>
    </div>
  );
}

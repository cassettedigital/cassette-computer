import Link from "next/link";
import d from "./desk.module.css";

/** A record or artist with no page yet, inside the window. */
export default function DeskNotFound() {
  return (
    <div className={d.lost}>
      <p className={d.lostHead}>No page for this one yet.</p>
      <Link href="/desk/albums" className={d.lostLink}>
        Back to Albums
      </Link>
    </div>
  );
}

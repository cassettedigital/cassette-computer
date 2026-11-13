import type { IngestState } from "@/lib/library-ingest";

/**
 * The one line the desk says while a folder or files are being added (BUG-636), shown as the desk's own
 * note above the player bar. Null when nothing is happening. An error is the note that lingers.
 */
export type DropNote = { msg: string; error?: boolean };

export function dropNote(i: IngestState): DropNote | null {
  switch (i.phase) {
    case "uploading":
      return { msg: `Adding ${i.album}: ${i.uploaded} of ${i.total}` };
    case "identifying":
      return { msg: `Identifying ${i.album}…` };
    case "done":
      return { msg: `Added ${i.album}` };
    case "queued":
      return { msg: `Queued ${i.queued} song${i.queued === 1 ? "" : "s"}. They go in when your computer is back.` };
    case "noMac":
      return { msg: "Add music in the Cassette app." };
    case "error":
      return { msg: "Couldn't add those files.", error: true };
    default:
      return null;
  }
}

import { RecordSkeleton } from "../../RecordSkeleton";

/** A record's page in the window while its two or three trips to the cloud come back (D-P1). */
export default function DeskAlbumLoading() {
  return <RecordSkeleton kind="album" />;
}

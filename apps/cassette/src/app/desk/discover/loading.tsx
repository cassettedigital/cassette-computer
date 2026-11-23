import { FeedSkeleton } from "@/app/discover/_feed/DiscoverBody";
import { PageHead } from "../Shelves";
import d from "../desk.module.css";

/**
 * Discover in the window while its page comes back from the cloud: the title at once, and the page's own shape as
 * bones where it will stand (the website's Discover skeleton). The window keeps playing; only the page waits.
 */
export default function DeskDiscoverLoading() {
  return (
    <div className={d.page}>
      <PageHead title="Discover" />
      <FeedSkeleton />
    </div>
  );
}

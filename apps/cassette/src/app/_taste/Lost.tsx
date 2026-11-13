/**
 * What a missing page says, in whatever frame it lands in (the root 404, the artist and album pages'
 * own inside their player frame, Discover's and the guides'): that nothing is here, a search of the
 * catalog, and the way home. Drawn by the shared EmptyState. Inside the iPhone app the way home steps aside: the
 * app's own back is the way out, and its homepage is the website's pitch (BUG-641).
 */

import { ArrowLink } from "./Button";
import { EmptyState } from "./EmptyState";
import { FirstPaintAgain } from "./FirstPaintAgain";
import { SearchForm } from "./SearchForm";
import l from "./lost.module.css";

export function Lost({ wrap = true }: { wrap?: boolean }) {
  return (
    <>
      {/* a page that threw notFound() is drawn by the browser from an error shell, so the root's first-paint
          scripts never ran: this puts the saved skin and light or dark back on (BUG-713) */}
      <FirstPaintAgain />
      <EmptyState
        wrap={wrap}
        title="Nothing here."
        lede={
          <>
            No page lives at this address. Search for what you were after
            <span className={l.webOnly}>, or start from the homepage</span>.
          </>
        }
      >
        <div className={l.findBox}>
          <SearchForm />
        </div>
        <ArrowLink href="/" className={l.webOnly}>
          Go to the homepage
        </ArrowLink>
      </EmptyState>
    </>
  );
}

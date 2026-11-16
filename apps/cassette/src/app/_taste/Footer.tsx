/**
 * The quiet colophon (P13), one for every page, kept compact (the founder, 2026-10-21: "ENORMOUS"): the
 * small app icon and the name, the links, and one line of small print. Its colours and its paper come
 * from the stock it sits on (the dark press paper on the artist and album pages, the light card stock on
 * the homepage). `wrap` is the page's own frame when it has one (the homepage's is not yet the taste
 * pages' container-sized one). Its links leave the page, so they are plain <a>.
 */

import { AppIcon } from "./Brand";
import t from "./taste.module.css";
import s from "./footer.module.css";

export function Footer({ wrap = t.wrap }: { wrap?: string }) {
  return (
    <footer className={s.foot}>
      <div className={`${wrap} ${s.inner}`}>
        <a href="#top" className={s.brand} aria-label="Cassette, back to the top">
          <AppIcon className={s.icon} />
          Cassette
        </a>
        <nav aria-label="Footer" className={s.nav}>
          <a href="/for-artists">For artists</a>
          <a href="/manifesto">What I believe</a>
          <a href="/journal">Journal</a>
          <a href="/discover">Discover</a>
          <a href="/guides">Guides</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
        </nav>
      </div>
      <div className={`${wrap} ${s.small}`}>
        <span>© {new Date().getFullYear()} Cassette</span>
        <span>No ads. One person.</span>
      </div>
    </footer>
  );
}

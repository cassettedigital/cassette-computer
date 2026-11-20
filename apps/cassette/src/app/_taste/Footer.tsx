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
        <span className={s.end}>
          <span>No ads. One person.</span>
          <span className={s.social}>
            {SOCIAL.map(({ name, href, Glyph }) => (
              <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Cassette on ${name}`} title={name}>
                <Glyph />
              </a>
            ))}
          </span>
        </span>
      </div>
    </footer>
  );
}

/**
 * Where Cassette posts (founder, 2026-11-19). Both marks are drawn solid, in the small print's ink: Bluesky's
 * butterfly only comes solid, so Instagram's camera is the solid tile with the lens and the dot cut through it.
 */
const SOCIAL = [
  { name: "Instagram", href: "https://www.instagram.com/get_cassette/", Glyph: InstagramGlyph },
  { name: "Bluesky", href: "https://bsky.app/profile/cassettedigital.bsky.social", Glyph: BlueskyGlyph },
];

function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2ZM12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10Zm0 1.9a3.1 3.1 0 1 0 0 6.2a3.1 3.1 0 1 0 0-6.2Zm5.5-3.7a1.3 1.3 0 1 0 0 2.6a1.3 1.3 0 1 0 0-2.6Z"
      />
    </svg>
  );
}

function BlueskyGlyph() {
  return (
    <svg viewBox="0 0 600 530" fill="currentColor" aria-hidden="true">
      <path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49c26.262-54.316 97.782-155.54 164.28-205.46C512.26 8.009 590-19.862 590 68.825c0 17.712-10.155 148.79-16.111 170.07-20.703 73.984-96.144 92.854-163.25 81.433 117.3 19.964 147.14 86.092 82.697 152.22-122.39 125.59-175.91-31.511-189.63-71.766-2.514-7.38-3.69-10.832-3.708-7.896-.017-2.936-1.193.516-3.707 7.896-13.714 40.255-67.233 197.36-189.63 71.766-64.444-66.128-34.605-132.26 82.697-152.22-67.108 11.421-142.55-7.449-163.25-81.433C20.15 217.613 9.997 86.535 9.997 68.825c0-88.687 77.742-60.816 125.72-24.795z" />
    </svg>
  );
}

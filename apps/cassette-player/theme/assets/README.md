# Cassette Player — Assets

Visual assets for the Cassette Player UI override.

## Asset Inventory

| Asset | File | Status | Usage |
|---|---|---|---|
| Logo mark | `logo-mark.svg` | TODO | App header, favicon source |
| Wordmark | `wordmark.svg` | TODO | App header alongside logo mark |
| Favicon (32px) | `favicon-32.png` | TODO | Browser tab |
| Favicon (16px) | `favicon-16.png` | TODO | Browser tab |
| App icon (192px) | `icon-192.png` | TODO | PWA manifest |
| App icon (512px) | `icon-512.png` | TODO | PWA manifest |
| OG image | `og-image.png` | TODO | Social sharing (1200×630) |

## Logo Spec

The Cassette Player logo mark follows the Cassette brand:

- A cream (`#EDE4D0`) rectangle with an orange (`#E87830`) horizontal stripe — like the window of a cassette tape
- "PLAYER" wordmark in Barlow Condensed, weight 900, uppercase, cream
- Works on dark backgrounds only (designed for `--cs-bg2` and darker)
- SVG format for crispness at all sizes

## Injection

Navidrome's app name and logo are set in its React source. To inject a custom logo:

**Option A (CSS):** Hide the default text logo and replace with a background-image SVG. Speculative but fast to try.

**Option B (Source fork):** Modify `navidrome/ui/src/App.js` or wherever the header renders. More reliable, requires maintaining a source diff.

We try Option A first. See `theme/cassette-theme.css` for the relevant selectors.

## Reference

The mobile mockup (`cassette-player-mobile-mockup.html`) shows the intended logo treatment:
- Header: logo mark (cream rect with orange stripe, ~24×14px) + "PLAYER" text in Barlow Condensed 900
- Small enough to not compete with album art
- Positioned left, with utility icons right

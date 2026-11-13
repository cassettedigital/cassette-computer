# Cassette Player — Fonts

All three fonts are loaded from Google Fonts in `cassette-theme.css` for the initial dev setup. For production, we should host them locally (faster, no external dependency, works offline).

## Font Inventory

### Barlow Condensed
- **Role:** Display / headlines / section labels / track names / transport controls
- **Weights used:** 300, 400, 500, 600, 700, 800, 900 (+ italic 400, 700)
- **License:** SIL Open Font License 1.1 — [OFL text](https://scripts.sil.org/OFL)
- **Author:** Jeremy Tribby
- **Google Fonts:** https://fonts.google.com/specimen/Barlow+Condensed
- **Download:** https://fonts.google.com/download?family=Barlow+Condensed

### DM Mono
- **Role:** Metadata / timestamps / durations / track numbers / catalog info / bitrates
- **Weights used:** 300, 400, 500 (+ italic 300, 400)
- **License:** SIL Open Font License 1.1
- **Author:** Colophon Foundry
- **Google Fonts:** https://fonts.google.com/specimen/DM+Mono
- **Download:** https://fonts.google.com/download?family=DM+Mono

### Newsreader
- **Role:** Editorial serif for album descriptions, longer text, liner notes
- **Weights used:** 300, 400, 500 (+ italic)
- **License:** SIL Open Font License 1.1
- **Author:** Production Type
- **Google Fonts:** https://fonts.google.com/specimen/Newsreader
- **Download:** https://fonts.google.com/download?family=Newsreader

## GPL v3 Compatibility

All three fonts are OFL 1.1. The OFL is compatible with the GPL: OFL fonts can be embedded in GPL software and distributed under GPL terms. No conflicts.

## Self-Hosting (Production)

To self-host fonts instead of loading from Google Fonts:

1. Download font files from Google Fonts (links above)
2. Place `.woff2` files in this directory: `theme/fonts/<FontName>/`
3. Update `cassette-theme.css` to replace the `@import` with `@font-face` declarations pointing to `/static/fonts/<FontName>/`
4. Update the `Dockerfile` to `COPY theme/fonts/ /app/ui/static/fonts/`

Example `@font-face` declaration:
```css
@font-face {
  font-family: 'Barlow Condensed';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url('/static/fonts/BarlowCondensed/BarlowCondensed-Bold.woff2') format('woff2');
}
```

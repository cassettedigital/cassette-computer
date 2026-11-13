# Cassette Player — Theming

## Strategy

Navidrome's React frontend is built with [Material UI (MUI)](https://mui.com/). Our goal is to make it look and feel like a seamless extension of the Cassette app — same warm dark palette, same Barlow Condensed headlines, same DM Mono metadata, same tape-orange accents.

### Approach: CSS-First

We're **not** forking the React source initially. The bet is that CSS custom property overrides plus well-targeted selectors can handle ~90% of the visual transformation. This keeps upstream merges painless.

**Escalation path:**
1. **CSS overrides** (current): `cassette-theme.css` injected into the running Navidrome instance
2. **CSS + MUI theme JSON**: If Navidrome exposes a theme config file, we use it for color/typography tokens
3. **React source fork**: If CSS proves insufficient (e.g., structural DOM changes needed, custom components required), we fork `navidrome/ui/` and maintain a diff — but only as a last resort

### How CSS Injection Works

Navidrome (as of v0.61.0) serves a web UI from its embedded Go binary. There are two known injection points:

1. **Custom CSS file**: Navidrome may support a `custom.css` file in its static assets directory. The Docker Compose setup mounts `cassette-theme.css` to the expected path. **This needs verification** — inspect the running container to confirm.

2. **Browser extension / proxy injection** (dev only): For rapid iteration, use a browser extension like Stylus to inject CSS without restarting Docker.

To find the actual static asset paths in the running container:
```bash
docker exec cassette-player find / -name "*.css" 2>/dev/null | grep -v proc
```

### MUI Class Names

MUI generates deterministic class names in production builds (e.g., `MuiAppBar-root`, `MuiListItem-root`). These are stable across Navidrome releases unless they upgrade MUI major versions. We also target data attributes and ARIA roles as more stable selectors.

**After you run Navidrome locally:**
1. Open `http://localhost:4533` in Chrome
2. DevTools → Elements → inspect each major component
3. Note the real class names and update `cassette-theme.css` accordingly
4. Document the selector map below

---

## Selector Map

> TODO: Fill this in after running Navidrome and inspecting the DOM.

| Component | MUI/Navidrome class | Cassette override |
|---|---|---|
| App shell / root | `#root`, `body` | Background, font |
| Top app bar | `MuiAppBar-root` | Dark bg, border-bottom |
| Left sidebar / drawer | `MuiDrawer-root`, `MuiDrawer-paper` | `--cs-bg2` |
| Sidebar nav item | `MuiListItem-root` | Hover: orange |
| Sidebar active item | `MuiListItemButton-root.Mui-selected` | Orange accent |
| Album grid card | `.ndAlbumCard` or similar | Warm bg, shadow |
| Now playing bar | `#nd-now-playing-*` or similar | `--cs-bg3`, orange progress |
| Progress bar track | `MuiLinearProgress-root` | Inset shadow |
| Progress bar fill | `MuiLinearProgress-bar` | Orange + glow |
| Play/pause button | `MuiIconButton-root` (large) | Orange circle, inset shadow |
| Track title | `.ndSongTitle` or similar | Barlow Condensed |
| Artist / album text | `.ndArtistName` or similar | `--cs-ink2` |
| Duration / metadata | `.ndDuration` or similar | DM Mono, small |
| Favorite / star | `MuiIconButton-root[aria-label*="favorite"]` | Orange when active |
| Volume slider | `MuiSlider-root` | Orange |
| Search input | `MuiInputBase-root` | `--cs-bg3` border |

---

## Design Tokens Reference

```css
/* Palette */
--cs-bg:     #1C1914;  /* app shell background */
--cs-bg2:    #221F19;  /* sidebar, cards */
--cs-bg3:    #2A261E;  /* elevated surfaces, inputs */
--cs-bg4:    #342E24;  /* hover states, borders */
--cs-ink:    #EDE4D0;  /* primary text */
--cs-ink2:   #A89878;  /* secondary text, artist names */
--cs-ink3:   #6E6050;  /* tertiary text, placeholders */
--cs-ink4:   #3E3628;  /* disabled, subtle dividers */
--cs-orange: #E87830;  /* PRIMARY ACCENT — tape orange */
--cs-red:    #D42E2E;
--cs-yellow: #E8C820;
--cs-green:  #38A038;
--cs-blue:   #2878D0;
--cs-cream:  #EDE4D0;
--cs-amber:  #D4A020;

/* Typography */
--cs-font-display: 'Barlow Condensed', sans-serif;  /* headlines, track names */
--cs-font-serif:   'Newsreader', Georgia, serif;     /* editorial, descriptions */
--cs-font-mono:    'DM Mono', monospace;             /* metadata, timestamps, catalog */

/* Geometry */
--cs-radius-sm: 3px;
--cs-radius-md: 4px;
--cs-radius-lg: 5px;
```

---

## Font Licensing

See [`fonts/README.md`](fonts/README.md) for font licensing notes.

- **Barlow Condensed** — SIL Open Font License, by Jeremy Tribby. [Google Fonts](https://fonts.google.com/specimen/Barlow+Condensed)
- **DM Mono** — SIL Open Font License, by Colophon Foundry. [Google Fonts](https://fonts.google.com/specimen/DM+Mono)
- **Newsreader** — SIL Open Font License, by Production Type. [Google Fonts](https://fonts.google.com/specimen/Newsreader)

All three are OFL — no restrictions on use in open source GPL projects.

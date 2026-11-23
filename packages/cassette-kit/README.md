# @discovery/cassette-kit

One set of player parts for the iPhone app, the Android app, the desktop app and the web player. The
iPhone app is the reference: every value here was lifted from its Swift, and every part is named after
the component it mirrors, so a change is made once and read the same everywhere.

First user: the desktop app mock at `/proto/desk-taste` in apps/cassette (dev-only).

## What's shared, and how

| Layer | Source | iPhone | Android | Web / desktop |
|---|---|---|---|---|
| Tokens: colour roles, radii, shapes (a corner as a share of the side: a station's mark at 18%, the app icon's tile at 22%), spacing, type roles, icon sizes, component metrics | `tokens.json` | `generated/CassetteKitTokens.swift`, copied into the fork as `AmperfyKit/Cassette/CassetteKitTokens.swift` (the app reads `Shape` from it; its other tables are still hand-kept) | `generated/CassetteKitTokens.kt`, copied into the Android fork, plus the fork's `res/values/cassette_kit.xml` (light colours, every radius, space, part size, type size and tracking) and `res/values-night/cassette_kit.xml` (dark colours), which the app's colours, type roles, pills, discs, tiles and corners read directly | `src/tokens.module.css` (`.kit` scope, `--pk-*`) |
| The web's taste roles: stocks, corners, type roles | `tokens.json` → `taste` | `CassetteKitTokens.Taste` | `CassetteKitTokens.Taste` | `src/taste.module.css` (`.base`, `.dark`, `.light`, `.cs`) |
| Glyphs | `tokens.json` → `icon.concepts` | the `cassette-lucide-*` assets (+ SF Symbols for the transport) | Lucide | Lucide (`src/Glyph.tsx`) + the kit's own transport shapes |
| Components | the names and anatomy below | Swift (existing) | Android views in the fork (`Cassette.Pill.*`, `view_play_disc`, `CassetteTileAdapter`, `CoverGlowView`, `CassetteType`, 2026-11-09) | React (`src/`) |

Run `pnpm --filter @discovery/cassette-kit generate` after editing `tokens.json`. Never edit the
generated files by hand.

**Images** (the ladder of sizes every picture is shown at, and the rule for picking one) are in
`tokens.json` → `images` too, generated into all three platforms: see [IMAGES.md](IMAGES.md).

## Using it on the web

The package ships its TypeScript and CSS source (no `dist`), so a Next app lists it in
`transpilePackages` (apps/cassette does). Import from `@discovery/cassette-kit`; put the generated
token scope on a wrapper (`import { tokens } from "@discovery/cassette-kit"` then
`className={tokens.kit}`), and wrap the tree in `KitProvider` with the app's link. `react` and
`lucide-react` are peer dependencies. The package's `build` is a typecheck, so CI's package build
checks it without emitting anything.

**The web's taste roles** (the cassette.digital pages: the homepage, artist, album and apps pages, and
every page in the taste page frame) live in the same `tokens.json`, under `taste`: the dark and light
stocks (paper, own, raised, the ink and its four steps, wash, track), the three corners and the type
roles (a `link` role keeps arrow links in typewriter caps), with an 11px floor the generator enforces. `generate` writes them as `src/taste.module.css`
(`@discovery/cassette-kit/taste.module.css`), which apps/cassette's `_taste/taste.module.css` composes,
plus a `Taste` section in the Swift and Kotlin files. The same file also writes `.cs`: the old web kit's
`--cs-` role names on the taste roles, so a page still drawn in the old kit sits on the taste paper in
the taste inks (apps/cassette `PageFrame` with `oldKit`).

One founder call is a word in `taste`, then `generate`:
- `skins`: `"accent"` (today: an account skin moves only the orange on these pages) or `"paper"` (the
  stocks also turn with the site's neutral dial, the way the desk's chassis does).

**Corners are settled: round everywhere** (the founder, 2026-10-29;
`docs/CASSETTE_ROUND_EVERYWHERE_SPEC_2026-10-29.md`). Anything you press, anything you type into and every
tag is round (`--r-pill`, `--pk-r-pill`: a capsule, or a circle when it holds only an icon); a box that holds
a paragraph takes `--r-area` (24px); rows, strips and code take `--r-small`; cards `--r-card`; covers
`--r-cover`. A website button is this kit's pill: the taste `button` role is read from `type.pill`, and its
height and outline from `component.pill` (`--control-h`, `--control-line`, `--control-line-alpha`). The old
`corners` switch is gone and `generate` refuses it; `apps/cassette/scripts/check-kit-corners.mjs` (on
commit) fails a taste stylesheet that writes a corner as a number.

**What can't be shared, by licence:** SF Symbols and Apple's New York face only ship on Apple
platforms. The web and Android draw Lucide (which the iPhone app already pairs with every concept) and
the kit's own transport shapes, and set the answer voice in Newsreader italic.

**The web's orange** is written as `var(--cs-orange, #E87830)`: the Cassette site's skinned accent, so
it follows the account's skin (and passes the web app's accent guard), with the hex for any host
without one. The native files carry the hex.

## Parts and their iPhone sources

| Kit part | iPhone component | File in the Amperfy fork |
|---|---|---|
| `PlayDisc` | CassettePlayDisc (34pt disc on every cover) | `AmperfyKit/CassetteFont.swift` |
| `PlayPill`, `ShufflePill`, `Pills` | makePlayPill / makeShufflePill / setPlayPill | `Screens/View/LibraryElementDetailTableHeaderView.swift` |
| `SavePill` | the station page's save pill (`applySaveState`) | `Screens/ViewController/RadioStationVC.swift` |
| `PlayerTransport` | the 78pt disc between previous and next | `Screens/Player/PlayerControlView.swift` |
| `PlayerFoot` | AirPlay + queue foot row | `Screens/Player/PlayerControlView.swift` |
| `PlayerArt`, `PlayerTitle`, `StationLine` | Now Playing cover, title stack, radio station row | `Screens/Player/LargeCurrentlyPlayingPlayerView.swift` |
| `Scrubber` | the seek slider and its two times | `PlayerControlView.swift`, `SeekableTimeSlider.swift` |
| `Ambient` | AmbientCoverBackdrop | `AmbientCoverBackdrop.swift` |
| `Heading` | CassetteHeading (shout + answer) | `Screens/ViewController/HomeVC.swift` |
| `Shelf`, `Tile` | AlbumCarousel, AlbumCollectionCell, MoodDoorRow, RadioShelfCell | `Collection/AlbumCollectionCell.swift`, `SwiftUI/Mixtape/MoodDoorRow.swift`, `RadiosVC.swift` |
| `TrackRow`, `Waveform` | PlayableTableCell, WaveformAnimatedView | `Screens/View/PlayableTableCell.swift` |
| `StationRow` | RadioStationCell | `Screens/ViewController/RadiosVC.swift` |
| `WordArt` | phoneWordArt (a station with no picture) | `CarPlayStyle.swift` |
| `Hero` | GenericDetailTableHeader + CoverGlowRecipe.page | `GenericDetailTableHeader.swift`, `AmbientCoverBackdrop.swift` |
| `HubRow`, `StripRow` | Settings' HubRow and StripRow | `SwiftUI/Settings/SettingsView.swift` |

**Computer-only parts, no iPhone twin.** `src/Desktop.tsx` holds what a pointer and a keyboard want
(SongTable, the right-click menu, ShelfSection's paddles, QuickCard, Volume, Segmented). `src/Pages.tsx`
holds what a desktop page of figures, lists and forms wants: the rail's places, a dense DataTable, Stats,
Facts, Tag, the small Key (34 tall, the Segmented switch's height, so a row of keys and fields lines up),
Field / Input / Select, Toggle, Check, Dialog, Panel, Code, Note and Notice. Admin and the desk both draw
with them (2026-10-30): the desk's rail is Places (folded with the rail) with a live line under Radio, its
Devices figures are small Stats, its keys are Keys and Edit artist is the Dialog. Neither keeps a copy.

The desktop adds only what a pointer needs (a faint wash on rows under the pointer). It changes no
size, colour or word.

## Rules the parts keep

- The record's colour reaches a part as `--pk-tint-text` (text-safe) and `--pk-tint-glow` on any
  ancestor; with none, the neutral tint (never orange). The app computes it; the kit never reads covers.
- Pictures arrive as nodes and links go through `KitProvider`, so the kit imports nothing from any app.
- No lines between rows. The orange means something is live (progress, a station on air, the answer
  voice in headings, as on the phone).

## Bringing the phones onto it (owed)

- **iPhone:** drop `generated/CassetteKitTokens.swift` into AmperfyKit and point `CassetteTokens.swift`'s
  tables at it (the role names match), so the hand-kept tables stop drifting. Wave 2 of the iOS design
  audit already made the roles; this makes the JSON their source.
- **Android:** wired 2026-11-09. Run `generate` and commit the fork's `cassette_kit.xml` pair and `CassetteKitTokens.kt` in that repo with the change.

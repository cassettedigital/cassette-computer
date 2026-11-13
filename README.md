# Cassette for your computer

Cassette is a music player for music you own. This is the app that runs on your own computer: it keeps your music, rips your CDs, plays them, and fills your phones. The phone apps are [cassette-iphone](https://github.com/cassettedigital/cassette-iphone) and [cassette-android](https://github.com/cassettedigital/cassette-android).

## What's here

- **`apps/cassette-player`, the engine.** The hub (Go) that watches your music folder, rips CDs and fills your phones; the window (Rust, Tauri) that starts everything and keeps this computer's sign-in key; the audio helper (Swift) that plays the music. Its [README](apps/cassette-player/README.md) says what each part does and what it talks to.
- **`apps/cassette`, the player screens.** The desk: your library, the album and artist pages, search, playlists, radio, settings. A Next.js app the window serves on this computer. It shows what the cloud works out (Home, Made for you, the album and artist pages' writing) and plays your music from the hub.
- **`packages`**, the parts the screens share: the player kit, the phone contract, and two small utilities.
- **The music server** is [cassette-navidrome](https://github.com/cassettedigital/cassette-navidrome), Cassette's fork of Navidrome. The build clones it.

This copy is exported from Cassette's own repository at each release, one commit per release, tagged with the app's version. `EXPORTED.txt` lists every file and where it came from. The screens here are the same files Cassette's website runs, without the website's own side: anything that reads Cassette's database stays on the website, and the screens ask the cloud instead, as the app always has.

## Building

On a Mac with Apple silicon:

```bash
apps/cassette-player/desktop/scripts/build-from-source.sh
```

[BUILDING.md](apps/cassette-player/BUILDING.md) says what to install first and how your build differs from Cassette's.

## Licence

GPL-3.0: see [LICENSE](LICENSE). The Cassette name and icons are not part of that licence: see [TRADEMARKS.md](TRADEMARKS.md). To report a security problem, see [SECURITY.md](SECURITY.md).

Cassette's website runs the same screens, so a change you'd like Cassette to take in needs your agreement for it to be used there too. Open an issue first.

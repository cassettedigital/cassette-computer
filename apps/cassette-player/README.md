# Cassette for your computer

Cassette is a music player for music you own. This is the program that runs on your own computer: it keeps your music, rips your CDs, plays them, and fills your phones. The phone apps are [cassette-iphone](https://github.com/cassettedigital/cassette-iphone) and [cassette-android](https://github.com/cassettedigital/cassette-android).

## What's in it

- **`sidecar/`, the hub (Go).** Watches your music folder and fingerprints new songs. Rips CDs: recognises the disc from MusicBrainz, gnudb, AcoustID and the disc's own text, reads it, writes FLAC and finds the cover. Fills your phones over a cable or your home Wi-Fi (encrypted), and a second computer of yours over your home Wi-Fi. Keeps your Cassette account's list of what you own up to date.
- **`desktop/`, the window (Rust, Tauri).** Starts and stops every other part, keeps this computer's sign-in key in the system keychain, and checks for updates.
- **`native/app/main.swift`, the audio helper (macOS).** Plays the music, shows it in Now Playing and notices a disc going in.
- **The music server** is [cassette-navidrome](https://github.com/cassettedigital/cassette-navidrome), Cassette's fork of [Navidrome](https://github.com/navidrome/navidrome), built from source with the app.
- **The screens** (the desk) are a Next.js app built from Cassette's web code; in the public copy they are `apps/cassette`, beside this folder.

## What it talks to

- **On your computer:** the music server (port 4534), the hub (5173) and the screens (41730).
- **On your home network:** your phones and your other computers, encrypted, on port 4533.
- **Online:** www.cassette.digital, for your account, the list of what you own, and what Cassette works out for you (Home, Made for you, album and artist pages). MusicBrainz, Cover Art Archive, AcoustID, gnudb and Apple's iTunes search, to identify CDs and find covers.

Your music files only travel between your own computers and phones, over a cable or your home network.

## Building

`desktop/scripts/build-from-source.sh` builds the whole app on a Mac with none of Cassette's keys: [BUILDING.md](BUILDING.md) says what to install first. Cassette's own releases are `desktop/scripts/bundle-macos.sh` (macOS) and `desktop/scripts/bundle-windows.sh` (Windows).

## Licence

GPL-3.0: see [LICENSE](LICENSE). The app's own Licenses folder lists every third-party component inside it, with its licence, and where to get the source of each GPL and LGPL part.

The Cassette name and icons are not part of that licence: see [TRADEMARKS.md](TRADEMARKS.md). To report a security problem, see [SECURITY.md](SECURITY.md).

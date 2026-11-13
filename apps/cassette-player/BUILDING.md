# Building Cassette for your computer

One script builds the whole app from source on a Mac, with none of Cassette's own keys: the player screens, the hub, the music server, the window and the audio helper. It runs the same release script Cassette uses, without the signing, notarizing and publishing, and leaves the app in `desktop/src-tauri/target/release/bundle/macos/Cassette.app`. It never installs over `/Applications`.

```bash
apps/cassette-player/desktop/scripts/build-from-source.sh
```

## What it needs

A Mac with Apple silicon, and:

- Xcode's command line tools (`xcode-select --install`), for the audio helper, git and the C compiler
- [Homebrew](https://brew.sh), then `brew install cmake pkgconf go`
- Rust, from [rustup](https://rustup.rs)
- Node.js 20 or newer, and pnpm 9 (`corepack enable`)

The first build takes a while: it compiles the rip and transcode tools (ffmpeg, flac, fpcalc, cd-paranoia, cd-info) from their published source, checks each download against its published checksum, and keeps them in `~/Library/Caches/cassette-tools` for the next build. It also downloads Node's official build, checked the same way, for the app to carry.

## Your own settings

Cassette recognises CDs from MusicBrainz and from the disc itself with no setup. Two more services help when those don't know a disc, and both want your own registration: [AcoustID](https://acoustid.org/new-application) (an application key) and [gnudb](https://gnudb.org). Put them in `apps/cassette-player/.env`; `.env.example` lists the names. The build copies them into the app.

## What it talks to

The app you build signs in to your Cassette account at www.cassette.digital, like the one Cassette ships: open it, and it sends you to the browser to pair. To point it at another server, build with `CASSETTE_CLOUD_BASE` set.

## What's different from Cassette's own build

- **Signing.** Yours is signed ad-hoc, so macOS asks you to confirm the first time you open it (right-click, Open). Cassette's releases are signed with Cassette's Developer ID and notarized by Apple. To sign with your own Developer ID, set `CASSETTE_SIGN_ID` to its name.
- **Updates.** The app checks www.cassette.digital for updates signed with Cassette's update key, so a build of your own would be replaced by Cassette's next release. Turn that off in your copy before you change anything you want to keep.
- **The name and icons** are Cassette's (TRADEMARKS.md). Give a changed version its own.

## Working on the player screens

The screens (`apps/cassette`) are a Next.js app that reads everything from the cloud with this computer's own sign-in key, and its music from the hub. Pair the app first, then run the screens' server with that key: `apps/cassette-player/desktop/scripts/run-token-mode.sh` reads it from the Keychain. Started without a key, the screens say so instead of showing a page.

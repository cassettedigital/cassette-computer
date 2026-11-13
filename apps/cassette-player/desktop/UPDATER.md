# Desktop auto-update

The installed `Cassette.app` checks a signed release feed on launch and, when a
newer notarized build exists, downloads + installs it (verifying a minisign
signature) and offers a relaunch. No more manual "Rebuild" to get UI changes onto
the app — you cut a release, every installed copy updates itself on next launch.

## How it works

```
Cassette.app (running)
  └─ on launch, shell checks:  GET https://cassette.digital/api/desktop/update/darwin/aarch64/<its version>
        │
        ├─ 204  → already current, do nothing
        └─ 200 {version, url, signature}
                 └─ download url (presigned R2) → verify signature vs embedded pubkey
                        └─ install new .app → prompt "Relaunch now / Later"
```

- Shell logic: `src-tauri/src/lib.rs` → `spawn_update_check` (shipped build only; dev
  and the `CASSETTE_UI_URL` dev pointer opt out).
- Config: `src-tauri/tauri.conf.json` → `plugins.updater` (endpoint + pubkey).
- Feed: `apps/cassette/src/app/api/desktop/update/[target]/[arch]/[current]/route.ts`
  reads a manifest from R2 and returns a presigned archive URL.
- Publish: `scripts/bundle-macos.sh --publish` → `apps/cassette/scripts/publish-desktop-release.mts`.

The **minisign signature is the trust anchor** — the app installs an update only if
it verifies against the public key baked into the app. A compromised feed or R2
bucket cannot push code without the private key.

## One-time setup (before the first release)

1. **Generate the signing keypair** (do this yourself; keep the private key secret):
   ```bash
   cd apps/cassette-player/desktop
   pnpm tauri signer generate -w ~/.cassette/updater.key
   ```
   It prints the **public key** and writes the private key to `~/.cassette/updater.key`
   (and `~/.cassette/updater.key.pub`). Choose a password when prompted.

2. **Put the public key in `tauri.conf.json`** — replace `REPLACE_WITH_MINISIGN_PUBLIC_KEY`
   under `plugins.updater.pubkey` with the printed public key. Commit that (public keys are safe to commit).

3. **Store the private key + password** where your release shell can read them — never commit them:
   ```bash
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.cassette/updater.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="…"
   # (or use TAURI_SIGNING_PRIVATE_KEY_PATH=~/.cassette/updater.key)
   ```

4. **Create the R2 bucket** for desktop builds (default name `cassette-desktop`; override with
   `R2_DESKTOP_BUCKET`). The feed route reads `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
   `R2_SECRET_ACCESS_KEY` (already in `apps/cassette/.env.local`); add `R2_DESKTOP_BUCKET`
   there **and in the Vercel project env** if you don't use the default name.

## Cutting a release

1. **Bump the version** in `src-tauri/tauri.conf.json` (`"version"`). The feed compares this
   against each client's running version — updates only ship when it's higher. Keep it plain
   semver (`0.2.0`), no pre-release suffix.

2. **Build + notarize + publish** (with the signing env from step 3 above set):
   ```bash
   cd apps/cassette-player/desktop
   RELEASE_NOTES="What changed" ./scripts/bundle-macos.sh --rebuild --notarize --publish
   ```
   This rebuilds the UI from your working tree, Developer-ID signs + notarizes the app,
   installs it locally, then tars + minisign-signs the bundle and uploads the archive +
   feed manifest to R2.

3. Done. Installed apps pick it up on their next launch. (Your own machine is already
   on the new build from the local install.)

## Notes & limits

- **Pulling a bad release.** From `apps/cassette`:
  `pnpm dlx tsx scripts/pull-desktop-release.mts --version <bad> --target darwin --arch aarch64`.
  It puts the release before it back on the feed and the download page and lists the bad
  version as pulled; apps on that version are then offered the good build even though its
  number is lower. Only the live release can be pulled, and only apps built after BUG-790
  will step back down; older ones wait for the next higher release.
- **When the window never loads**, the app checks for an update itself after a minute on
  the startup screen and offers it in a Mac alert, and Check for Updates works from the
  menu before any page is up.
- **Run from outside Applications** (straight off the disk image, or from Downloads) the
  app can't replace itself, so it says so on launch and offers to quit.
- **Node is bundled** in the app (Resources), so updates reach machines without Homebrew.
- The updater replaces the whole `.app` (shell + UI). UI-only fast-path OTA (skip notarize)
  is a possible future optimization; this ships the secure whole-app mechanism first.
- Update activity is logged to `~/Library/Logs/Cassette Player/cassette-shell.log` (`[updater]` lines).

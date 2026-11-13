# Cassette Player — Subsonic API Client

TypeScript client for the [Subsonic](https://subsonic.org/pages/api.jsp) / [OpenSubsonic](https://opensubsonic.netlify.app/) API.

Used by `apps/cassette` (the main Next.js app) to interact with Cassette Player.

## Why

The Subsonic API is how the main Cassette app talks to Cassette Player:
- **Auto-provisioning**: When a customer makes their first purchase, we create their Cassette Player account automatically so they never need to set up the player themselves
- **"In Your Library" indicators**: Album and track pages on Cassette can show whether a title is already in the user's Cassette Player library
- **Playlist sync**: "Add to Player" actions on the discovery surface push playlists to Cassette Player
- **Play buttons**: The "play" button on Cassette discovery pages streams via Cassette Player
- **Library rescans**: After delivering a purchase to R2, we trigger a rescan so the track appears instantly

## Authentication

Uses [MD5 token auth](https://subsonic.org/pages/api.jsp#authentication):
```
token = md5(password + salt)
```
Salt is regenerated per client instance. Token auth is preferred over plain-text password.

## Usage

```typescript
import { createSubsonicClient } from '@discovery/cassette-player/subsonic-client';

const client = createSubsonicClient({
  baseUrl: process.env.CASSETTE_PLAYER_URL,   // e.g. http://localhost:4533
  username: process.env.CASSETTE_PLAYER_ADMIN_USER,
  password: process.env.CASSETTE_PLAYER_ADMIN_PASS,
});

// Health check
await client.system.ping();

// Auto-provision a user after first purchase
const { user, created } = await client.user.getOrCreate({
  username: 'customer@example.com',
  password: generateRandomPassword(),
  email: 'customer@example.com',
  streamRole: true,
  playlistRole: true,
});

// Get their recently added albums
const albums = await client.media.getAlbumList2({ type: 'newest', size: 10 });

// Check if a specific album is in their library
const found = await client.search.findAlbumInLibrary('Blonde');

// Get cover art URL (for use in <img> tags)
const coverUrl = client.media.getCoverArtUrl('al-123', 300); // 300px

// Get stream URL (for use in <audio> src)
const streamUrl = client.media.getStreamUrl('tr-456', { maxBitRate: 320 });

// Trigger a rescan after purchase delivery
await client.system.startScan();
```

## API Coverage

| Method | Implemented | Notes |
|---|---|---|
| `system.ping()` | ✅ | |
| `system.getLicense()` | ✅ | |
| `system.getScanStatus()` | ✅ | Navidrome extension |
| `system.startScan()` | ✅ | Navidrome extension |
| `user.getUser()` | ✅ | |
| `user.getUsers()` | ✅ | |
| `user.createUser()` | ✅ | |
| `user.updateUser()` | ✅ | |
| `user.deleteUser()` | ✅ | |
| `user.changePassword()` | ✅ | |
| `user.getOrCreate()` | ✅ | Convenience method |
| `media.getAlbumList2()` | ✅ | |
| `media.getAlbum()` | ✅ | |
| `media.getSong()` | ✅ | |
| `media.getArtist()` | ✅ | |
| `media.getArtistInfo()` | ✅ | |
| `media.getCoverArtUrl()` | ✅ | Returns URL, not data |
| `media.getStreamUrl()` | ✅ | Returns URL, not data |
| `media.scrobble()` | ✅ | |
| `media.star()` | ✅ | |
| `media.unstar()` | ✅ | |
| `playlists.getPlaylists()` | ✅ | |
| `playlists.getPlaylist()` | ✅ | |
| `playlists.createPlaylist()` | ✅ | |
| `playlists.updatePlaylist()` | ✅ | |
| `playlists.deletePlaylist()` | ✅ | |
| `playlists.getOrCreatePurchasesPlaylist()` | ✅ | Convenience method |
| `search.search3()` | ✅ | |
| `search.searchArtists()` | ✅ | Convenience wrapper |
| `search.searchAlbums()` | ✅ | Convenience wrapper |
| `search.searchSongs()` | ✅ | Convenience wrapper |
| `search.findAlbumInLibrary()` | ✅ | Convenience wrapper |

## Future Work

- Move to `packages/subsonic-client/` once the API is stable and used by `apps/cassette`
- Add request caching (Next.js `fetch` with `{ next: { revalidate: 60 } }`)
- Add per-user client creation (admin client vs user client)
- Add TypeScript path aliases once promoted to a package

# @discovery/cassette-contract

The single authoritative, typed definition of the Cassette client ↔
`cassette.digital` **sync contract** (over-the-wire, snake_case), the
cross-language **`cassette_local_id` hash fixture** and normalization spec,
and the shared **Popular songs** ranking rule (artist pages on web / iOS /
Android).

Before this package, the contract existed only implicitly inside Swift
`Decodable` structs and Next.js route handlers, and the hash was hand-duplicated
across TS / Go / Swift with no shared fixture. This package writes both down
once so the web app cannot drift from the contract and the hash implementations
can be proven (dis)agreeing.

## Exports

```ts
import {
  // Sync wire DTOs (snake_case) — see src/sync.ts
  AccountResponse,
  RegisterDeviceRequest,
  DeviceInventoryRequest,
  IntentTracksResponse,
  UpsertFavoriteRequest,
  RecordPlaysRequest,
  PlaylistOpsRequest,
  // ...

  // Hash fixture + divergence record — see src/local-id.ts
  localIdVectors,
  localIdDivergences,
  LOCAL_ID_PIPELINE,

  // Popular ranking — see src/popular-songs.ts
  POPULAR_SONGS_COLLAPSED_LIMIT,
  POPULAR_SONGS_TEASER_LIMIT,
  comparePopularSongs,
  rankPopularSongs,
} from "@discovery/cassette-contract";
```

## Popular songs

`src/popular-songs.ts` is the one definition of what "Popular" means on an
artist page: **play count descending, then title A→Z**, collapsed to 5 with a
teaser ceiling of 20. The web rail imports this. Phones call
`POST /api/sync/popular-rank` so the *count source* is the same cloud play
store; offline they keep this comparator over a local tally.

## Wire format is snake_case

Every field crosses the network in **snake_case** (the Swift client hand-maps
snake_case `CodingKeys`). These types are the wire shape — **not** the Drizzle
camelCase row types, which are server-internal.

**Two fields are camelCase on the wire** (documented quirks, not bugs):
`AccountResponse.serverMode` and `RecordPlaysResponse.rejectedDetails`.

## The hash does NOT fully agree across languages

See [`docs/CASSETTE_LOCAL_ID_NORMALIZATION.md`](./docs/CASSETTE_LOCAL_ID_NORMALIZATION.md).
An empirical cross-run found **2 divergence classes** (combining-mark stripping;
whitespace set) affecting non-Latin scripts and the `U+0085`/`U+FEFF`
separators. This package therefore ships:

- `src/fixtures/local-id-vectors.json` — the **22 vectors all three implementations reproduce identically** (canonical agreement set; superset of the existing locked 13).
- `src/fixtures/local-id-divergences.json` — the **6 disagreeing vectors** with each implementation's verbatim output. There is no agreed `expected_local_id`; resolving them is a founder decision.

This package intentionally ships **no hash implementation** — doing so would
force a choice between the divergent camps.

## Build

```sh
pnpm --filter @discovery/cassette-contract build
```

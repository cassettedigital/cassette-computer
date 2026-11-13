/**
 * Cassette client <-> cassette.digital sync contract — OVER-THE-WIRE types.
 *
 * WIRE FORMAT IS snake_case. The Swift client hand-maps snake_case CodingKeys
 * and the Next.js routes emit/read snake_case; that snake_case JSON is what
 * actually crosses the network. These types are the wire shape — they are NOT
 * the Drizzle camelCase row types (those are server-internal).
 *
 * Sources of truth this was extracted from (2026-06-25):
 *   - Swift client:  apps/cassette-player-ios/.../AmperfyKit/Cassette/CassetteSyncAPI.swift
 *   - Server routes: apps/cassette/src/app/api/sync/**\/route.ts
 *   - Server shapes: apps/cassette/src/lib/sync-shapes.ts  (response formatters)
 *
 * TWO CAMELCASE QUIRKS ON THE WIRE (documented, not bugs to "fix"):
 *   - AccountResponse.serverMode is camelCase (both Swift CodingKeys and the
 *     route literal agree on `serverMode`). A strict snake_case codegen that
 *     emitted `server_mode` would silently decode to the default `false`.
 *   - RecordPlaysResponse.rejectedDetails is camelCase (route literal). Not
 *     consumed by iOS today.
 *
 * AUTH (every /api/sync/* endpoint): `Authorization: Bearer <token>` OR a web
 * session cookie. The Swift client also attaches device headers on EVERY
 * request (see SYNC_HEADERS); the server reads them only as a keep-alive
 * side-channel (bumps user_devices.last_seen_at) — no route requires them.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

/** 32 lowercase hex chars. See @discovery/cassette-contract local-id fixture. */
export type CassetteLocalId = string;
/** MusicBrainz recording id (UUID) or null. */
export type Mbid = string | null;
/** ISO 8601 timestamp string. */
export type IsoTimestamp = string;
/** Allowed `source_device` values (server: ALLOWED_SOURCE_DEVICES). */
export type SourceDevice = "ios" | "android" | "web" | "mac" | "other";

export type IntentState =
  | "pending"
  | "syncing"
  | "waiting"
  | "complete"
  | "failed"
  | "cancelled";
export type IntentScope = "album" | "artist" | "playlist" | "library";
export type IntentKind = "add" | "remove";
export type MarkScope = "album" | "artist" | "playlist";

/** Header names. Bearer rides Authorization; the two device headers are a keep-alive. */
export const SYNC_HEADERS = {
  authorization: "Authorization",
  deviceId: "X-Cassette-Device-Id",
  deviceLabel: "X-Cassette-Device-Label",
} as const;

// ─── account ───────────────────────────────────────────────────────────────
// GET /api/sync/account

/** Account-level download quality tier (Devices page owns the write, phone reads). */
export type DownloadQualityTier = "lossless" | "high" | "efficient";

export type AccountResponse = {
  email: string;
  name: string | null;
  /**
   * Profile photo URL when set; null falls back to avatarPreset. camelCase.
   * Older clients that don't read this field keep their silhouette glyph.
   */
  image: string | null;
  /**
   * Default disc when image is null: "silhouette" | "initials" | color id.
   * camelCase. Default "silhouette" (the phones' existing person glyph).
   */
  avatarPreset: string;
  /** NOTE: camelCase on the wire (NOT server_mode). */
  serverMode: boolean;
  /**
   * Cassette Mixtape beta: the account's self-serve beta opt-in
   * (users.is_beta_tester). camelCase on the wire. Native clients hide every
   * Mixtape entry point (the Mood shelf, "Start Mixtape") when false, because
   * the /api/mixtape/* routes answer 404 for an account outside the beta.
   * Optional on the Swift side (decodes to false) so older deploys hide Mixtape.
   */
  isBetaTester: boolean;
  /**
   * Account-level download quality the phone applies to the music it downloads.
   * The web (Devices page) owns the write; the phone reads it here and maps it
   * onto its transcode format. camelCase on the wire. Default "high".
   */
  downloadQuality: DownloadQualityTier;
  /**
   * The paired Cassette Player's sidecar HTTP port (default 5173), distinct from
   * the Navidrome LAN port the phone streams from. The phone reaches the sidecar
   * at `http://<lanHost>:<sidecarPort>` for on-demand scan-first convergence
   * (pull-to-refresh → POST /api/library/converge). Null when the user has no
   * paired player, or an older sidecar that doesn't advertise it. camelCase.
   */
  sidecarPort: number | null;
  /**
   * The paired computer's certificate fingerprint for the phones (BUG-870): base64 SHA-256 of the public key its
   * hub made once. A phone that has it speaks TLS to the computer's Wi-Fi port and accepts only that key; null
   * until the computer sends one, and the phone stays on plain http. camelCase.
   */
  lanTlsPin: string | null;
  /**
   * Account-level Appearance — the chosen UI skin + app-icon ids (from the
   * THEMES/ICONS catalog; default "classic"). Native clients apply the skin and
   * (via setAlternateIconName) the icon so a user's look follows them across
   * devices. camelCase on the wire.
   */
  themeId: string;
  iconId: string;
  /**
   * Account-level diagnostics opt-out (the same cross-device rails as themeId).
   * When false, signed-in clients SKIP the AUTOMATIC crash/hang/error POST to
   * /api/diagnostics/reports — the stop is client-side; the server never blocks.
   * Manual user_feedback is user-initiated and ALWAYS allowed regardless. Opt-out
   * model → default true. camelCase on the wire.
   */
  diagnosticsConsent: boolean;
};

// ─── devices ─────────────────────────────────────────────────────────────────
// POST /api/sync/devices            (called by iOS)
// GET  /api/sync/devices            (web-only — not called by iOS)

export type RegisterDeviceRequest = {
  device_id: string;
  device_label?: string;
  platform?: string;
  model?: string;
  app_version?: string;
};

export type RegisterDeviceResponse = {
  ok: true;
  device_id: string;
};

export type DeviceJson = {
  device_id: string;
  device_label: string | null;
  platform: string | null;
  model: string | null;
  app_version: string | null;
  track_count: number;
  created_at: IsoTimestamp;
  last_seen_at: IsoTimestamp;
  currently_reachable: boolean;
};

export type ListDevicesResponse = { devices: DeviceJson[] };

// ─── device inventory ──────────────────────────────────────────────────────
// POST /api/sync/device-inventory   (called by iOS — two modes)
// GET  /api/sync/device-inventory   (web-only)

export type InventoryItem = {
  cassette_local_id: CassetteLocalId;
  downloaded_at: IsoTimestamp;
  mbid: Mbid;
};

/** Differential mode: incremental adds/removes. */
export type DeviceInventoryDiffRequest = {
  device_id: string;
  device_label?: string;
  added?: InventoryItem[];
  /** Swift sends objects; the server also tolerates bare id strings. */
  removed?: { cassette_local_id: CassetteLocalId }[];
};

/** Full-state mode: the complete current inventory (cap 5000). */
export type DeviceInventoryFullStateRequest = {
  device_id: string;
  device_label?: string;
  full_state: true;
  items: InventoryItem[];
};

export type DeviceInventoryRequest =
  | DeviceInventoryDiffRequest
  | DeviceInventoryFullStateRequest;

/**
 * The pre-discrimination shape the SERVER probes off one object before it
 * decides the mode. Clients should send a `DeviceInventoryRequest` (one mode);
 * the server tolerates a superset — notably `removed` entries may be bare id
 * strings as well as `{ cassette_local_id }` objects.
 */
export type DeviceInventoryRequestBody = {
  device_id: string;
  device_label?: string;
  full_state?: boolean;
  items?: InventoryItem[];
  added?: InventoryItem[];
  removed?: ({ cassette_local_id: CassetteLocalId } | string)[];
};

/**
 * Per-track album grouping, computed catalog-blind from the synced library
 * (Phase 1, Gap 1). `group_key` is the web's `buildAlbumGroupKey` (normalized
 * disk-string key) for the track's album bucket — the SAME key the web groups
 * by — so the phone's albums match the web character-for-character. `display_*`
 * carry the web's canonical card labels (catalog title/artist when the bucket
 * resolves to a catalog album, else the inherited names). `album_art_ref` is the
 * catalog cover URL when matched, else null (the phone falls back to the
 * sidecar's local cover proxy addressed by `subsonic_track_id`).
 *
 * Additive: present only on responses that opt in; consumers that ignore it are
 * unaffected. NEVER used to add or remove a track — display grouping only.
 */
export type TrackGroupingJson = {
  cassette_local_id: CassetteLocalId | null;
  subsonic_track_id: string;
  group_key: string;
  /**
   * The track's catalog-blind ARTIST identity — the SAME key the web groups
   * artists by (`inherited-artist:<normalized>`, or `catalog-artist:<id>` for a
   * catalog-matched Various-Artists bucket), so the phone's Artists match the web
   * one-to-one. NUL-free (no separator, unlike group_key) so it needs no pg-safe
   * swap. Additive; identity / display grouping only — never adds or removes a track.
   */
  artist_group_key: string;
  display_album: string;
  display_artist: string;
  album_art_ref: string | null;
  /**
   * The track's own title + duration, so a download-only device can build a
   * catalog record (SongMO) for an owned track that was never library-synced —
   * making "owned" always equal "visible". title is always present; duration is
   * null when the sidecar could not read it.
   */
  track_title: string;
  duration: number | null;
  /** The track's 1-based position on its disc (rip identity), so a device that
   *  materializes a SongMO can sort it in album order. Null when not ripped/linked. */
  disc_track_index: number | null;
  /**
   * Album release year for the phone header, same source as the web rail:
   * personal displayYear override, else the catalog release date's leading
   * YYYY. Null when unmatched and unoverridden. Additive; never invents a year
   * from track tags.
   */
  year: number | null;
};

export type DeviceInventoryDiffResponse = {
  ok: true;
  mode: "differential";
  added: number;
  removed: number;
  /** Additive (Phase 1): catalog-blind per-track album grouping for this user. */
  grouping?: TrackGroupingJson[];
  /** Additive (Phase 1): bump invalidates the device's cached grouping → regroup. */
  grouping_model_version?: number;
};

export type DeviceInventoryFullStateResponse = {
  ok: true;
  mode: "full_state";
  count: number;
  /** Additive (Phase 1): catalog-blind per-track album grouping for this user. */
  grouping?: TrackGroupingJson[];
  /** Additive (Phase 1): bump invalidates the device's cached grouping → regroup. */
  grouping_model_version?: number;
};

export type DeviceInventoryResponse =
  | DeviceInventoryDiffResponse
  | DeviceInventoryFullStateResponse;

export type DeviceInventoryJson = {
  device_id: string;
  device_label: string | null;
  cassette_local_id: CassetteLocalId;
  mbid: Mbid;
  downloaded_at: IsoTimestamp;
  last_seen_at: IsoTimestamp;
};

export type ListDeviceInventoryResponse = { inventory: DeviceInventoryJson[] };

// ─── image ladder references ─────────────────────────────────────────────────
// A picture on the image ladder (docs/reference/CASSETTE_IMAGES.md; packages/cassette-kit `ImageRef`):
// `src` carries `{rung}`, which the phone replaces with one of 120, 240, 480, 800, 1200. `w` and `h` are
// the natural size when stored. Always ADDED beside the old url fields, which keep their exact values.

export type ImageRefJson = {
  src: string;
  w?: number;
  h?: number;
  kind: string;
};

// ─── device artwork manifest ─────────────────────────────────────────────────
// GET /api/sync/devices/{device_id}/artwork   (called by iOS)

export type DeviceArtworkAlbum = {
  artist_name: string;
  album_name: string;
  artist_image_url: string | null;
  artist_thumb_url: string | null;
  /** True when artist_image_url is the user's PICKED artist photo, not the catalog
   *  primary (BUG-099). Additive; the phone may ignore it (a url change already
   *  drives re-materialize via content_version). */
  artist_photo_is_override?: boolean;
  /** The artist photo on the image ladder; prefer it, keep the 1200 rung, fall back to
   *  artist_image_url if it fails. Additive (2026-11-04). */
  artist_image?: ImageRefJson | null;
  cover_url: string | null;
  cover_thumb_url: string | null;
  /** True when cover_url is the user's chosen cover override. */
  cover_is_override?: boolean;
  /** Fingerprint of the LAN folder cover bytes on the user's Mac (0082). */
  local_cover_version?: string | null;
  content_version: string;
};

export type DeviceArtworkResponse = { albums: DeviceArtworkAlbum[] };

// ─── intents ─────────────────────────────────────────────────────────────────
// GET /api/sync/intents                 (called by iOS — decodes a subset)
// GET /api/sync/intents/{id}/tracks      (called by iOS)
// PUT /api/sync/intents/{id}             (called by iOS)
// POST /api/sync/intents, DELETE /{id}   (web/server-only)

export type IntentJson = {
  id: string;
  scope: string;
  target_id: string;
  target_device_id: string | null;
  state: string;
  intent_kind: string;
  created_by_source: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  completed_at: IsoTimestamp | null;
  error_message: string | null;
};

export type ListIntentsResponse = { intents: IntentJson[] };

export type IntentTrack = {
  subsonic_track_id: string;
  cassette_local_id: CassetteLocalId;
  mbid: Mbid;
  title: string | null;
  duration: number | null;
  file_extension: string;
};

export type IntentAlbumCover = {
  url: string;
  thumb_url: string | null;
};

export type IntentArtistImage = {
  image_url: string;
  thumb_url: string | null;
  /** The same photo on the image ladder; additive (2026-11-04). */
  image?: ImageRefJson | null;
};

export type IntentTracksResponse = {
  tracks: IntentTrack[];
  cover: IntentAlbumCover | null;
  artist: IntentArtistImage | null;
};

/** PUT body — patch semantics; Swift sends only state (+ error_message on failure). */
export type UpdateIntentRequest = {
  state?: IntentState;
  error_message?: string;
  scope?: IntentScope;
  target_id?: string;
  target_device_id?: string;
};

export type UpdateIntentResponse = { intent: IntentJson };

// ─── favorites ─────────────────────────────────────────────────────────────
// GET/POST/DELETE /api/sync/favorites   (web-only today; first Android target)

export type FavoriteJson = {
  cassette_local_id: CassetteLocalId;
  mbid: Mbid;
  event_at: IsoTimestamp;
  source_device: string | null;
};

export type ListFavoritesResponse = { favorites: FavoriteJson[] };

export type UpsertFavoriteRequest = {
  cassette_local_id: CassetteLocalId;
  mbid?: Mbid;
  event_at: IsoTimestamp;
  source_device?: SourceDevice | null;
  /** Write-only snapshot fields — accepted on POST, never echoed in FavoriteJson. */
  track_title?: string | null;
  artist_name?: string | null;
  album_name?: string | null;
};

export type UpsertFavoriteResponse = { ok: true; favorite: FavoriteJson };

export type RemoveFavoriteRequest = {
  cassette_local_id: CassetteLocalId;
  event_at: IsoTimestamp;
};

export type RemoveFavoriteResponse = {
  ok: true;
  removed: boolean;
  reason?: "not_found" | "stale_event_at";
};

// ─── plays ───────────────────────────────────────────────────────────────────
// GET/POST /api/sync/plays   (append-only; web-only in the reviewed Swift)

export type PlayJson = {
  cassette_local_id: CassetteLocalId;
  mbid: Mbid;
  played_at: IsoTimestamp;
  duration_played_seconds: number | null;
  completion_ratio: number | null;
  source_device: string | null;
};

export type ListPlaysResponse = { plays: PlayJson[] };

export type PlayInput = {
  cassette_local_id: CassetteLocalId;
  mbid?: Mbid;
  played_at: IsoTimestamp;
  duration_played_seconds?: number | null;
  completion_ratio?: number | null;
  source_device?: SourceDevice | null;
};

export type RecordPlaysRequest = { plays: PlayInput[] };

export type RecordPlaysResponse = {
  ok: true;
  accepted: number;
  rejected: number;
  /** NOTE: camelCase on the wire. */
  rejectedDetails?: { index: number; reason: string }[];
};

// ─── popular-rank ────────────────────────────────────────────────────────────
// POST /api/sync/popular-rank
// Phones (and any client holding local titles) send owned-song identities;
// the server counts user_play_history and returns the shared Popular order.
// See popular-songs.ts for comparator + caps.

export type PopularRankItemInput = {
  cassette_local_id: CassetteLocalId;
  title: string;
};

export type PopularRankItemJson = {
  cassette_local_id: CassetteLocalId;
  title: string;
  play_count: number;
};

export type PopularRankRequest = {
  items: PopularRankItemInput[];
};

export type PopularRankResponse = {
  items: PopularRankItemJson[];
};

// ─── playlists ─────────────────────────────────────────────────────────────
// GET/POST /api/sync/playlists ; GET/PUT/DELETE /{id} ; POST /{id}/ops
// (web, Mac menu-bar card, iOS, Android — one cloud store)

export type PlaylistItemJson = {
  id: string;
  cassette_local_id: CassetteLocalId;
  mbid: Mbid;
  position: number;
  added_at: IsoTimestamp;
  added_by_device: string | null;
  removed_at: IsoTimestamp | null;
};

export type PlaylistJson = {
  id: string;
  name: string;
  description: string | null;
  cover_image_url: string | null;
  is_public: boolean;
  public_slug: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
  deleted_at: IsoTimestamp | null;
  /** Present only when items are requested; soft-deleted items filtered out. */
  items?: PlaylistItemJson[];
};

export type ListPlaylistsResponse = { playlists: PlaylistJson[] };
/** Single-playlist envelope returned by GET/POST/PUT /api/sync/playlists[/:id]. */
export type PlaylistResponse = { playlist: PlaylistJson };
/** @deprecated alias of PlaylistResponse — kept for clarity at the GET site. */
export type GetPlaylistResponse = PlaylistResponse;

export type CreatePlaylistRequest = {
  /** Client-supplied UUID (the playlist PK). */
  id: string;
  name: string;
  description?: string | null;
  cover_image_url?: string | null;
  is_public?: boolean;
};

export type UpdatePlaylistRequest = {
  name?: string;
  description?: string | null;
  cover_image_url?: string | null;
  is_public?: boolean;
};

export type DeletePlaylistResponse = {
  ok: true;
  removed: boolean;
  reason?: "already_deleted";
};

export type PlaylistAddOp = {
  op: "add";
  item_id: string;
  cassette_local_id: CassetteLocalId;
  mbid?: Mbid;
  position: number;
  added_at?: IsoTimestamp;
  added_by_device?: string | null;
};

export type PlaylistRemoveOp = { op: "remove"; item_id: string };
export type PlaylistReorderOp = { op: "reorder"; item_id: string; position: number };
export type PlaylistOp = PlaylistAddOp | PlaylistRemoveOp | PlaylistReorderOp;

export type PlaylistOpsRequest = { ops: PlaylistOp[] };
export type PlaylistOpsResponse = {
  ok: true;
  applied: number;
  playlist: PlaylistJson;
};

// ─── marks (selective sync) ──────────────────────────────────────────────────
// GET/POST /api/sync/marks ; DELETE /{id}   (web-only)

export type MarkJson = {
  id: string;
  device_id: string;
  scope: string;
  target_id: string;
  marked_at: IsoTimestamp;
};

export type ListMarksResponse = { marks: MarkJson[] };

export type CreateMarkRequest = {
  device_id: string;
  scope: MarkScope;
  target_id: string;
};

export type CreateMarkResponse = { mark: MarkJson };
export type DeleteMarkResponse = { ok: true; id: string };

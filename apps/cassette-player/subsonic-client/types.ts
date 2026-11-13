/**
 * Subsonic / OpenSubsonic API — Type Definitions
 *
 * Based on:
 *   - Subsonic API v1.16.1  https://subsonic.org/pages/api.jsp
 *   - OpenSubsonic extensions https://opensubsonic.netlify.app/
 *
 * These are the response types we need for Cassette's integration:
 *   - Account auto-provisioning (createUser, getUser)
 *   - Library queries (getAlbumList2, getAlbum, getSong)
 *   - Playback (stream, getCoverArt)
 *   - Playlists (getPlaylists, createPlaylist, updatePlaylist)
 *   - Search (search3)
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

// ─── Authentication ────────────────────────────────────────────────────────────

/**
 * Credentials passed to every Subsonic API request.
 * Subsonic supports two auth modes:
 *   1. Token + salt (preferred): token = md5(password + salt)
 *   2. Plain password (legacy, avoid in production)
 */
export interface SubsonicCredentials {
  baseUrl: string;
  username: string;
  /** If provided alongside salt, used for token auth. If omitted, password is used directly. */
  password?: string;
  /** Pre-computed MD5 token: md5(password + salt). Provide with salt for token auth. */
  token?: string;
  salt?: string;
  clientName?: string;
  apiVersion?: string;
}

// ─── Base Response ─────────────────────────────────────────────────────────────

export interface SubsonicResponseBase {
  status: 'ok' | 'failed';
  version: string;
  /** Server type (e.g. "navidrome") — OpenSubsonic extension */
  type?: string;
  /** Server software version (e.g. "0.61.0") — OpenSubsonic extension */
  serverVersion?: string;
  /** Whether this server supports OpenSubsonic extensions */
  openSubsonic?: boolean;
}

export interface SubsonicError {
  code: number;
  message: string;
}

export type SubsonicResponse<T extends object = Record<string, never>> = {
  'subsonic-response': SubsonicResponseBase & T & {
    error?: SubsonicError;
  };
};

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const SubsonicErrorCode = {
  Generic: 0,
  RequiredParameterMissing: 10,
  ClientVersionTooOld: 20,
  ServerVersionTooOld: 30,
  WrongCredentials: 40,
  TokenAuthNotSupported: 41,
  NotAuthorized: 50,
  TrialExpired: 60,
  DataNotFound: 70,
} as const;

export type SubsonicErrorCodeValue = typeof SubsonicErrorCode[keyof typeof SubsonicErrorCode];

// ─── Artist ────────────────────────────────────────────────────────────────────

export interface Artist {
  id: string;
  name: string;
  albumCount: number;
  coverArt?: string;
  artistImageUrl?: string;
  starred?: string; // ISO 8601 date
  userRating?: number;
  averageRating?: number;
}

export interface ArtistWithAlbums extends Artist {
  album: Album[];
}

export interface ArtistInfo {
  biography?: string;
  musicBrainzId?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  similarArtist?: Artist[];
}

// ─── Album ─────────────────────────────────────────────────────────────────────

export interface Album {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  coverArt?: string;
  songCount: number;
  duration: number;
  playCount?: number;
  created: string; // ISO 8601
  starred?: string; // ISO 8601
  year?: number;
  genre?: string;
  userRating?: number;
  averageRating?: number;
  isCompilation?: boolean;
  // OpenSubsonic
  discTitles?: { disc: number; title: string }[];
  displayArtist?: string;
  releaseTypes?: string[];
  moods?: string[];
  sortName?: string;
  originalReleaseDate?: PartialDate;
  releaseDate?: PartialDate;
  explicitStatus?: 'explicit' | 'clean';
  version?: string;
}

export interface AlbumWithSongs extends Album {
  song: Song[];
}

export interface PartialDate {
  year?: number;
  month?: number;
  day?: number;
}

// ─── Song / Track ──────────────────────────────────────────────────────────────

export interface Song {
  id: string;
  parent?: string;
  isDir: false;
  title: string;
  album?: string;
  albumId?: string;
  artist?: string;
  artistId?: string;
  track?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size: number;
  contentType: string;
  suffix: string;
  transcodedContentType?: string;
  transcodedSuffix?: string;
  duration: number;
  bitRate: number;
  path: string;
  isVideo?: boolean;
  userRating?: number;
  averageRating?: number;
  playCount?: number;
  discNumber?: number;
  created?: string;
  starred?: string;
  albumArtId?: string;
  sortName?: string;
  musicBrainzId?: string;
  // OpenSubsonic
  bpm?: number;
  comment?: string;
  channelCount?: number;
  samplingRate?: number;
  bitDepth?: number;
  mediaType?: 'song' | 'podcast' | 'audiobook' | 'video';
  replayGain?: {
    trackGain?: number;
    albumGain?: number;
    trackPeak?: number;
    albumPeak?: number;
    baseGain?: number;
    fallbackGain?: number;
  };
  displayArtist?: string;
  displayAlbumArtist?: string;
  displayComposer?: string;
  contributors?: Contributor[];
  moods?: string[];
  explicitStatus?: 'explicit' | 'clean';
}

export interface Contributor {
  role: string;
  subRole?: string;
  artist: Artist;
}

// ─── Playlist ──────────────────────────────────────────────────────────────────

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner: string;
  public: boolean;
  songCount: number;
  duration: number;
  created: string;
  changed: string;
  coverArt?: string;
}

export interface PlaylistWithSongs extends Playlist {
  entry?: Song[];
}

// ─── User ──────────────────────────────────────────────────────────────────────

export interface SubsonicUser {
  username: string;
  email?: string;
  maxBitRate?: number;
  adminRole: boolean;
  settingsRole: boolean;
  downloadRole: boolean;
  uploadRole: boolean;
  playlistRole: boolean;
  coverArtRole: boolean;
  commentRole: boolean;
  podcastRole: boolean;
  streamRole: boolean;
  jukeboxRole: boolean;
  shareRole: boolean;
  videoConversionRole: boolean;
  avatarLastChanged?: string;
  folder?: number[];
}

export interface CreateUserParams {
  username: string;
  password: string;
  email: string;
  ldapAuthenticated?: boolean;
  adminRole?: boolean;
  settingsRole?: boolean;
  streamRole?: boolean;
  jukeboxRole?: boolean;
  downloadRole?: boolean;
  uploadRole?: boolean;
  playlistRole?: boolean;
  coverArtRole?: boolean;
  commentRole?: boolean;
  podcastRole?: boolean;
  shareRole?: boolean;
  videoConversionRole?: boolean;
  musicFolderId?: number[];
}

export interface UpdateUserParams extends Partial<CreateUserParams> {
  username: string;
}

// ─── Search ────────────────────────────────────────────────────────────────────

export interface SearchResult3 {
  artist?: Artist[];
  album?: Album[];
  song?: Song[];
}

export interface Search3Params {
  query: string;
  artistCount?: number;
  artistOffset?: number;
  albumCount?: number;
  albumOffset?: number;
  songCount?: number;
  songOffset?: number;
  musicFolderId?: string;
}

// ─── Album List ────────────────────────────────────────────────────────────────

export type AlbumListType =
  | 'random'
  | 'newest'
  | 'highest'
  | 'frequent'
  | 'recent'
  | 'alphabeticalByName'
  | 'alphabeticalByArtist'
  | 'starred'
  | 'byYear'
  | 'byGenre';

export interface GetAlbumList2Params {
  type: AlbumListType;
  size?: number;
  offset?: number;
  fromYear?: number;
  toYear?: number;
  genre?: string;
  musicFolderId?: string;
}

// ─── License ───────────────────────────────────────────────────────────────────

export interface License {
  valid: boolean;
  email?: string;
  licenseExpires?: string;
  trialExpires?: string;
}

// ─── Scan Status ───────────────────────────────────────────────────────────────

export interface ScanStatus {
  scanning: boolean;
  count?: number;
  folderCount?: number;
  lastScan?: string;
}

// ─── Response payload shapes ───────────────────────────────────────────────────
// These are the shapes of the data inside 'subsonic-response' for each method.

export type PingResponse          = SubsonicResponse;
export type LicenseResponse       = SubsonicResponse<{ license: License }>;
export type GetUserResponse       = SubsonicResponse<{ user: SubsonicUser }>;
export type GetUsersResponse      = SubsonicResponse<{ users: { user: SubsonicUser[] } }>;
export type CreateUserResponse    = SubsonicResponse;
export type UpdateUserResponse    = SubsonicResponse;
export type DeleteUserResponse    = SubsonicResponse;
export type GetAlbumList2Response = SubsonicResponse<{ albumList2: { album: Album[] } }>;
export type GetAlbumResponse      = SubsonicResponse<{ album: AlbumWithSongs }>;
export type GetSongResponse       = SubsonicResponse<{ song: Song }>;
export type GetPlaylistsResponse  = SubsonicResponse<{ playlists: { playlist: Playlist[] } }>;
export type GetPlaylistResponse   = SubsonicResponse<{ playlist: PlaylistWithSongs }>;
export type CreatePlaylistResponse = SubsonicResponse<{ playlist: PlaylistWithSongs }>;
export type UpdatePlaylistResponse = SubsonicResponse;
export type DeletePlaylistResponse = SubsonicResponse;
export type Search3Response       = SubsonicResponse<{ searchResult3: SearchResult3 }>;
export type GetArtistResponse     = SubsonicResponse<{ artist: ArtistWithAlbums }>;
export type StartScanResponse     = SubsonicResponse<{ scanStatus: ScanStatus }>;
export type GetScanStatusResponse = SubsonicResponse<{ scanStatus: ScanStatus }>;

/**
 * Cassette Player — Subsonic API Client
 *
 * TypeScript client for the Subsonic/OpenSubsonic API.
 * Used by apps/cassette to:
 *   - Auto-provision user accounts on first purchase
 *   - Create/sync playlists from the discovery surface
 *   - Query "in your library" status for tracks and albums
 *   - Stream audio via play buttons
 *   - Trigger library rescans after purchase delivery
 *
 * Authentication uses MD5 token auth (Subsonic API spec):
 *   token = md5(password + salt)
 *   salt  = random string per request (or reused for simplicity)
 *
 * Usage:
 *   import { createSubsonicClient } from '@discovery/cassette-player/subsonic-client';
 *
 *   const client = createSubsonicClient({
 *     baseUrl: process.env.CASSETTE_PLAYER_URL,
 *     username: process.env.CASSETTE_PLAYER_ADMIN_USER,
 *     password: process.env.CASSETTE_PLAYER_ADMIN_PASS,
 *   });
 *
 *   await client.system.ping();
 *   await client.user.createUser({ username: 'buyer@example.com', ... });
 *   await client.media.getAlbumList2({ type: 'recent', size: 20 });
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { createHash } from 'crypto';
import type { SubsonicCredentials, SubsonicResponse } from './types';
import { system } from './methods/system';
import { user } from './methods/user';
import { media } from './methods/media';
import { playlists } from './methods/playlists';
import { search } from './methods/search';

export type { SubsonicCredentials } from './types';
export * from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CLIENT_NAME = 'cassette';
const DEFAULT_API_VERSION = '1.16.1';

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Generates Subsonic API auth parameters using MD5 token auth.
 * Per spec: token = md5(password + salt), salt = random string.
 *
 * https://subsonic.org/pages/api.jsp#authentication
 */
export function buildAuthParams(creds: SubsonicCredentials): Record<string, string> {
  const client = creds.clientName ?? DEFAULT_CLIENT_NAME;
  const version = creds.apiVersion ?? DEFAULT_API_VERSION;

  if (creds.token && creds.salt) {
    return {
      u: creds.username,
      t: creds.token,
      s: creds.salt,
      v: version,
      c: client,
      f: 'json',
    };
  }

  if (creds.password) {
    const salt = generateSalt();
    const token = md5(creds.password + salt);
    return {
      u: creds.username,
      t: token,
      s: salt,
      v: version,
      c: client,
      f: 'json',
    };
  }

  throw new Error(
    'SubsonicClient: either password or (token + salt) must be provided in credentials'
  );
}

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

function generateSalt(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < length; i++) {
    salt += chars[Math.floor(Math.random() * chars.length)];
  }
  return salt;
}

// ─── HTTP fetch helper ────────────────────────────────────────────────────────

export class SubsonicError extends Error {
  constructor(
    public readonly code: number,
    message: string
  ) {
    super(`Subsonic API error ${code}: ${message}`);
    this.name = 'SubsonicError';
  }
}

/**
 * Makes a GET request to the Subsonic API and returns the parsed response.
 * Throws SubsonicError if the server returns status: 'failed'.
 */
export async function subsonicFetch<T extends object>(
  creds: SubsonicCredentials,
  method: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T> {
  const authParams = buildAuthParams(creds);
  const url = new URL(`${creds.baseUrl}/rest/${method}`);

  for (const [key, value] of Object.entries({ ...authParams, ...params })) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new SubsonicError(
      response.status,
      `HTTP ${response.status} from Subsonic API: ${response.statusText}`
    );
  }

  const json = (await response.json()) as SubsonicResponse<T & object>;
  const data = json['subsonic-response'];

  if (data.status === 'failed') {
    const error = (data as unknown as { error?: { code: number; message: string } }).error;
    throw new SubsonicError(
      error?.code ?? 0,
      error?.message ?? 'Unknown Subsonic API error'
    );
  }

  return data as T;
}

/**
 * Builds a URL for a binary resource (cover art, stream).
 * These are not JSON endpoints — they stream binary data directly.
 */
export function buildResourceUrl(
  creds: SubsonicCredentials,
  method: string,
  params: Record<string, string | number | undefined> = {}
): string {
  const authParams = buildAuthParams(creds);
  const url = new URL(`${creds.baseUrl}/rest/${method}`);

  for (const [key, value] of Object.entries({ ...authParams, ...params })) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

// ─── Client factory ───────────────────────────────────────────────────────────

export interface SubsonicClient {
  /** Credentials bound to this client instance */
  readonly credentials: SubsonicCredentials;

  /** Build a URL for a binary resource (cover art, stream) */
  buildResourceUrl(
    method: string,
    params?: Record<string, string | number | undefined>
  ): string;

  /** System — ping, getLicense */
  system: ReturnType<typeof system>;

  /** User management — createUser, getUser, updateUser, deleteUser */
  user: ReturnType<typeof user>;

  /** Media library — getAlbumList2, getAlbum, getSong, getCoverArt URL, stream URL */
  media: ReturnType<typeof media>;

  /** Playlists — getPlaylists, createPlaylist, updatePlaylist, deletePlaylist */
  playlists: ReturnType<typeof playlists>;

  /** Search — search3 */
  search: ReturnType<typeof search>;
}

/**
 * Creates a Subsonic API client bound to the given credentials.
 *
 * @example
 * const client = createSubsonicClient({
 *   baseUrl: 'http://localhost:4533',
 *   username: 'admin',
 *   password: 'secret',
 * });
 *
 * await client.system.ping();
 */
export function createSubsonicClient(credentials: SubsonicCredentials): SubsonicClient {
  if (!credentials.baseUrl) {
    throw new Error('SubsonicClient: baseUrl is required');
  }
  if (!credentials.username) {
    throw new Error('SubsonicClient: username is required');
  }

  // Normalize baseUrl — strip trailing slash
  const creds: SubsonicCredentials = {
    ...credentials,
    baseUrl: credentials.baseUrl.replace(/\/$/, ''),
    clientName: credentials.clientName ?? DEFAULT_CLIENT_NAME,
    apiVersion: credentials.apiVersion ?? DEFAULT_API_VERSION,
  };

  return {
    credentials: creds,

    buildResourceUrl(
      method: string,
      params?: Record<string, string | number | undefined>
    ): string {
      return buildResourceUrl(creds, method, params);
    },

    system: system(creds),
    user: user(creds),
    media: media(creds),
    playlists: playlists(creds),
    search: search(creds),
  };
}

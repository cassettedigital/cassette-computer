/**
 * Subsonic API — Playlist methods
 * getPlaylists, getPlaylist, createPlaylist, updatePlaylist, deletePlaylist
 *
 * Used by apps/cassette to sync playlists from the discovery surface:
 *   - "Add to Player" actions create or update playlists via these endpoints
 *   - "My Purchases" playlist is auto-created on first purchase
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { subsonicFetch } from '../index';
import type { SubsonicCredentials, Playlist, PlaylistWithSongs } from '../types';

export function playlists(creds: SubsonicCredentials) {
  return {
    /**
     * Returns all playlists for the authenticated user.
     * Pass username to get another user's playlists (admin only).
     *
     * https://subsonic.org/pages/api.jsp#getPlaylists
     */
    async getPlaylists(username?: string): Promise<Playlist[]> {
      const data = await subsonicFetch<{ playlists: { playlist?: Playlist | Playlist[] } }>(
        creds,
        'getPlaylists',
        username ? { username } : {}
      );
      const result = data.playlists?.playlist ?? [];
      return Array.isArray(result) ? result : [result];
    },

    /**
     * Returns a specific playlist with all its tracks.
     *
     * https://subsonic.org/pages/api.jsp#getPlaylist
     */
    async getPlaylist(id: string): Promise<PlaylistWithSongs> {
      const data = await subsonicFetch<{ playlist: PlaylistWithSongs }>(
        creds,
        'getPlaylist',
        { id }
      );
      return data.playlist;
    },

    /**
     * Creates a new playlist.
     *
     * https://subsonic.org/pages/api.jsp#createPlaylist
     */
    async createPlaylist(name: string, songIds?: string[]): Promise<PlaylistWithSongs> {
      const params: Record<string, string | number | boolean | undefined> = { name };

      // Subsonic API takes songId as repeated params: songId=1&songId=2&...
      // We encode them as songId[0], songId[1], etc.
      if (songIds?.length) {
        songIds.forEach((id, i) => {
          params[`songId[${i}]`] = id;
        });
      }

      const data = await subsonicFetch<{ playlist: PlaylistWithSongs }>(
        creds,
        'createPlaylist',
        params
      );
      return data.playlist;
    },

    /**
     * Updates an existing playlist's metadata and/or track list.
     *
     * @param id - Playlist ID to update
     * @param options.name - New name
     * @param options.comment - New comment/description
     * @param options.public - Whether the playlist is public
     * @param options.songIdsToAdd - Song IDs to append to the playlist
     * @param options.songIndicesToRemove - Zero-based indices of songs to remove
     *
     * https://subsonic.org/pages/api.jsp#updatePlaylist
     */
    async updatePlaylist(
      id: string,
      options: {
        name?: string;
        comment?: string;
        public?: boolean;
        songIdsToAdd?: string[];
        songIndicesToRemove?: number[];
      }
    ): Promise<void> {
      const params: Record<string, string | number | boolean | undefined> = { playlistId: id };

      if (options.name !== undefined) params.name = options.name;
      if (options.comment !== undefined) params.comment = options.comment;
      if (options.public !== undefined) params.public = options.public;

      if (options.songIdsToAdd?.length) {
        options.songIdsToAdd.forEach((songId, i) => {
          params[`songIdToAdd[${i}]`] = songId;
        });
      }

      if (options.songIndicesToRemove?.length) {
        options.songIndicesToRemove.forEach((index, i) => {
          params[`songIndexToRemove[${i}]`] = index;
        });
      }

      await subsonicFetch(creds, 'updatePlaylist', params);
    },

    /**
     * Deletes a playlist.
     *
     * https://subsonic.org/pages/api.jsp#deletePlaylist
     */
    async deletePlaylist(id: string): Promise<void> {
      await subsonicFetch(creds, 'deletePlaylist', { id });
    },

    /**
     * Creates or retrieves the user's "My Purchases" playlist.
     * This is the auto-created playlist that receives every purchased track.
     *
     * Convenience method for the purchase-to-library pipeline.
     */
    async getOrCreatePurchasesPlaylist(): Promise<PlaylistWithSongs> {
      const PLAYLIST_NAME = 'My Purchases';
      const all = await this.getPlaylists();
      const existing = all.find((p) => p.name === PLAYLIST_NAME);

      if (existing) {
        return this.getPlaylist(existing.id);
      }

      return this.createPlaylist(PLAYLIST_NAME);
    },
  };
}

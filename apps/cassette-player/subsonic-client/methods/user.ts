/**
 * Subsonic API — User methods
 * createUser, getUser, getUsers, updateUser, deleteUser
 *
 * These are the methods used by apps/cassette for account auto-provisioning:
 * when a customer makes their first purchase, we create their Cassette Player
 * account via these endpoints so they never have to set up the player manually.
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { subsonicFetch } from '../index';
import type { SubsonicCredentials, SubsonicUser, CreateUserParams, UpdateUserParams } from '../types';

export function user(creds: SubsonicCredentials) {
  return {
    /**
     * Returns details about a given user, including granted roles and folder access.
     * Use this to verify a user exists before creating them.
     *
     * https://subsonic.org/pages/api.jsp#getUser
     */
    async getUser(username: string): Promise<SubsonicUser> {
      const data = await subsonicFetch<{ user: SubsonicUser }>(
        creds,
        'getUser',
        { username }
      );
      return data.user;
    },

    /**
     * Returns all users. Admin credentials required.
     *
     * https://subsonic.org/pages/api.jsp#getUsers
     */
    async getUsers(): Promise<SubsonicUser[]> {
      const data = await subsonicFetch<{ users: { user: SubsonicUser | SubsonicUser[] } }>(
        creds,
        'getUsers'
      );
      // Navidrome may return a single object instead of array for one user
      const users = data.users.user;
      return Array.isArray(users) ? users : [users];
    },

    /**
     * Creates a new user account.
     * Called by apps/cassette when a customer completes their first purchase.
     *
     * Default roles for a Cassette customer account:
     *   - streamRole: true (play music)
     *   - downloadRole: false (we don't expose direct downloads)
     *   - adminRole: false
     *   - playlistRole: true (manage playlists)
     *
     * https://subsonic.org/pages/api.jsp#createUser
     */
    async createUser(params: CreateUserParams): Promise<void> {
      await subsonicFetch(creds, 'createUser', {
        username: params.username,
        password: params.password,
        email: params.email,
        ldapAuthenticated: params.ldapAuthenticated,
        adminRole: params.adminRole ?? false,
        settingsRole: params.settingsRole ?? true,
        streamRole: params.streamRole ?? true,
        jukeboxRole: params.jukeboxRole ?? false,
        downloadRole: params.downloadRole ?? false,
        uploadRole: params.uploadRole ?? false,
        playlistRole: params.playlistRole ?? true,
        coverArtRole: params.coverArtRole ?? false,
        commentRole: params.commentRole ?? false,
        podcastRole: params.podcastRole ?? false,
        shareRole: params.shareRole ?? false,
        videoConversionRole: params.videoConversionRole ?? false,
        ...(params.musicFolderId
          ? Object.fromEntries(
              params.musicFolderId.map((id, i) => [`musicFolderId[${i}]`, id])
            )
          : {}),
      });
    },

    /**
     * Updates an existing user's properties.
     * Use this to change password, roles, or folder access.
     *
     * https://subsonic.org/pages/api.jsp#updateUser
     */
    async updateUser(params: UpdateUserParams): Promise<void> {
      const { username, ...rest } = params;
      await subsonicFetch(creds, 'updateUser', {
        username,
        ...rest,
      });
    },

    /**
     * Deletes an existing user.
     * We may use this for account deletion flows.
     *
     * https://subsonic.org/pages/api.jsp#deleteUser
     */
    async deleteUser(username: string): Promise<void> {
      await subsonicFetch(creds, 'deleteUser', { username });
    },

    /**
     * Changes the password of an existing user.
     * Note: requires admin credentials OR the user changing their own password.
     *
     * https://subsonic.org/pages/api.jsp#changePassword
     */
    async changePassword(username: string, newPassword: string): Promise<void> {
      await subsonicFetch(creds, 'changePassword', { username, password: newPassword });
    },

    /**
     * Attempts to get a user, creating them if they don't exist.
     * Convenience method for the auto-provisioning flow.
     *
     * Returns the user record and whether it was newly created.
     */
    async getOrCreate(
      params: CreateUserParams
    ): Promise<{ user: SubsonicUser; created: boolean }> {
      try {
        const existing = await this.getUser(params.username);
        return { user: existing, created: false };
      } catch (err: unknown) {
        // Error code 70 = data not found — user doesn't exist yet
        if (err instanceof Error && err.message.includes('70')) {
          await this.createUser(params);
          const created = await this.getUser(params.username);
          return { user: created, created: true };
        }
        throw err;
      }
    },
  };
}

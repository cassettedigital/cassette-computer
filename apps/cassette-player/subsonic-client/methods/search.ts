/**
 * Subsonic API — Search methods
 * search3
 *
 * Used by apps/cassette to check "in your library" status:
 *   - Search by album/artist name to see if it's in the user's library
 *   - Search before auto-provisioning to avoid re-adding purchased tracks
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { subsonicFetch } from '../index';
import type { SubsonicCredentials, SearchResult3, Search3Params, Artist, Album, Song } from '../types';

export function search(creds: SubsonicCredentials) {
  return {
    /**
     * Searches the library by query string across artists, albums, and songs.
     * ID3-based search (uses metadata tags, not folder structure).
     *
     * https://subsonic.org/pages/api.jsp#search3
     */
    async search3(params: Search3Params): Promise<SearchResult3> {
      const data = await subsonicFetch<{ searchResult3: SearchResult3 }>(
        creds,
        'search3',
        {
          query: params.query,
          artistCount: params.artistCount ?? 10,
          artistOffset: params.artistOffset ?? 0,
          albumCount: params.albumCount ?? 10,
          albumOffset: params.albumOffset ?? 0,
          songCount: params.songCount ?? 20,
          songOffset: params.songOffset ?? 0,
          musicFolderId: params.musicFolderId,
        }
      );
      return data.searchResult3;
    },

    /**
     * Searches for artists matching a query.
     * Convenience wrapper around search3.
     */
    async searchArtists(query: string, count = 10): Promise<Artist[]> {
      const results = await this.search3({
        query,
        artistCount: count,
        albumCount: 0,
        songCount: 0,
      });
      return results.artist ?? [];
    },

    /**
     * Searches for albums matching a query.
     * Convenience wrapper around search3.
     */
    async searchAlbums(query: string, count = 10): Promise<Album[]> {
      const results = await this.search3({
        query,
        artistCount: 0,
        albumCount: count,
        songCount: 0,
      });
      return results.album ?? [];
    },

    /**
     * Searches for songs matching a query.
     * Convenience wrapper around search3.
     */
    async searchSongs(query: string, count = 20): Promise<Song[]> {
      const results = await this.search3({
        query,
        artistCount: 0,
        albumCount: 0,
        songCount: count,
      });
      return results.song ?? [];
    },

    /**
     * Checks if an album is in the user's library by its title.
     * Returns the album if found, null otherwise.
     * Useful for displaying "In Your Library" badges on the Cassette discovery surface.
     */
    async findAlbumInLibrary(albumTitle: string): Promise<Album | null> {
      const albums = await this.searchAlbums(albumTitle, 5);
      const match = albums.find(
        (a) => a.name.toLowerCase() === albumTitle.toLowerCase()
      );
      return match ?? null;
    },
  };
}

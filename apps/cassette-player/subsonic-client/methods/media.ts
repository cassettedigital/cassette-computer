/**
 * Subsonic API — Media methods
 * getAlbumList2, getAlbum, getSong, getCoverArt URL, stream URL, getArtist
 *
 * These are used by apps/cassette to:
 *   - Display "in your library" indicators on album/track pages
 *   - Stream audio via "play" buttons on the discovery surface
 *   - Show recently purchased/added albums
 *
 * GPL v3 fork of Navidrome — https://github.com/navidrome/navidrome
 */

import { subsonicFetch, buildResourceUrl } from '../index';
import type {
  SubsonicCredentials,
  Album,
  AlbumWithSongs,
  Song,
  ArtistWithAlbums,
  ArtistInfo,
  GetAlbumList2Params,
} from '../types';

export function media(creds: SubsonicCredentials) {
  return {
    /**
     * Returns a list of albums, optionally filtered by type.
     * Use type: 'recent' to show recently added albums (e.g. after a purchase).
     * Use type: 'random' for discovery widgets.
     *
     * https://subsonic.org/pages/api.jsp#getAlbumList2
     */
    async getAlbumList2(params: GetAlbumList2Params): Promise<Album[]> {
      const data = await subsonicFetch<{ albumList2: { album: Album | Album[] } }>(
        creds,
        'getAlbumList2',
        {
          type: params.type,
          size: params.size ?? 20,
          offset: params.offset ?? 0,
          fromYear: params.fromYear,
          toYear: params.toYear,
          genre: params.genre,
          musicFolderId: params.musicFolderId,
        }
      );
      const albums = data.albumList2?.album ?? [];
      return Array.isArray(albums) ? albums : [albums];
    },

    /**
     * Returns details for a specific album, including all its tracks.
     *
     * https://subsonic.org/pages/api.jsp#getAlbum
     */
    async getAlbum(id: string): Promise<AlbumWithSongs> {
      const data = await subsonicFetch<{ album: AlbumWithSongs }>(
        creds,
        'getAlbum',
        { id }
      );
      return data.album;
    },

    /**
     * Returns details for a specific song/track.
     *
     * https://subsonic.org/pages/api.jsp#getSong
     */
    async getSong(id: string): Promise<Song> {
      const data = await subsonicFetch<{ song: Song }>(creds, 'getSong', { id });
      return data.song;
    },

    /**
     * Returns details for a specific artist, including all their albums.
     *
     * https://subsonic.org/pages/api.jsp#getArtist
     */
    async getArtist(id: string): Promise<ArtistWithAlbums> {
      const data = await subsonicFetch<{ artist: ArtistWithAlbums }>(
        creds,
        'getArtist',
        { id }
      );
      return data.artist;
    },

    /**
     * Returns artist info (biography, images, similar artists).
     *
     * https://subsonic.org/pages/api.jsp#getArtistInfo2
     */
    async getArtistInfo(id: string, count = 5): Promise<ArtistInfo> {
      const data = await subsonicFetch<{ artistInfo2: ArtistInfo }>(
        creds,
        'getArtistInfo2',
        { id, count, includeNotPresent: false }
      );
      return data.artistInfo2;
    },

    /**
     * Returns the URL for a cover art image.
     * This is a binary endpoint — returns the URL for use in <img> tags.
     * Size is the pixel dimension (square). Navidrome will resize/cache.
     *
     * https://subsonic.org/pages/api.jsp#getCoverArt
     */
    getCoverArtUrl(id: string, size?: number): string {
      return buildResourceUrl(creds, 'getCoverArt', { id, size });
    },

    /**
     * Returns the URL for streaming a song.
     * This is a binary endpoint — returns the URL for use in <audio> src.
     *
     * maxBitRate: transcode to this bitrate (kbps). 0 = no transcoding.
     * format: 'raw' to skip transcoding, 'mp3'/'aac'/'ogg' to transcode.
     *
     * https://subsonic.org/pages/api.jsp#stream
     */
    getStreamUrl(id: string, options?: { maxBitRate?: number; format?: string }): string {
      return buildResourceUrl(creds, 'stream', {
        id,
        maxBitRate: options?.maxBitRate,
        format: options?.format,
      });
    },

    /**
     * Registers a play for the given song on the person's own server.
     * Increments play count and updates "last played" timestamp.
     *
     * https://subsonic.org/pages/api.jsp#scrobble
     */
    async scrobble(id: string, submission = true): Promise<void> {
      await subsonicFetch(creds, 'scrobble', {
        id,
        submission,
        time: Date.now(),
      });
    },

    /**
     * Stars/favorites an album, artist, or song.
     *
     * https://subsonic.org/pages/api.jsp#star
     */
    async star(params: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
      await subsonicFetch(creds, 'star', params);
    },

    /**
     * Removes a star/favorite.
     *
     * https://subsonic.org/pages/api.jsp#unstar
     */
    async unstar(params: { id?: string; albumId?: string; artistId?: string }): Promise<void> {
      await subsonicFetch(creds, 'unstar', params);
    },
  };
}

/** A video Discogs lists on a release or master: the YouTube candidates for an album (lib/providers/discogs).
 *  Apart from the client so the matcher (lib/preview/youtube-match) can name it without the provider registry. */
export interface DiscogsVideo {
  uri: string;
  title: string;
  description?: string;
  duration: number;
  embed: boolean;
}

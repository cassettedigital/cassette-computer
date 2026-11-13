/**
 * A taste page's payload without its structured data (BUG-815). The album and artist loaders return the
 * page's schema.org data for the public page's head only ((taste)/album/[slug]/data.ts: "never handed to the
 * client"); the public pages take it off before handing the rest to the browser. The desk hands its page
 * straight to a client body, and the cloud's desk routes answer with it as JSON, so both go through this first.
 */
export function withoutLd<T extends { jsonLd?: unknown }>(page: T | null): Omit<T, "jsonLd"> | null {
  if (!page) return null;
  const out: Partial<T> = { ...page };
  delete out.jsonLd;
  return out as Omit<T, "jsonLd">;
}

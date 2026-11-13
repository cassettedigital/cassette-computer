"use client";
/**
 * What goes to your phones, from the desk's Devices page (BUG-898): the account's one switch (the whole library,
 * or only the albums chosen for each phone) and the choosing, through the same sync API the old device pages
 * used (/api/account/sync-scope; /api/sync/devices/[id]/choose marks every part of an album and asks the phone
 * to fetch it). The paired app sends these to the cloud with its token. Each says whether it saved.
 */

export type PhonesGet = "everything" | "selective";

async function saved(url: string, method: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

export function setPhonesGet(scope: PhonesGet): Promise<boolean> {
  return saved("/api/account/sync-scope", "PATCH", { sync_scope: scope });
}

/** Choose (or stop choosing) these library albums for one phone; choosing one taken off it sends it back. */
export function choosePhoneAlbums(deviceId: string, keys: string[], chosen: boolean): Promise<boolean> {
  return saved(`/api/sync/devices/${encodeURIComponent(deviceId)}/choose`, "POST", { group_keys: keys, chosen });
}

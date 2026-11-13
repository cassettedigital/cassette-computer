import "server-only";

/**
 * The paired desktop app's kept copies (BUG-542): the last good answer to each cloud read it relies on,
 * on this Mac's disk, so the app opens and the library shows with no internet. Only in token mode (the
 * shipped app's local server); the web never writes here.
 *
 * Where: CASSETTE_OFFLINE_DIR when set, else the user's own app-data folder
 * (~/Library/Application Support/Cassette/offline on a Mac). Never inside the app bundle (it's signed).
 * One JSON file per read, named by a hash of its key. Best-effort: a failed write or read is no copy.
 *
 * The copies are the person's own data on their own machine. A refused token deletes them all
 * (dropAll), so nothing of an account outlives its pairing.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classify, settle, type Settled } from "./cloud-answer";
import { assertLocalRender, CLOUD_BASE, DESKTOP_TOKEN } from "./player-client";

const DIR =
  process.env.CASSETTE_OFFLINE_DIR?.trim() ||
  (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "Cassette", "offline") : path.join(os.homedir(), ".cassette", "offline"));

const fileFor = (key: string) => path.join(DIR, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`);

async function readCopy<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(fileFor(key), "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeCopy<T>(key: string, value: T): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    const f = fileFor(key);
    const tmp = `${f}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, f);
  } catch {
    /* no copy this time */
  }
}

/** Every kept copy goes (a refused token: the account is no longer this Mac's). */
export async function dropAll(): Promise<void> {
  try {
    await rm(DIR, { recursive: true, force: true });
  } catch {
    /* nothing to drop */
  }
}

/**
 * Settle one read against its kept copy: `ask` makes the request and reports the status (null when no
 * reply came) and the body. A reply is used and kept, a refusal (401/403) clears every copy and comes
 * back empty, silence (no network, a timeout, a server error) comes back as the kept copy, marked
 * offline. `key` names the copy.
 */
export async function withCopy<T>(key: string, ask: () => Promise<{ status: number | null; value: T | null }>): Promise<Settled<T>> {
  let status: number | null = null;
  let value: T | null = null;
  try {
    ({ status, value } = await ask());
  } catch {
    status = null;
  }
  const answer = classify<T>(status, value);
  const kept = answer.kind === "unreachable" ? await readCopy<T>(key) : null;
  const out = settle(answer, kept);
  if (out.copy && "write" in out.copy) await writeCopy(key, out.copy.write);
  if (out.copy && "drop" in out.copy) await dropAll();
  return out;
}

/** A cloud read over the device token, settled against its kept copy (see withCopy). */
export async function askCloud<T>(apiPath: string, waitMs = 6000): Promise<Settled<T>> {
  if (!DESKTOP_TOKEN) throw new Error("askCloud outside token mode (no CASSETTE_PLAYER_TOKEN)");
  await assertLocalRender();
  return withCopy<T>(apiPath, async () => {
    const res = await fetch(`${CLOUD_BASE}${apiPath}`, {
      headers: { Authorization: `Bearer ${DESKTOP_TOKEN}` },
      cache: "no-store",
      signal: AbortSignal.timeout(waitMs),
    });
    return { status: res.status, value: res.ok ? ((await res.json()) as T) : null };
  });
}

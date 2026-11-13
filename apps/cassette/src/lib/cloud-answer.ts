/**
 * What the cloud said, for the paired desktop app (token mode), in the three kinds that matter to it
 * (BUG-542):
 *
 *   answered     it replied: use the reply, and keep a copy of it
 *   refused      401 or 403: the device token is no good (revoked, or from another account); the
 *                person is signed out, and any kept copy goes, so nothing of theirs outlives the token
 *   unreachable  no reply (no network, a timeout) or a server error: carry on from the kept copy,
 *                marked offline, so the music on the Mac still plays
 *
 * Pure (no I/O), so the rule is tested on its own (cloud-answer.test.ts).
 */

export type CloudAnswer<T> = { kind: "answered"; value: T | null } | { kind: "refused" } | { kind: "unreachable" };

/** A response status or a thrown fetch error, as one of the three. */
export function classify<T>(status: number | null, value?: T | null): CloudAnswer<T> {
  if (status === null) return { kind: "unreachable" };
  if (status === 401 || status === 403) return { kind: "refused" };
  if (status === 404) return { kind: "answered", value: null };
  if (status >= 200 && status < 300) return { kind: "answered", value: value ?? null };
  return { kind: "unreachable" }; // 5xx and anything odd: the cloud is having a moment, not saying no
}

export type Settled<T> = {
  /** what the cloud said */
  heard: CloudAnswer<T>["kind"];
  /** what to use now (null: nothing; for the session, signed out) */
  value: T | null;
  /** came from the kept copy because the cloud didn't answer */
  offline: boolean;
  /** what to do with the kept copy */
  copy: { write: T } | { drop: true } | null;
};

/** The rule: a reply wins and is kept; a refusal clears everything; silence falls back to the copy. */
export function settle<T>(answer: CloudAnswer<T>, kept: T | null): Settled<T> {
  if (answer.kind === "answered") return { heard: "answered", value: answer.value, offline: false, copy: answer.value === null ? null : { write: answer.value } };
  if (answer.kind === "refused") return { heard: "refused", value: null, offline: false, copy: { drop: true } };
  return { heard: "unreachable", value: kept, offline: kept !== null, copy: null };
}

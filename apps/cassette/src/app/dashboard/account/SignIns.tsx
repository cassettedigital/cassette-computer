"use client";

/**
 * Every computer and phone signed in to the account, each with its own Sign out (BUG-859): a sold phone or a
 * wiped computer stops working the moment it's signed out here. The list comes from /api/account/sign-ins, with
 * the website's session or, in the desktop app, through its cloud proxy. This computer, in the app, is named and
 * signs out from the account menu instead.
 */

import { useCallback, useEffect, useState } from "react";
import { Key, Note } from "@discovery/cassette-kit";
import { askToConfirm } from "@/lib/ask";
import { Setting, SettingList } from "@/app/settings/_parts/parts";
import type { SignIn } from "@/lib/player-answers";

const KIND = { computer: "Computer", iphone: "iPhone", android: "Android phone" } as const;

function used(s: SignIn): string {
  const at = s.lastUsedAt ?? s.createdAt;
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  if (days < 1) return "used today";
  if (days < 2) return "used yesterday";
  return `last used ${days} days ago`;
}

export function SignIns() {
  const [list, setList] = useState<SignIn[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/sign-ins", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setList(((await res.json()) as { signIns: SignIn[] }).signIns);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async (s: SignIn) => {
    const yes = await askToConfirm(`Sign out ${s.name}? It stops working with your account until it signs in again.`, {
      ok: "Sign out",
    });
    if (!yes) return;
    await fetch(`/api/account/sign-ins/${s.id}`, { method: "DELETE", credentials: "include" }).catch(() => {});
    await load();
  };

  return (
    <>
      {failed && <Note tone="quiet">Couldn&apos;t load your computers and phones. Try again in a moment.</Note>}
      {list && list.length === 0 && <Note tone="quiet">No computers or phones are signed in.</Note>}
      {list && list.length > 0 && (
        <SettingList label="Signed in">
          {list.map((s) => (
            <Setting
              key={s.id}
              name={s.current ? `${s.name} (this computer)` : s.name}
              about={`${KIND[s.kind]}, ${used(s)}`}
              end={s.current ? null : <Key onClick={() => void signOut(s)}>Sign out</Key>}
            />
          ))}
        </SettingList>
      )}
    </>
  );
}

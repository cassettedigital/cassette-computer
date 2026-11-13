"use client";

/**
 * This computer's part in the account, when it isn't the main one (BUG-862; the founder's flow, call 4). The
 * hub says what it is (sidecar satellite.go):
 *
 *   spare      signed in, holding nothing. First it's greeted: "Bring your music to this computer?". Yes
 *              makes it a satellite. Not now opens the switch screen, which counts what would leave the
 *              library and the phones and never offers "main" to a computer holding under a quarter of the
 *              library (the cloud holds the same line). "Keep <main> as main" leaves it holding nothing,
 *              with the offer where the library would be.
 *   satellite  it receives the music from the main computer. A banner on Home says so, with the way to
 *              the switch screen in plain sight; the library shows only what's here (the cloud filters it).
 *
 * The main computer sees none of this.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { tokens as kit } from "@discovery/cassette-kit";
import { LogoMark } from "@/app/_taste/Brand";
import t from "@/app/_taste/taste.module.css";
import { hubFetch, HUB_IN_REACH } from "@/lib/hub-origin";
import d from "./desk.module.css";

export type ComputerStatus = {
  role: "main" | "satellite" | "spare";
  main: string;
  declined?: boolean;
  library?: { songs: number; records: number };
  here?: { songs: number; records: number };
  libraryBytes?: number | null;
  freeBytes?: number;
  mainReachable?: boolean | null;
  syncing?: boolean;
  full?: boolean;
  pending?: number;
  progress?: { done: number; total: number; current?: string; phase?: string };
  lastFillAt?: string;
  error?: string;
};

export type SwitchCounts = {
  librarySongs: number;
  libraryRecords: number;
  hereRecords: number;
  hereSongs: number;
  onlyOnMainRecords: number;
  phonesLoseRecords: number;
  mayBecomeMain: boolean;
};

type Ctx = {
  status: ComputerStatus | null;
  /** the hub is starting again for its new role */
  restarting: boolean;
  switchOpen: boolean;
  openSwitch: (open: boolean) => void;
  join: () => Promise<string | null>;
  keepMain: () => Promise<void>;
  makeMain: () => Promise<string | null>;
};

const ThisComputerCtx = createContext<Ctx | null>(null);

export const useThisComputer = () => useContext(ThisComputerCtx);

/** True only once the hub has said this computer is a satellite or a spare: the main one sees nothing. */
export function useNotMain(): boolean {
  const c = useThisComputer();
  return !!c?.status && c.status.role !== "main";
}

async function hubJSON<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; body: T | null }> {
  try {
    const r = await hubFetch(path, init);
    const body = (await r.json().catch(() => null)) as T | null;
    return { ok: r.ok, body };
  } catch {
    return { ok: false, body: null };
  }
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

export function ThisComputerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [switchOpen, openSwitch] = useState(false);
  const role = useRef<string | null>(null);

  const read = useCallback(async () => {
    const { ok, body } = await hubJSON<ComputerStatus>("/api/satellite/status");
    if (!ok || !body) return;
    setStatus(body);
    // A new role means a new shelf: the cloud draws a satellite's own records, a spare's none.
    if (role.current !== null && role.current !== body.role) {
      setRestarting(false);
      router.refresh();
    }
    role.current = body.role;
  }, [router]);

  useEffect(() => {
    if (!HUB_IN_REACH) return;
    void read();
    const busy = restarting || status?.syncing;
    const id = setInterval(() => void read(), busy ? 3_000 : 30_000);
    return () => clearInterval(id);
  }, [read, restarting, status?.syncing]);

  const join = useCallback(async () => {
    const { ok, body } = await hubJSON<{ error?: string }>("/api/satellite/join", post());
    if (!ok) return body?.error ?? "Couldn't reach your main computer's account just now.";
    setRestarting(true);
    openSwitch(false);
    return null;
  }, []);

  const keepMain = useCallback(async () => {
    await hubJSON("/api/satellite/keep-main", post());
    openSwitch(false);
    await read();
  }, [read]);

  const makeMain = useCallback(async () => {
    const { ok, body } = await hubJSON<{ error?: string }>("/api/satellite/make-main", post({ confirm: true }));
    if (!ok) return body?.error ?? "That didn't go through.";
    setRestarting(true);
    openSwitch(false);
    return null;
  }, []);

  const value = useMemo(() => ({ status, restarting, switchOpen, openSwitch, join, keepMain, makeMain }), [status, restarting, switchOpen, join, keepMain, makeMain]);
  return <ThisComputerCtx.Provider value={value}>{children}</ThisComputerCtx.Provider>;
}

/* ── the words ── */

const records = (n: number) => `${n.toLocaleString()} ${n === 1 ? "record" : "records"}`;

function size(bytes: number | null | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
  if (gb >= 10) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className={`${t.root} ${t.follows} ${kit.kit} ${kit.follow} ${d.away}`} data-follows="">
      <LogoMark className={d.awayMark} />
      {children}
    </main>
  );
}

/* ── the first screen, every second computer ── */

export function Greeting() {
  const c = useThisComputer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notNow, setNotNow] = useState(false);
  if (!c?.status) return null;
  if (c.restarting) return <Starting main={c.status.main} />;
  if (notNow) return <SwitchScreen onBack={() => setNotNow(false)} />;
  const s = c.status;
  const n = s.library?.records ?? 0;
  const take = size(s.libraryBytes);
  const room = size(s.freeBytes);
  const line =
    n === 0
      ? `Your library on ${s.main} is empty for now. Whatever you add there copies over your home Wi-Fi and plays here anywhere.`
      : [
          `Your ${records(n)} live on ${s.main}.`,
          take && room ? `They take about ${take}, and this computer has ${room} free.` : null,
          "They copy over your home Wi-Fi, then play here anywhere.",
        ]
          .filter(Boolean)
          .join(" ");
  return (
    <Frame>
      <h1 className={d.awayHead}>Bring your music to this computer?</h1>
      <p className={d.awayLine}>{line}</p>
      {s.mainReachable === false && <p className={d.awayLine}>{s.main} needs to be on and on this Wi-Fi to send them.</p>}
      {error && <p className={d.awayLine} role="alert">{error}</p>}
      <div className={d.awayKeys}>
        <button
          type="button"
          className={d.awayPrimary}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await c.join());
            setBusy(false);
          }}
        >
          Bring my music here
        </button>
        <button type="button" className={d.awaySecondary} disabled={busy} onClick={() => setNotNow(true)}>
          Not now
        </button>
      </div>
    </Frame>
  );
}

function Starting({ main }: { main: string }) {
  return (
    <Frame>
      <h1 className={d.awayHead}>Getting ready</h1>
      <p className={d.awayLine}>This computer is setting up to receive your music from {main}.</p>
    </Frame>
  );
}

/* ── the switch screen: counts first, the safe answer bold ── */

export function SwitchScreen({ onBack }: { onBack?: () => void }) {
  const c = useThisComputer();
  const [counts, setCounts] = useState<SwitchCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void hubJSON<SwitchCounts>("/api/satellite/preview", post()).then(({ ok, body }) => {
      if (!live) return;
      if (ok && body) setCounts(body);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!c?.status) return null;
  if (c.restarting) return <Starting main={c.status.main} />;
  const main = c.status.main;
  const satellite = c.status.role === "satellite";
  const keep = satellite ? (
    <button type="button" className={d.awayPrimary} disabled={busy} onClick={() => (onBack ? onBack() : c.openSwitch(false))}>
      Keep {main} as main
    </button>
  ) : (
    <button type="button" className={d.awayPrimary} disabled={busy} onClick={() => void c.keepMain()}>
      Keep {main} as main
    </button>
  );

  if (!counts) {
    return (
      <Frame>
        <h1 className={d.awayHead}>Make this your main computer?</h1>
        <p className={d.awayLine}>{failed ? "Cassette couldn't count what's on this computer just now." : "Counting what's on this computer…"}</p>
        <div className={d.awayKeys}>{keep}</div>
      </Frame>
    );
  }

  if (!counts.mayBecomeMain || counts.hereRecords === 0) {
    return (
      <Frame>
        <h1 className={d.awayHead}>{counts.hereRecords === 0 ? "This computer has no music yet" : "This computer has only a little of your music"}</h1>
        <p className={d.awayLine}>Making it the main computer now would empty your library and your phones, so Cassette doesn&rsquo;t offer that here.</p>
        <div className={d.awayKeys}>
          {!satellite && (
            <button
              type="button"
              className={d.awayPrimary}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(await c.join());
                setBusy(false);
              }}
            >
              Bring my music here
            </button>
          )}
          {satellite ? keep : (
            <button type="button" className={d.awaySecondary} disabled={busy} onClick={() => void c.keepMain()}>
              Keep {main} as main
            </button>
          )}
        </div>
        {error && <p className={d.awayLine} role="alert">{error}</p>}
      </Frame>
    );
  }

  const lose = counts.phonesLoseRecords;
  return (
    <Frame>
      <h1 className={d.awayHead}>Make this your main computer?</h1>
      <dl className={d.switchFacts}>
        <div>
          <dt>Your library</dt>
          <dd>becomes the {records(counts.hereRecords)} on this computer</dd>
        </div>
        <div>
          <dt>{main}</dt>
          <dd>keeps every file and becomes a satellite</dd>
        </div>
        <div>
          <dt>Your phones</dt>
          <dd>{lose === 0 ? "keep everything they have" : `${records(lose)} only on ${main} come off them at their next fill`}</dd>
        </div>
      </dl>
      <div className={d.awayKeys}>
        {keep}
        <button
          type="button"
          className={d.awayWarn}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(await c.makeMain());
            setBusy(false);
          }}
        >
          Make this my main computer
        </button>
      </div>
      {error && <p className={d.awayLine} role="alert">{error}</p>}
    </Frame>
  );
}

/* ── on Home: the satellite's banner, or the spare's offer where the library would be ── */

const CLOSED_KEY = "cs-satellite-banner-closed";

export function HereStrip({ always = false }: { always?: boolean }) {
  const c = useThisComputer();
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      setClosed(localStorage.getItem(CLOSED_KEY) === "1");
    } catch {
      /* private window: the banner shows */
    }
  }, []);
  const s = c?.status;
  if (!c || !s || s.role === "main") return null;

  if (s.role === "spare") {
    return (
      <section className={d.hereStrip} aria-label="Your music">
        <p className={d.hereLine}>
          Your music lives on {s.main}. Bring it here and it plays on this computer anywhere.
        </p>
        <button
          type="button"
          className={d.hereKey}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await c.join();
            setBusy(false);
          }}
        >
          Bring my music here
        </button>
      </section>
    );
  }

  if (closed && !always) return null;
  const here = s.here?.records ?? 0;
  const all = s.library?.records ?? 0;
  const p = s.progress;
  const moving = s.syncing && p && p.total > 0 ? ` · bringing over ${p.done} of ${p.total}` : "";
  return (
    <section className={d.hereStrip} aria-label="This computer">
      <p className={d.hereLine}>
        This computer receives your music from {s.main} · {here.toLocaleString()} of {records(all)} here{moving}
        {s.error ? <span className={d.hereNote}> · {s.error}</span> : null}
      </p>
      <button type="button" className={d.hereLink} onClick={() => c.openSwitch(true)}>
        Make this the main computer
      </button>
      {!always && <button
        type="button"
        className={d.hereClose}
        aria-label="Close"
        onClick={() => {
          setClosed(true);
          try {
            localStorage.setItem(CLOSED_KEY, "1");
          } catch {
            /* closes for this window */
          }
        }}
      >
        ×
      </button>}
    </section>
  );
}

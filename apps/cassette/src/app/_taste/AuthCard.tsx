"use client";

/**
 * The account card (design wave 1a, the system's AuthCard): every account page is one of these, drawn only inside
 * FocusFrame, which decides the chrome around it (the founder's D3 B). Its props are its whole contract, so a card
 * can't grow a paragraph: there is no eyebrow, subtitle, note, fine print, footer, children or class.
 *
 *   subject     what the card is about, above the title: the Cassette app's own tile (the computer or the phone),
 *               captioned "The Cassette app" and, under it, the account ("as name@example.com") or where it runs; a
 *               long address grows up and down around the tile's middle, so the title holds (the founder's pick, 11-23);
 *               or an artist, as the kit's artist row (a claim)
 *   title       the card's one title, a question when it asks one ("Sign in on this computer?"), sized to the column
 *               (the founder's D2 B: 40px on a computer, so most sit on one line above the keys; 30 on a phone)
 *   line        one sentence, when the title needs one (90 characters)
 *   disclosure  a required sentence by name (disclosures.ts): under the title (the pairing page's write-back line, with
 *               its Tip), or under the keys where the person commits (the terms)
 *   tip         one short sentence behind a "?" at the end of the line (the kit's Tip)
 *   notice      one line from the form: what went wrong, or what happened (a code sent). It, and a field's error, have one
 *               planned home, right under the key row, so the title, the fields and the keys never move; only the
 *               quiet links under it step down (the founder's pick, 11-23, under the stable-eyeline rule)
 *   another     another way in, above the form, with the word under it ("or with your email"): Google's key
 *   fields      the form's fields, as data (with onSubmit, or `action` for a form that sends itself as an address): text (each a label or a placeholder, never both, W5), a few lines of the
 *               person's own words, choices as chips, a box to tick, a list of things to take (a purchase's files)
 *   keys        the card's keys, through the one row (ActionRow): an equal pair (Cancel and Sign in), or one key
 *               across the column; each says how it gives way (Button `give`)
 *   links       up to two quiet links under the keys ("Use another account", "Forgot your password?")
 *
 * A form with steps is one card per step. Words are plain strings; the parts say so in development when a title or a
 * line runs over its budget (the kit's BUDGET, W2).
 */

import { Fragment, useId, type FormEvent, type InputHTMLAttributes, type ReactElement } from "react";
import { BUDGET, Tip } from "@discovery/cassette-kit";
import type { AppDevice } from "@/lib/opened-by-app";
import { ActionRow } from "./ActionRow";
import { ArtistRows, type ArtistRow } from "./ArtistRows";
import { DISCLOSURES, type DisclosureId, type DisclosurePart } from "./disclosures";
import { buttonClass } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { Field } from "./Field";
import { TextArea } from "./TextArea";
import { useFocus } from "./FocusFrame";
import { GlyphTile } from "./GlyphTile";
import c from "./authcard.module.css";

/**
 * What the card is about: the Cassette app on a device, signing in as an account (or, signed out, where it runs); or an
 * artist, as the kit's artist row (a claim).
 */
export type AuthSubject = { device: AppDevice; as?: string } | { artist: ArtistRow };

/** A text field, as data. `show` is "placeholder" (the default: the label is kept for screen readers) or "label". */
export type AuthTextField = {
  kind?: "text";
  name: string;
  label: string;
  show?: "placeholder" | "label";
  type?: "text" | "email" | "password" | "url" | "search";
  /** the field's words, held by the form (a form that sends itself as an address, `action`, gives `start` instead) */
  value?: string;
  onChange?: (value: string) => void;
  /** what it starts with, in a form that sends itself as an address (a search) */
  start?: string;
  autoComplete?: string;
  required?: boolean;
  /** a password field: a Show key at its end */
  reveal?: boolean;
  /** a code (an invite): DM Mono caps */
  mono?: boolean;
  /** the emailed six-digit code: its digits a little larger and spaced */
  code?: boolean;
  /** one short line under the field (a password's rule) */
  hint?: string;
  /** what went wrong with this field */
  error?: string;
  input?: InputHTMLAttributes<HTMLInputElement>;
};

/** A few lines of the person's own words; its question is its placeholder. */
export type AuthAreaField = { kind: "area"; name: string; label: string; value: string; onChange: (value: string) => void; max?: number };

/** Choices to pick any of, as chips under their question. */
export type AuthChoicesField = {
  kind: "choices";
  name: string;
  label: string;
  options: readonly { id: string; label: string }[];
  picked: ReadonlySet<string>;
  onToggle: (id: string) => void;
};

/** A box to tick, with its sentence. */
export type AuthCheckField = { kind: "check"; name: string; label: string; checked: boolean; onChange: (checked: boolean) => void };

/** A list of things to take (a purchase's files): each a key across the column, its detail at the far end. */
export type AuthListField = { kind: "list"; name: string; label: string; items: { label: string; detail?: string; href: string; download?: boolean }[] };

export type AuthField = AuthTextField | AuthAreaField | AuthChoicesField | AuthCheckField | AuthListField;

/** A quiet link under the keys: somewhere to go, or something to do (send the code again). */
export type AuthLink = { label: string; href: string } | { label: string; onPress: () => void; disabled?: boolean };

export interface AuthCardProps {
  subject?: AuthSubject;
  title: string;
  line?: string;
  disclosure?: DisclosureId;
  tip?: string;
  notice?: { say: string; tone?: "error" | "done" };
  another?: { key: ReactElement; or: string };
  fields?: AuthField[];
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  /** a form that sends itself as an address, to this page (a search): its fields go in the query */
  action?: string;
  keys: ReactElement[];
  links?: AuthLink[];
}

const where: Record<AppDevice, string> = { computer: "On this computer", phone: "On this phone" };

function Sentence({ parts }: { parts: readonly DisclosurePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <Fragment key={i}>{p}</Fragment>
        ) : (
          <a key={i} className={c.inline} href={p.href}>
            {p.label}
          </a>
        ),
      )}
    </>
  );
}

function Keys({ keys }: { keys: ReactElement[] }) {
  if (!keys.length) return null;
  return (
    <ActionRow halves>
      {keys.map((k, i) => (
        <Fragment key={i}>{k}</Fragment>
      ))}
    </ActionRow>
  );
}

/**
 * One field, by its kind. A field's error never takes a line of its own under the field (that pushed the keys down):
 * the field is marked (its edge in the danger ink, aria-invalid) and its words go to the card's one home for lines that
 * come and go (`said`, the notice's id).
 */
function FieldOf({ f, said }: { f: AuthField; said: string }) {
  switch (f.kind) {
    case "area":
      return <TextArea name={f.name} label={f.label} hideLabel placeholder={f.label} rows={3} value={f.value} onChange={f.onChange} areaProps={{ maxLength: f.max }} />;
    case "choices":
      return (
        <div role="group" aria-label={f.label}>
          <ChipRow label={f.label}>
            {f.options.map((o) => (
              <Chip key={o.id} pressed={f.picked.has(o.id)} onPress={() => f.onToggle(o.id)}>
                {o.label}
              </Chip>
            ))}
          </ChipRow>
        </div>
      );
    case "list":
      return (
        <ul className={c.list} aria-label={f.label}>
          {f.items.map((it) => (
            <li key={it.href}>
              <a className={`${buttonClass("outlined")} ${c.item}`} href={it.href} download={it.download || undefined}>
                <span>{it.label}</span>
                {it.detail ? <span className={c.detail}>{it.detail}</span> : null}
              </a>
            </li>
          ))}
        </ul>
      );
    case "check":
      return (
        <label className={c.tick}>
          <input type="checkbox" name={f.name} checked={f.checked} onChange={(e) => f.onChange(e.currentTarget.checked)} />
          <span>{f.label}</span>
        </label>
      );
    default:
      return (
        <Field
          name={f.name}
          label={f.label}
          hideLabel={f.show !== "label"}
          placeholder={f.show === "label" ? undefined : f.label}
          type={f.type ?? "text"}
          value={f.value}
          onChange={f.onChange}
          defaultValue={f.start}
          autoComplete={f.autoComplete}
          isRequired={f.required}
          reveal={f.reveal}
          mono={f.mono || f.code}
          inputClassName={[f.code ? c.code : null, f.error ? c.invalid : null].filter(Boolean).join(" ") || undefined}
          description={f.hint}
          validationBehavior="aria"
          inputProps={f.error ? { ...f.input, "aria-invalid": true, "aria-describedby": said } : f.input}
        />
      );
  }
}

export function AuthCard({ subject, title, line, disclosure, tip, notice, another, fields, onSubmit, action, keys, links }: AuthCardProps) {
  const id = useId();
  const saidId = `${id}-said`;
  const focus = useFocus();
  if (process.env.NODE_ENV !== "production") {
    if (!focus) console.error("AuthCard: drawn outside FocusFrame; an account card is drawn only inside it.");
    if (title.length > BUDGET.title) console.error(`AuthCard: the title "${title}" is ${title.length} characters (budget ${BUDGET.title}).`);
    if (line && line.length > BUDGET.line) console.error(`AuthCard: the line "${line}" is ${line.length} characters (budget ${BUDGET.line}).`);
    if (links && links.length > 2) console.error(`AuthCard: ${links.length} links under the keys; a card has at most two.`);
  }
  const said = disclosure ? DISCLOSURES[disclosure] : null;
  const saidTip = said && "tip" in said ? said.tip : undefined;
  const saidAt = said && "at" in said ? said.at : undefined;
  const saying = said ? (
    <p className={saidAt === "foot" ? c.foot : c.line}>
      <Sentence parts={said.say} />
      {saidTip ? <Tip say={saidTip} label="What Cassette writes" /> : null}
    </p>
  ) : null;

  // the one line that comes and goes: the form's own word first, else the first field's error
  const fieldError = fields?.find((f): f is AuthTextField => (f.kind === undefined || f.kind === "text") && !!(f as AuthTextField).error)?.error;
  const message = notice ?? (fieldError ? { say: fieldError, tone: "error" as const } : undefined);
  const home = (
    <p id={saidId} className={c.notice} data-tone={message?.tone ?? "error"} role={message?.tone === "done" ? "status" : "alert"} hidden={!message}>
      {message?.say}
    </p>
  );

  // the fields, the keys, then any list (a search's results come after the key that finds them)
  const inputs = fields?.filter((f) => f.kind !== "list") ?? [];
  const lists = fields?.filter((f) => f.kind === "list") ?? [];
  const body = (
    <>
      {inputs.map((f) => (
        <FieldOf key={f.name} f={f} said={saidId} />
      ))}
      <Keys keys={keys} />
      {home}
      {lists.map((f) => (
        <FieldOf key={f.name} f={f} said={saidId} />
      ))}
    </>
  );
  const form = fields?.length ? (
    onSubmit || action ? (
      <form className={c.form} onSubmit={onSubmit} action={action} method={action ? "get" : undefined} noValidate={!action}>
        {body}
      </form>
    ) : (
      <div className={c.form}>{body}</div>
    )
  ) : (
    <>
      <Keys keys={keys} />
      {home}
    </>
  );

  return (
    <section className={c.card} aria-labelledby={id}>
      {subject && "artist" in subject ? (
        <div className={c.artist}>
          <ArtistRows single rows={[subject.artist]} />
        </div>
      ) : subject ? (
        <div className={c.subject}>
          <GlyphTile icon={subject.device} />
          <p className={c.who}>
            <span className={c.app}>The Cassette app</span>
            <span className={c.as}>
              {subject.as ? (
                <>
                  as <span className={c.address}>{subject.as}</span>
                </>
              ) : (
                where[subject.device]
              )}
            </span>
          </p>
        </div>
      ) : null}
      <header className={c.head}>
        <h1 id={id} className={c.title}>
          {title}
        </h1>
        {line ? (
          <p className={c.line}>
            {line}
            {tip ? <Tip say={tip} /> : null}
          </p>
        ) : null}
        {saidAt === "foot" ? null : saying}
      </header>
      {another ? (
        <div className={c.another}>
          <Keys keys={[another.key]} />
          <p className={c.or}>{another.or}</p>
        </div>
      ) : null}
      {form}
      {saidAt === "foot" ? saying : null}
      {links?.length ? (
        <p className={c.links}>
          {links.map((l) =>
            "href" in l ? (
              <a key={l.label} className={c.link} href={l.href}>
                {l.label}
              </a>
            ) : (
              <button key={l.label} type="button" className={c.link} onClick={l.onPress} disabled={l.disabled}>
                {l.label}
              </button>
            ),
          )}
        </p>
      ) : null}
    </section>
  );
}

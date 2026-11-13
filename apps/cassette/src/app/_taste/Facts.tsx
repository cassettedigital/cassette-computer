/**
 * The facts in one row (P11), the same on the artist and album pages: each a small label over its value,
 * only the facts that are known, with no plate behind them (the founder, 2026-10-21: the filled boxes
 * went). The gaps between them are the only structure; on a phone the row wraps. A fact can be a way out
 * (an artist's own website, `href`): its value is the link, with the arrow leaning out, and it opens in a
 * new tab.
 */

import { Icon } from "./Icon";
import f from "./facts.module.css";

export type Fact = { k: string; v: string; href?: string };

export function Facts({ facts, className }: { facts: Fact[]; className?: string }) {
  if (facts.length === 0) return null;
  return (
    <dl className={className ? `${f.facts} ${className}` : f.facts} data-n={facts.length}>
      {facts.map((x) => (
        <div key={x.k} className={f.fact}>
          <dt>{x.k}</dt>
          <dd>
            {x.href ? (
              <a className={f.out} href={x.href} target="_blank" rel="noopener noreferrer">
                <span className={f.outText}>{x.v}</span>
                <Icon name="out" size={12} />
              </a>
            ) : (
              x.v
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

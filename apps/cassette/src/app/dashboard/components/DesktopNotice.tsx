"use client";

/**
 * DesktopNotice: what the desktop app shows in place of a page that can't show its real content there right
 * now. It needs NO database and NO cloud round-trip, so it renders at once even with the web unreachable.
 * Drawn as a settings page is (settings/_parts: the page's heading, then a short head, its line and the
 * key), on the window's own paper. It was its own paper panel, whose paper is at least a window tall, so
 * the page's name sat low in a shaded box over a gap of nothing (BUG-1101, the design audit 2026-11-22).
 *
 * Two uses, same shape:
 *
 *  - Lives on the website (creator tools, purchases, imported artists, mixtapes, the wishlist): it says so
 *    and keeps a key that opens the same page in the person's browser (as Studio's notice does,
 *    studio/StudioWebNotice.tsx), rather than leaving them to find it. `web` is the website's address for
 *    it; without one, a notice titled "on the web" opens the page's own address there.
 *      <DesktopNotice pageTitle="Purchases" cardTitle="Available on the web"
 *        body="Your purchase history lives on cassette.digital in your browser." web="/settings/purchases" />
 *
 *  - Offline: a page that DOES work over the token, shown only when the cloud read fails (no connection).
 *    It invites a reconnect and keeps a key to try again.
 *      <DesktopNotice pageTitle="Devices" cardTitle="You're offline"
 *        body="Reconnect to manage your devices." />
 */

import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Heading, KitProvider, Key, tokens as kit, type KitLinkProps } from "@discovery/cassette-kit";
import { openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import s from "@/app/settings/_parts/settings.module.css";

const KitLink = ({ href, ...rest }: KitLinkProps) => <NextLink href={href} {...rest} />;

export function DesktopNotice({
  pageTitle,
  cardTitle,
  body,
  cta,
  web,
}: {
  /** The page's own heading, so the surface still reads as that page. */
  pageTitle: string;
  /** The notice's headline. */
  cardTitle: string;
  /** One or two sentences of plain explanation. */
  body: string;
  /** Optional in-app action (e.g. a local alternative once one exists). */
  cta?: { label: string; href: string };
  /** The website's address for this page, opened in the browser by the notice's key. */
  web?: string;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const onWeb = web ?? (/on the web/i.test(cardTitle) ? pathname : null);
  return (
    <KitProvider link={KitLink}>
      {/* the kit's colours ride along, so the words read in any frame the app draws it in */}
      <div className={`${kit.kit} ${kit.follow} ${s.page}`} data-fill="">
        <header className={s.head}>
          <Heading as="h1" shout={pageTitle} tone="quiet" />
        </header>
        <section className={s.emptyWords} aria-label={cardTitle}>
          <h2 className={s.emptyHead}>{cardTitle}</h2>
          <p className={s.emptyLine}>{body}</p>
          <div className={s.emptyKeys}>
            {onWeb && (
              <Key tone="fill" onClick={() => openOutside(`${PUBLIC_SITE_URL}${onWeb}`)}>
                Open in your browser
              </Key>
            )}
            {!onWeb && (
              <Key tone="fill" onClick={() => router.refresh()}>
                Try again
              </Key>
            )}
            {cta && (
              <Key href={cta.href} tone="line">
                {cta.label}
              </Key>
            )}
          </div>
        </section>
      </div>
    </KitProvider>
  );
}

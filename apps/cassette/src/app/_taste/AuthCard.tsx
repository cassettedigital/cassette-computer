import type { ReactNode } from "react";
import { PageFrame } from "./PageFrame";
import { AuthHead } from "./AuthHead";
import a from "./auth.module.css";

/**
 * The one surface for every account page (sign in, the invite, the closed sign-up, forgotten and new
 * passwords, the email code, pairing a device): the page frame, without the masthead's account end (you
 * are on it), and one narrow column on the paper. An optional eyebrow in the label role, the title, a
 * line under it, the form, and the small print. The forms take their pieces from auth.module.css.
 * `account` keeps the masthead's account end, for a page in this column that is not itself the way in
 * (claiming an artist's page). Without a title the form draws its own head (AuthHead), for one that moves
 * through steps.
 */
export function AuthCard({
  account = false,
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  account?: boolean;
  eyebrow?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <PageFrame account={account}>
      <section className={a.shell}>
        {title ? <AuthHead eyebrow={eyebrow} title={title} subtitle={subtitle} /> : null}
        {children}
        {footer ? <div className={a.footer}>{footer}</div> : null}
      </section>
    </PageFrame>
  );
}

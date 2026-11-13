"use client";

/**
 * What the kit borrows from the app it runs in: the link (next/link on the web, a router push in the
 * desktop shell) and the picture (the app's image pipeline). The kit itself imports nothing from any
 * app, so it can move into packages/ as it is.
 */

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";

export type KitLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
type Kit = { Link: ComponentType<KitLinkProps> };

const Plain = (p: KitLinkProps) => <a {...p} />;
const Ctx = createContext<Kit>({ Link: Plain });

export function KitProvider({ link, children }: { link: ComponentType<KitLinkProps>; children: ReactNode }) {
  return <Ctx.Provider value={{ Link: link }}>{children}</Ctx.Provider>;
}

export const useKitLink = () => useContext(Ctx).Link;

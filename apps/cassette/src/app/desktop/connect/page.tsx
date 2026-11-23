import type { Metadata } from "next";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { FocusFrame } from "@/app/_taste/FocusFrame";
import { ConnectClient } from "./ConnectClient";

/**
 * /desktop/connect - the desktop app's first screen before it is signed in (lib.rs
 * default_landing opens it when the keychain holds no device token). One button opens
 * the browser to /auth/player; once the person approves there, the app stores the
 * token and starts again signed in (pairing.rs begin_pairing).
 */

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false },
};

// Read per request so a test build pointed at another cloud (bundle-macos.sh
// CASSETTE_CLOUD_BASE) pairs against that cloud, not production.
export const dynamic = "force-dynamic";

export default function DesktopConnectPage() {
  // inside the app's window ConnectClient marks the page as the app's (data-surface), and the website's chrome steps
  // aside there as it does in every app window
  return (
    <FocusFrame>
      <ConnectClient cloudBase={process.env.CASSETTE_CLOUD_BASE ?? PUBLIC_SITE_URL} />
    </FocusFrame>
  );
}

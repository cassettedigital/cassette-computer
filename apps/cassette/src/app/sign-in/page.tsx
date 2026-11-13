import { redirect } from "next/navigation";

/** Signing in, in the app: pairing this computer through the browser (the website's sign-in does the same inside the app). */
export default function SignIn() {
  redirect("/desktop/connect");
}

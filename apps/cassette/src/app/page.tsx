import { redirect } from "next/navigation";

/** The app's own front door: the desk. (The website's front page is the website's.) */
export default function Home() {
  redirect("/desk");
}

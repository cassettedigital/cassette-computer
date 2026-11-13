import { Suspense } from "react";
import { Search } from "../Search";

export const metadata = { title: "Search" };

export default function DeskSearch() {
  return (
    <Suspense>
      <Search />
    </Suspense>
  );
}

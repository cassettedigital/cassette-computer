/**
 * The search form: one field and its button at the button's height, a plain GET (to /search unless the
 * page names another, as the artist picker on /for-artists/find does) that works with no script, the
 * query kept in the field. The 404 and /search use it; the masthead's pill is its live twin, with matches
 * as you type.
 */

import { Button } from "./Button";
import f from "./searchform.module.css";

export function SearchForm({
  action = "/search",
  defaultValue,
  placeholder = "Artists, albums, or a vibe",
  label = "Search the catalog",
  minLength,
}: {
  action?: string;
  defaultValue?: string;
  placeholder?: string;
  label?: string;
  minLength?: number;
}) {
  return (
    <form action={action} method="get" role="search" className={f.find}>
      <input
        className={f.field}
        name="q"
        type="search"
        required
        minLength={minLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        enterKeyHint="search"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}

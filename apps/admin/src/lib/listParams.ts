import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";

export type Order = "asc" | "desc";

/** Rows a list asks for at a time. */
export const LIST_PAGE = 50;

export const PEOPLE_SORTS = ["name", "lastSeen", "joined", "created"] as const;
export type PeopleSort = (typeof PEOPLE_SORTS)[number];

const SEARCH_WAIT_MS = 300;

/** Names read A to Z; a date reads newest first. */
const firstOrder = (sort: string): Order => (sort === "name" ? "asc" : "desc");

/**
 * A list's sort order, kept in the URL so a list can be linked and survives
 * going back. Sorting by the same key again turns it round.
 */
export function useListSort<K extends string>(
  keys: readonly K[],
  fallback: K,
): { sort: K; order: Order; setSort: (sort: K) => void } {
  const [params, setParams] = useSearchParams();
  const asked = params.get("sort") as K | null;
  const sort = asked !== null && keys.includes(asked) ? asked : fallback;
  const askedOrder = params.get("order");
  const order =
    asked === sort && (askedOrder === "asc" || askedOrder === "desc")
      ? askedOrder
      : firstOrder(sort);
  const setSort = useCallback(
    (next: K) =>
      setParams(
        (old) => {
          const out = new URLSearchParams(old);
          out.set("sort", next);
          out.set(
            "order",
            next !== sort ? firstOrder(next) : order === "asc" ? "desc" : "asc",
          );
          return out;
        },
        { replace: true },
      ),
    [setParams, sort, order],
  );
  return { sort, order, setSort };
}

/** One URL value, or the empty string for none. */
export function useListParam(name: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (value: string) =>
      setParams(
        (old) => {
          const out = new URLSearchParams(old);
          if (value === "") out.delete(name);
          else out.set(name, value);
          return out;
        },
        { replace: true },
      ),
    [name, setParams],
  );
  return [params.get(name) ?? "", set];
}

/** What's typed in a list's search box, and what the query should use a moment later. */
export function useListSearch() {
  const [search, setSearch] = useListParam("q");
  const [text, setText] = useState(search);
  // A link can change the URL too, and the box follows it.
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    setText(search);
  }
  useEffect(() => {
    if (text === search) return;
    const timer = setTimeout(() => setSearch(text), SEARCH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [text, search, setSearch]);
  return { text, setText, search };
}

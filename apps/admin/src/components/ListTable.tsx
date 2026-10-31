import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { t } from "../i18n/ar";
import type { Order } from "../lib/listParams";

export type Column<T, K extends string> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Only name and date columns sort; a count never does (spec 2). */
  sort?: K;
};

export type Sorting<K extends string> = {
  sort: K;
  order: Order;
  setSort: (sort: K) => void;
};

type PageStatus =
  "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";

/** The box above a list. It finds names, not numbers: those stay on the search page. */
export function ListSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <label htmlFor={id} className="sr-only">
        {t.lists.searchLabel}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id={id}
        type="search"
        value={value}
        placeholder={t.lists.searchLabel}
        className="ps-8"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** The sort order as a menu, for a list with no column headers. */
export function SortSelect<K extends string>({
  options,
  sorting,
}: {
  options: { key: K; label: string }[];
  sorting: Sorting<K>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {t.lists.sortBy}
      </label>
      <select
        id={id}
        value={sorting.sort}
        onChange={(e) => sorting.setSort(e.target.value as K)}
        className="h-9 rounded-lg border bg-card px-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MoreButton({
  status,
  onMore,
}: {
  status: PageStatus;
  onMore: () => void;
}) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <Button
      variant="outline"
      className="self-center"
      disabled={status === "LoadingMore"}
      onClick={onMore}
    >
      {t.lists.more}
    </Button>
  );
}

function SortHeader<K extends string>({
  label,
  sortKey,
  sorting,
}: {
  label: string;
  sortKey: K;
  sorting: Sorting<K>;
}) {
  const active = sorting.sort === sortKey;
  const Icon = !active
    ? ChevronsUpDown
    : sorting.order === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium"
      onClick={() => sorting.setSort(sortKey)}
    >
      {label}
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
    </button>
  );
}

const ariaSort = (order: Order) =>
  order === "asc" ? ("ascending" as const) : ("descending" as const);

/**
 * One page of a server-sorted list: a table on a wide screen, cards on a
 * phone. The server pages and sorts, so this only asks it to.
 */
export function ListTable<T, K extends string>({
  rows,
  rowKey,
  columns,
  card,
  sorting,
  status,
  onMore,
  empty = t.lists.empty,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: Column<T, K>[];
  /** The row on a phone. */
  card: (row: T) => ReactNode;
  sorting?: Sorting<K>;
  status: PageStatus;
  onMore: () => void;
  empty?: string;
}) {
  const mobile = useIsMobile();
  if (status === "LoadingFirstPage") {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  const sortOptions = columns.flatMap((c) =>
    c.sort === undefined ? [] : [{ key: c.sort, label: c.header }],
  );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {rows.length === 0 && status === "Exhausted" ? (
        <p className="text-muted-foreground">{empty}</p>
      ) : mobile ? (
        <>
          {sorting && sortOptions.length > 0 && (
            <SortSelect options={sortOptions} sorting={sorting} />
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={rowKey(row)}
                className="flex flex-col gap-1.5 rounded-lg border bg-card px-4 py-3 text-sm"
              >
                {card(row)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead
                    key={c.key}
                    aria-sort={
                      sorting && c.sort === sorting.sort
                        ? ariaSort(sorting.order)
                        : undefined
                    }
                  >
                    {sorting && c.sort !== undefined ? (
                      <SortHeader
                        label={c.header}
                        sortKey={c.sort}
                        sorting={sorting}
                      />
                    ) : (
                      c.header
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>{c.cell(row)}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <MoreButton status={status} onMore={onMore} />
    </div>
  );
}

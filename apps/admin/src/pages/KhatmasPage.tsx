import { api } from "@convex/_generated/api";
import { toArabicDigits } from "@convex/lib/digits";
import { formatDate } from "@web/lib/format";
import { usePaginatedQuery } from "convex/react";
import { useId } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { ListSearch, ListTable, type Column } from "../components/ListTable";
import { PageHeader } from "../components/PageHeader";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { formatCount } from "../lib/formatNumber";
import {
  LIST_PAGE,
  useListParam,
  useListSearch,
  useListSort,
} from "../lib/listParams";

const SORTS = ["name", "created"] as const;
type Sort = (typeof SORTS)[number];
const KINDS = ["pool", "rota"] as const;
const STATUSES = ["active", "archived", "pendingJoin"] as const;

function Filter<V extends string>({
  label,
  value,
  all,
  options,
  onChange,
}: {
  label: string;
  value: V | undefined;
  all: string;
  options: [V, string][];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-lg border bg-card px-2 text-sm"
      >
        <option value="">{all}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Every khatma, with what support asks first (spec 6). */
export function KhatmasPage() {
  const adminToken = useAdminToken() ?? "";
  const sorting = useListSort(SORTS, "created");
  const { text, setText, search } = useListSearch();
  const [kindParam, setKind] = useListParam("kind");
  const [statusParam, setStatus] = useListParam("status");
  const kind = KINDS.find((k) => k === kindParam);
  const status = STATUSES.find((s) => s === statusParam);
  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(
    api.adminLists.khatmas,
    {
      adminToken,
      sort: sorting.sort,
      order: sorting.order,
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(search !== "" ? { search } : {}),
    },
    { initialNumItems: LIST_PAGE },
  );
  type Row = (typeof results)[number];

  const name = (row: Row) => (
    <Link
      to={`/khatmas/${row.khatmaId}`}
      className="font-medium text-primary underline"
    >
      {row.name ?? t.lookup.unnamed}
    </Link>
  );
  const statusBadge = (row: Row) => (
    <Badge variant={row.status === "active" ? "outline" : "secondary"}>
      {t.khatmas.statuses[row.status]}
    </Badge>
  );
  const organizer = (row: Row) =>
    row.organizer ? (
      <Link
        to={`/people/${row.organizer.personId}`}
        className="text-primary underline"
      >
        {row.organizer.displayName}
      </Link>
    ) : (
      "—"
    );
  const today = (row: Row) =>
    row.today
      ? t.khatmas.todayProgress(
          toArabicDigits(row.today.done),
          toArabicDigits(row.today.total),
        )
      : "—";

  const columns: Column<Row, Sort>[] = [
    { key: "name", header: t.lists.name, sort: "name", cell: name },
    {
      key: "kind",
      header: t.khatmas.kind,
      cell: (row) => t.khatmas.kinds[row.kind],
    },
    { key: "status", header: t.khatmas.status, cell: statusBadge },
    { key: "organizer", header: t.khatmas.organizer, cell: organizer },
    {
      key: "members",
      header: t.khatmas.members,
      cell: (row) => formatCount(row.memberCount),
    },
    { key: "today", header: t.khatmas.today, cell: today },
    {
      key: "completed",
      header: t.khatmas.completed,
      cell: (row) => formatCount(row.completed),
    },
    {
      key: "created",
      header: t.khatmas.created,
      sort: "created",
      cell: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title={t.khatmas.title} />
      <div className="flex flex-wrap items-center gap-3">
        <ListSearch value={text} onChange={setText} />
        <Filter
          label={t.khatmas.kind}
          value={kind}
          all={t.khatmas.kinds.all}
          options={KINDS.map((k) => [k, t.khatmas.kinds[k]])}
          onChange={setKind}
        />
        <Filter
          label={t.khatmas.status}
          value={status}
          all={t.khatmas.statusFilter.all}
          options={STATUSES.map((s) => [s, t.khatmas.statusFilter[s]])}
          onChange={setStatus}
        />
      </div>
      <ListTable
        rows={results}
        rowKey={(row) => row.khatmaId}
        columns={columns}
        sorting={sorting}
        status={pageStatus}
        onMore={() => loadMore(LIST_PAGE)}
        card={(row) => (
          <>
            <span className="flex flex-wrap items-center gap-2">
              {name(row)}
              {statusBadge(row)}
            </span>
            <span className="text-muted-foreground">
              {t.khatmas.kinds[row.kind]} · {t.lookup.members(row.memberCount)}
              {row.today && ` · ${t.khatmas.today}: ${today(row)}`}
            </span>
            <span>{organizer(row)}</span>
          </>
        )}
      />
    </div>
  );
}

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatDate } from "@web/lib/format";
import { usePaginatedQuery } from "convex/react";
import { useId } from "react";
import { Link } from "react-router";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ListSearch, ListTable, type Column } from "../components/ListTable";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge, type PersonStatus } from "../components/StatusBadge";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { formatCount } from "../lib/formatNumber";
import {
  LIST_PAGE,
  PEOPLE_SORTS,
  useListParam,
  useListSearch,
  useListSort,
  type PeopleSort,
} from "../lib/listParams";
import { OrganizersTab } from "./OrganizersTab";

const TABS = ["all", "organizers", "members", "noKhatma", "readers"] as const;
type Tab = (typeof TABS)[number];

const READER_SORTS = ["name", "lastReply", "created"] as const;
type ReaderSort = (typeof READER_SORTS)[number];

function Phone({ value }: { value: string }) {
  return (
    <span dir="ltr" className="block text-start text-muted-foreground">
      {value}
    </span>
  );
}

const dateOr = (ms: number, none: string) => (ms === 0 ? none : formatDate(ms));

type PersonRow = {
  personId: Id<"people">;
  displayName: string;
  phoneMasked: string;
  status: PersonStatus;
  organizesCount: number;
  memberOfCount: number;
  lastSeenAt: number;
  verifiedAt: number;
  createdAt: number;
};

function PersonName({ row }: { row: PersonRow }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Link
        to={`/people/${row.personId}`}
        className="font-medium text-primary underline"
      >
        {row.displayName}
      </Link>
      <StatusBadge status={row.status} />
    </span>
  );
}

const PERSON_COLUMNS: Column<PersonRow, PeopleSort>[] = [
  {
    key: "name",
    header: t.lists.name,
    sort: "name",
    cell: (row) => <PersonName row={row} />,
  },
  {
    key: "phone",
    header: t.people.phone,
    cell: (row) => <Phone value={row.phoneMasked} />,
  },
  {
    key: "organizes",
    header: t.people.organizes,
    cell: (row) => formatCount(row.organizesCount),
  },
  {
    key: "memberOf",
    header: t.people.memberOf,
    cell: (row) => formatCount(row.memberOfCount),
  },
  {
    key: "lastSeen",
    header: t.lookup.lastSeen,
    sort: "lastSeen",
    cell: (row) => dateOr(row.lastSeenAt, t.lookup.neverSeen),
  },
  {
    key: "joined",
    header: t.lookup.joined,
    sort: "joined",
    cell: (row) => dateOr(row.verifiedAt, "—"),
  },
  {
    key: "created",
    header: t.lists.created,
    sort: "created",
    cell: (row) => formatDate(row.createdAt),
  },
];

function PeopleList({
  tab,
  search,
}: {
  tab: Exclude<Tab, "organizers" | "readers">;
  search: string;
}) {
  const adminToken = useAdminToken() ?? "";
  const sorting = useListSort(PEOPLE_SORTS, "created");
  const { results, status, loadMore } = usePaginatedQuery(
    api.adminLists.people,
    {
      adminToken,
      sort: sorting.sort,
      order: sorting.order,
      ...(tab !== "all" ? { tab } : {}),
      ...(search !== "" ? { search } : {}),
    },
    { initialNumItems: LIST_PAGE },
  );
  return (
    <ListTable
      rows={results}
      rowKey={(row) => row.personId}
      columns={PERSON_COLUMNS}
      sorting={search === "" ? sorting : undefined}
      status={status}
      onMore={() => loadMore(LIST_PAGE)}
      card={(row) => (
        <>
          <PersonName row={row} />
          <Phone value={row.phoneMasked} />
          <span className="text-muted-foreground">
            {t.lookup.lastSeen}: {dateOr(row.lastSeenAt, t.lookup.neverSeen)}
          </span>
        </>
      )}
    />
  );
}

function BlockedList() {
  const adminToken = useAdminToken() ?? "";
  const { results, status, loadMore } = usePaginatedQuery(
    api.adminLists.blocked,
    { adminToken },
    { initialNumItems: LIST_PAGE },
  );
  type Row = (typeof results)[number];
  const who = (row: Row) =>
    row.person ? (
      <Link
        to={`/people/${row.person.personId}`}
        className="font-medium text-primary underline"
      >
        {row.person.displayName}
      </Link>
    ) : (
      <span className="text-muted-foreground">{t.people.noAccount}</span>
    );
  const columns: Column<Row, never>[] = [
    { key: "name", header: t.lists.name, cell: who },
    {
      key: "phone",
      header: t.people.phone,
      cell: (row) => <Phone value={row.phoneMasked} />,
    },
    {
      key: "at",
      header: t.people.blockedAt,
      cell: (row) => formatDate(row.at),
    },
    { key: "note", header: t.people.note, cell: (row) => row.note ?? "—" },
  ];
  return (
    <ListTable
      rows={results}
      rowKey={(row) => row.blockedId}
      columns={columns}
      status={status}
      onMore={() => loadMore(LIST_PAGE)}
      card={(row) => (
        <>
          {who(row)}
          <Phone value={row.phoneMasked} />
          {row.note && <span>{row.note}</span>}
        </>
      )}
    />
  );
}

function ReadersList({ search }: { search: string }) {
  const adminToken = useAdminToken() ?? "";
  const sorting = useListSort(READER_SORTS, "created");
  const { results, status, loadMore } = usePaginatedQuery(
    api.adminLists.readers,
    {
      adminToken,
      sort: sorting.sort,
      order: sorting.order,
      ...(search !== "" ? { search } : {}),
    },
    { initialNumItems: LIST_PAGE },
  );
  type Row = (typeof results)[number];
  const name = (row: Row) => (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{row.name}</span>
      {row.blocked && <StatusBadge status="blocked" />}
    </span>
  );
  const phone = (row: Row) => (
    <Phone value={row.phoneMasked ?? t.people.numberHidden} />
  );
  const khatmas = (row: Row) => (
    <span className="flex flex-wrap gap-x-3">
      {row.khatmas.map((k) => (
        <Link
          key={k.khatmaId}
          to={`/khatmas/${k.khatmaId}`}
          className="text-primary underline"
        >
          {k.name ?? t.lookup.unnamed}
        </Link>
      ))}
    </span>
  );
  const lastReply = (row: Row) =>
    row.lastReplyAt === null ? t.people.noReply : formatDate(row.lastReplyAt);
  const columns: Column<Row, ReaderSort>[] = [
    { key: "name", header: t.lists.name, sort: "name", cell: name },
    { key: "phone", header: t.people.phone, cell: phone },
    { key: "khatmas", header: t.people.khatmas, cell: khatmas },
    {
      key: "lastReply",
      header: t.people.lastReply,
      sort: "lastReply",
      cell: lastReply,
    },
    {
      key: "created",
      header: t.lists.created,
      sort: "created",
      cell: (row) => formatDate(row.createdAt),
    },
  ];
  return (
    <ListTable
      rows={results}
      rowKey={(row) => row.readerId}
      columns={columns}
      sorting={search === "" ? sorting : undefined}
      status={status}
      onMore={() => loadMore(LIST_PAGE)}
      card={(row) => (
        <>
          {name(row)}
          {phone(row)}
          {khatmas(row)}
          <span className="text-muted-foreground">
            {t.people.lastReply}: {lastReply(row)}
          </span>
        </>
      )}
    />
  );
}

/** Everyone who reaches support, by tab: people with an account, and WhatsApp readers (spec 6). */
export function PeoplePage() {
  const [tabParam, setTabParam] = useListParam("tab");
  const [blockedParam, setBlockedParam] = useListParam("blocked");
  const { text, setText, search } = useListSearch();
  const blockedId = useId();
  const tab: Tab = TABS.find((name) => name === tabParam) ?? "all";
  const blockedOnly = tab === "all" && blockedParam !== "";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader title={t.people.title} />
      <div className="max-w-full overflow-x-auto">
        <Tabs
          value={tab}
          onValueChange={(value) => setTabParam(value === "all" ? "" : value)}
        >
          <TabsList>
            {TABS.map((name) => (
              <TabsTrigger key={name} value={name}>
                {t.people.tabs[name]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {!blockedOnly && <ListSearch value={text} onChange={setText} />}
        {tab === "all" && (
          <div className="flex items-center gap-2 text-sm">
            <Checkbox
              id={blockedId}
              checked={blockedOnly}
              onCheckedChange={(on) => setBlockedParam(on === true ? "1" : "")}
            />
            <label htmlFor={blockedId}>{t.people.blockedOnly}</label>
          </div>
        )}
      </div>
      {blockedOnly ? (
        <BlockedList />
      ) : tab === "organizers" ? (
        <OrganizersTab search={search} />
      ) : tab === "readers" ? (
        <ReadersList search={search} />
      ) : (
        <PeopleList tab={tab} search={search} />
      )}
    </div>
  );
}

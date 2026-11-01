import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  useConvex,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { useId, useState } from "react";
import { Link } from "react-router";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { MoreButton, SortSelect } from "../components/ListTable";
import { RotaSwitch } from "../components/RotaSwitch";
import { StatusBadge, type PersonStatus } from "../components/StatusBadge";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { formatCount } from "../lib/formatNumber";
import {
  LIST_PAGE,
  PEOPLE_SORTS,
  useListSort,
  type PeopleSort,
} from "../lib/listParams";
import { opsError, withNote } from "../lib/opsError";

const SORT_OPTIONS: { key: PeopleSort; label: string }[] = [
  { key: "created", label: t.lists.created },
  { key: "name", label: t.lists.name },
  { key: "lastSeen", label: t.lookup.lastSeen },
  { key: "joined", label: t.lookup.joined },
];

type Khatma = {
  khatmaId: Id<"khatmas">;
  name: string | null;
  memberCount: number;
};

/** Someone's row: who they are, the switch, and the khatmas they organize if known. */
function PersonRow({
  personId,
  displayName,
  phone,
  rotaAllowed,
  khatmas,
  status = "active",
  away = false,
  totalMembers,
  onToggle,
}: {
  personId: Id<"people">;
  displayName: string;
  phone: string;
  rotaAllowed: boolean;
  khatmas?: Khatma[];
  status?: PersonStatus;
  away?: boolean;
  totalMembers?: number;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to={`/people/${personId}`}
              className="font-medium text-primary underline"
            >
              {displayName}
            </Link>
            <StatusBadge status={status} />
            {away && <Badge variant="secondary">{t.organizers.away}</Badge>}
          </span>
          <span
            dir="ltr"
            className="block text-start text-sm text-muted-foreground"
          >
            {phone}
          </span>
        </div>
        <RotaSwitch
          checked={rotaAllowed}
          label={`${t.ops.rotaAllowed}: ${displayName}`}
          onToggle={onToggle}
        />
      </div>
      {totalMembers !== undefined && (
        <p className="text-sm text-muted-foreground">
          {t.organizers.totalMembers(formatCount(totalMembers))}
        </p>
      )}
      {khatmas && (
        <ul className="flex flex-col gap-1 text-sm">
          {khatmas.map((k) => (
            <li key={k.khatmaId} className="flex justify-between gap-2">
              <Link
                to={`/khatmas/${k.khatmaId}`}
                className="text-primary underline"
              >
                {k.name ?? t.lookup.unnamed}
              </Link>
              <span className="shrink-0 text-muted-foreground">
                {t.lookup.members(k.memberCount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** A person found by phone, with the switch as it stands now. */
function FoundRow({
  adminToken,
  personId,
  onToggle,
}: {
  adminToken: string;
  personId: Id<"people">;
  onToggle: (name: string, allowed: boolean) => void;
}) {
  const person = useQuery(api.adminLookup.person, { adminToken, personId });
  if (!person) return null;
  return (
    <PersonRow
      personId={personId}
      displayName={person.displayName}
      phone={person.phone}
      rotaAllowed={person.rotaAllowed}
      onToggle={() => onToggle(person.displayName, person.rotaAllowed)}
    />
  );
}

/**
 * The people who organize khatmas, and the switch that lets each create
 * rotating khatmas (spec 6). The number box finds anyone else.
 */
export function OrganizersTab({ search }: { search: string }) {
  const adminToken = useAdminToken() ?? "";
  const sorting = useListSort(PEOPLE_SORTS, "created");
  const convex = useConvex();
  const setRotaAllowed = useMutation(api.adminOps.setRotaAllowed);
  const phoneId = useId();
  const { results, status, loadMore } = usePaginatedQuery(
    api.adminLists.organizers,
    {
      adminToken,
      sort: sorting.sort,
      order: sorting.order,
      ...(search !== "" ? { search } : {}),
    },
    { initialNumItems: LIST_PAGE },
  );
  const [phone, setPhone] = useState("");
  const [found, setFound] = useState<
    | null
    | { kind: "person"; personId: Id<"people"> }
    | { kind: "none" | "invalid" }
  >(null);
  const [asking, setAsking] = useState<null | {
    personId: Id<"people">;
    name: string;
    turnOn: boolean;
  }>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function find() {
    setMessage(null);
    setFound(null);
    try {
      const res = await convex.query(api.adminLookup.findPerson, {
        adminToken,
        phone,
      });
      if ("error" in res) setFound({ kind: "invalid" });
      else if (res.personId) {
        setFound({ kind: "person", personId: res.personId });
      } else setFound({ kind: "none" });
    } catch {
      setMessage(opsError("generic"));
    }
  }

  async function confirm(note: string | undefined) {
    if (!asking) return;
    const { personId, turnOn } = asking;
    setAsking(null);
    try {
      const res = await setRotaAllowed(
        withNote({ adminToken, personId, allowed: turnOn }, note),
      );
      setMessage("error" in res ? opsError(res.error) : t.ops.done);
    } catch {
      setMessage(opsError("generic"));
    }
  }

  const ask = (personId: Id<"people">, name: string, allowed: boolean) =>
    setAsking({ personId, name, turnOn: !allowed });

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/rota/new"
        className={`${buttonVariants({ variant: "outline" })} sm:self-start`}
      >
        {t.organizers.createFor}
      </Link>

      <form
        className="flex max-w-md flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label htmlFor={phoneId}>{t.organizers.searchLabel}</label>
        <Input
          id={phoneId}
          value={phone}
          inputMode="tel"
          dir="ltr"
          onChange={(e) => setPhone(e.target.value)}
        />
        <Button
          type="submit"
          className="sm:self-start"
          disabled={phone.trim() === ""}
        >
          {t.lookup.find}
        </Button>
        {found?.kind === "invalid" && (
          <p className="text-saffron-ink">{t.lookup.invalidPhone}</p>
        )}
        {found?.kind === "none" && (
          <p className="text-muted-foreground">{t.lookup.noAccount}</p>
        )}
      </form>
      {found?.kind === "person" && (
        <ul>
          <FoundRow
            adminToken={adminToken}
            personId={found.personId}
            onToggle={(name, allowed) => ask(found.personId, name, allowed)}
          />
        </ul>
      )}

      {message && <p role="status">{message}</p>}

      {search === "" && <SortSelect options={SORT_OPTIONS} sorting={sorting} />}
      {status === "Exhausted" && results.length === 0 && (
        <p className="text-muted-foreground">
          {search === "" ? t.organizers.empty : t.lists.empty}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {results.map((o) => (
          <PersonRow
            key={o.personId}
            personId={o.personId}
            displayName={o.displayName}
            phone={o.phoneMasked}
            rotaAllowed={o.rotaAllowed}
            khatmas={o.khatmas}
            status={o.status}
            away={o.away}
            totalMembers={o.totalMembers}
            onToggle={() => ask(o.personId, o.displayName, o.rotaAllowed)}
          />
        ))}
      </ul>
      <MoreButton status={status} onMore={() => loadMore(LIST_PAGE)} />

      {asking && (
        <ConfirmSheet
          title={asking.turnOn ? t.ops.rotaAllowOn : t.ops.rotaAllowOff}
          body={asking.turnOn ? t.ops.rotaAllowOnBody : t.ops.rotaAllowOffBody}
          confirmLabel={asking.turnOn ? t.ops.rotaAllowOn : t.ops.rotaAllowOff}
          onConfirm={(note) => void confirm(note)}
          onClose={() => setAsking(null)}
        >
          <p className="mb-2 font-semibold">{asking.name}</p>
        </ConfirmSheet>
      )}
    </div>
  );
}

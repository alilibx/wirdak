import { PageHeader } from "../components/PageHeader";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { formatDate } from "@web/lib/format";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { PersonEditSheet } from "../components/PersonEditSheet";
import { RotaSwitch } from "../components/RotaSwitch";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { opsError, withNote } from "../lib/opsError";

type Op = "signOutAll" | "block" | "unblock" | "rotaAllowOn" | "rotaAllowOff";

/** A person's account for an admin: never their reading (spec 8). */
export function PersonAdminPage() {
  const adminToken = useAdminToken() ?? "";
  const personId = useParams().personId as Id<"people">;
  const p = useQuery(api.adminLookup.person, { adminToken, personId });
  const signOutAll = useMutation(api.adminOps.signOutEverywhere);
  const block = useMutation(api.adminOps.blockPhone);
  const unblock = useMutation(api.adminOps.unblockPhone);
  const setRotaAllowed = useMutation(api.adminOps.setRotaAllowed);
  const update = useMutation(api.adminPeople.update);
  const rotaLabelId = useId();
  const [op, setOp] = useState<Op | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (p === undefined) return null;
  if (p === null) return <p>{t.lookup.notFound}</p>;
  const person = p;

  async function confirm(which: Op, note: string | undefined) {
    setOp(null);
    try {
      const res: object =
        which === "signOutAll"
          ? await signOutAll(withNote({ adminToken, personId }, note))
          : which === "block"
            ? await block(withNote({ adminToken, phone: person.phone }, note))
            : which === "unblock"
              ? await unblock(
                  withNote({ adminToken, phone: person.phone }, note),
                )
              : await setRotaAllowed(
                  withNote(
                    { adminToken, personId, allowed: which === "rotaAllowOn" },
                    note,
                  ),
                );
      setMessage("error" in res ? opsError(String(res.error)) : t.ops.done);
    } catch {
      setMessage(opsError("generic"));
    }
  }

  async function save(
    fields: { displayName: string; whatsappNotes: boolean },
    note: string | undefined,
  ) {
    setEditing(false);
    try {
      const res = await update(
        withNote({ adminToken, personId, ...fields }, note),
      );
      setMessage("error" in res ? opsError(res.error) : t.ops.done);
    } catch {
      setMessage(opsError("generic"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={p.displayName} />
      <p dir="ltr" className="text-start text-muted-foreground">
        {p.phone} {p.blocked && `· ${t.lookup.blocked}`}
      </p>
      <p className="text-sm text-muted-foreground">
        {t.lookup.lastSeen}:{" "}
        {p.lastSeenAt === 0 ? t.lookup.neverSeen : formatDate(p.lastSeenAt)}
      </p>

      <section>
        <h2 className="mb-2 font-semibold">{t.lookup.khatmasTitle}</h2>
        <ul className="flex flex-col gap-1">
          {p.khatmas.map((k) => (
            <li key={k.khatmaId} className="flex justify-between text-sm">
              <Link
                to={`/khatmas/${k.khatmaId}`}
                className="text-primary underline"
              >
                {k.name ?? t.lookup.unnamed}
              </Link>
              <span className="text-muted-foreground">
                {k.pending
                  ? t.rota.pending
                  : k.isOrganizer
                    ? t.lookup.organizerBadge
                    : t.lookup.statuses[k.status]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{t.lookup.devicesTitle}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {p.sessions.map((s, i) => (
            <li key={i} className="flex justify-between">
              <span>{s.deviceLabel}</span>
              <span className="text-muted-foreground">
                {formatDate(s.lastUsedAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {p.helpRequests.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t.lookup.helpTitle}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {p.helpRequests.map((r) => (
              <li key={r.requestId} className="flex justify-between">
                <Link
                  to={`/help/${r.requestId}`}
                  className="text-primary underline"
                >
                  {formatDate(r.lastMessageAt)}
                </Link>
                <span className="text-muted-foreground">
                  {t.lookup.helpStatuses[r.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <span id={rotaLabelId}>{t.ops.rotaAllowed}</span>
        <RotaSwitch
          checked={p.rotaAllowed}
          labelledBy={rotaLabelId}
          onToggle={() => setOp(p.rotaAllowed ? "rotaAllowOff" : "rotaAllowOn")}
        />
      </section>

      {message && <p role="status">{message}</p>}
      <Button variant="outline" onClick={() => setEditing(true)}>
        {t.ops.editPerson}
      </Button>
      <Button variant="outline" onClick={() => setOp("signOutAll")}>
        {t.ops.signOutAll}
      </Button>
      <Button
        variant="outline"
        onClick={() => setOp(p.blocked ? "unblock" : "block")}
      >
        {p.blocked ? t.ops.unblock : t.ops.block}
      </Button>

      {editing && (
        <PersonEditSheet
          person={p}
          onSave={(fields, note) => void save(fields, note)}
          onClose={() => setEditing(false)}
        />
      )}
      {op && (
        <ConfirmSheet
          title={t.ops[op]}
          body={t.ops[`${op}Body`]}
          confirmLabel={t.ops[op]}
          onConfirm={(note) => void confirm(op, note)}
          onClose={() => setOp(null)}
        />
      )}
    </div>
  );
}

import { PageHeader } from "../components/PageHeader";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { t as webT } from "@web/i18n/ar";
import { formatIsoDate } from "@web/features/rota/format";
import { formatDate } from "@web/lib/format";
import { useAction, useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmSheet } from "../components/ConfirmSheet";
import { DetailList } from "../components/DetailList";
import { KhatmaEditSheet } from "../components/KhatmaEditSheet";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { formatCount } from "../lib/formatNumber";
import { formatReadingDays } from "../lib/formatReadingDays";
import { opsError, withNote } from "../lib/opsError";

type Sheet = "reset" | "handOver" | "edit" | "archive" | "restore" | "delete";

type MemberOp = {
  op: "removeMember" | "unblockMember";
  memberId: Id<"members">;
};

/** A khatma for an admin who's helping it: counts, never who reads what (spec 8). */
export function KhatmaAdminPage() {
  const adminToken = useAdminToken() ?? "";
  const khatmaId = useParams().khatmaId as Id<"khatmas">;
  const k = useQuery(api.adminLookup.khatma, { adminToken, khatmaId });
  const reset = useAction(api.adminOps.resetInvite);
  const handOver = useMutation(api.adminOps.handOver);
  const update = useMutation(api.adminKhatmas.update);
  const archive = useMutation(api.adminKhatmas.archive);
  const restore = useMutation(api.adminKhatmas.restore);
  const remove = useMutation(api.adminKhatmas.remove);
  const removeMember = useMutation(api.adminKhatmas.removeMember);
  const unblockMember = useMutation(api.adminKhatmas.unblockMember);
  const navigate = useNavigate();
  const pickId = useId();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [memberOp, setMemberOp] = useState<MemberOp | null>(null);
  const [pick, setPick] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Deleted from here: the query is about to turn null, and that isn't "not found".
  if (deleting || k === undefined) return null;
  if (k === null) return <p>{t.lookup.notFound}</p>;

  const candidates = k.members.filter(
    (m) => m.status === "active" && m.personId !== k.organizer?.personId,
  );

  const joinLink = k.rota?.joinLink;

  async function copyJoinLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setMessage(t.rota.copied);
    } catch {
      setMessage(opsError("generic"));
    }
  }

  async function run(call: () => Promise<object>) {
    setSheet(null);
    setMemberOp(null);
    try {
      const res = await call();
      setMessage("error" in res ? opsError(String(res.error)) : t.ops.done);
    } catch {
      setMessage(opsError("generic"));
    }
  }

  async function deleteKhatma(note: string | undefined) {
    setSheet(null);
    setDeleting(true);
    try {
      const res = await remove(withNote({ adminToken, khatmaId }, note));
      if ("error" in res) {
        setDeleting(false);
        setMessage(opsError(res.error));
      } else {
        void navigate("/khatmas");
      }
    } catch {
      setDeleting(false);
      setMessage(opsError("generic"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={k.name ?? t.lookup.unnamed} />
      <DetailList
        rows={[
          [
            t.lookup.organizer,
            k.organizer ? (
              <Link
                to={`/people/${k.organizer.personId}`}
                className="text-primary underline"
              >
                {k.organizer.displayName}
              </Link>
            ) : (
              "—"
            ),
          ],
          ...(k.rota
            ? []
            : ([[t.lookup.schedule, webT.schedules[k.schedule]]] as [
                string,
                string,
              ][])),
          [
            t.help.khatma,
            <span dir="ltr" className="block text-start">
              {k.inviteCode}
            </span>,
          ],
          [t.lookup.openHelp, formatCount(k.openHelpRequests)],
        ]}
      />
      {!k.rota && k.archived && (
        <p className="text-muted-foreground">{t.lookup.rotaArchived}</p>
      )}

      {k.rota && (
        <section className="rounded-lg border bg-card px-4 py-3">
          <DetailList
            rows={[
              [t.lookup.kind, t.lookup.kindRota],
              [t.lookup.readingDays, formatReadingDays(k.rota.days)],
              [t.lookup.startsOn, formatIsoDate(k.rota.firstDate)],
              [
                t.lookup.endsOn,
                k.rota.endDate
                  ? formatIsoDate(k.rota.endDate)
                  : webT.rota.noEnd,
              ],
            ]}
          />
          {k.rota.number !== null && k.rota.cycle !== null ? (
            <p className="mt-2 font-semibold">
              {t.lookup.rotaNumber(
                formatCount(k.rota.number),
                formatCount(k.rota.cycle),
              )}
            </p>
          ) : (
            <p className="mt-2 text-muted-foreground">{t.lookup.rotaNoDay}</p>
          )}
          {k.rota.dayOpen && (
            <p className="text-2xl font-semibold">
              {t.lookup.rotaProgress(
                formatCount(k.rota.doneToday),
                formatCount(k.rota.total),
              )}
            </p>
          )}
          {k.rota.archivedAt !== null ? (
            <p className="text-muted-foreground">{t.lookup.rotaArchived}</p>
          ) : (
            k.rota.pausedAt !== null && (
              <p className="text-muted-foreground">{t.lookup.rotaPaused}</p>
            )
          )}
          {k.rota.pendingOrganizer && (
            <p className="mt-2 font-semibold text-saffron-ink">
              {t.rota.pending}
            </p>
          )}
          <div className="mt-3 grid gap-2">
            <Link
              to={`/khatmas/${khatmaId}/rota`}
              className={`${buttonVariants()} sm:self-start`}
            >
              {t.rota.help}
            </Link>
            {joinLink && (
              <Button
                variant="outline"
                onClick={() => void copyJoinLink(joinLink)}
              >
                {t.rota.copy}
              </Button>
            )}
          </div>
        </section>
      )}

      {k.round && (
        <section className="rounded-lg border bg-card px-4 py-3">
          <h2 className="mb-2 font-semibold">
            {t.lookup.roundTitle(formatCount(k.round.number))}
          </h2>
          <div className="grid grid-cols-3 text-center">
            {(["free", "taken", "finished"] as const).map((key) => (
              <div key={key}>
                <p className="text-2xl font-semibold">
                  {formatCount(k.round![key])}
                </p>
                <p className="text-xs text-muted-foreground">{t.lookup[key]}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">{t.lookup.membersTitle}</h2>
        <ul className="flex flex-col gap-1">
          {k.members.map((m) => (
            <li
              key={m.memberId}
              className="flex flex-wrap items-center justify-between gap-x-3 text-sm"
            >
              <Link
                to={`/people/${m.personId}`}
                className="text-primary underline"
              >
                {m.displayName}
              </Link>
              <span className="text-muted-foreground">
                {t.lookup.statuses[m.status]} · {formatDate(m.joinedAt)}
              </span>
              {!k.rota &&
                !k.archived &&
                m.personId !== k.organizer?.personId &&
                m.status === "active" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setMemberOp({ op: "removeMember", memberId: m.memberId })
                    }
                  >
                    {t.ops.removeMemberOf(m.displayName)}
                  </Button>
                )}
              {!k.rota && !k.archived && m.status === "blocked" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setMemberOp({ op: "unblockMember", memberId: m.memberId })
                  }
                >
                  {t.ops.unblockMemberOf(m.displayName)}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {message && <p role="status">{message}</p>}
      {!k.rota && !k.archived && (
        <Button variant="outline" onClick={() => setSheet("edit")}>
          {t.ops.editKhatma}
        </Button>
      )}
      <Button variant="outline" onClick={() => setSheet("reset")}>
        {t.ops.resetInvite}
      </Button>
      {candidates.length > 0 && (
        <Button variant="outline" onClick={() => setSheet("handOver")}>
          {t.ops.handOver}
        </Button>
      )}
      {!k.archived && (
        <Button variant="outline" onClick={() => setSheet("archive")}>
          {t.ops.archive}
        </Button>
      )}
      {k.archived && !k.rota && (
        <Button variant="outline" onClick={() => setSheet("restore")}>
          {t.ops.restore}
        </Button>
      )}
      {k.archived && (
        <Button variant="destructive" onClick={() => setSheet("delete")}>
          {t.ops.deleteKhatma}
        </Button>
      )}

      {sheet === "edit" && (
        <KhatmaEditSheet
          khatma={k}
          onSave={({ name, schedule, grace }, note) =>
            void run(() =>
              update(
                withNote({ adminToken, khatmaId, name, schedule, grace }, note),
              ),
            )
          }
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet === "archive" || sheet === "restore") && (
        <ConfirmSheet
          title={t.ops[sheet]}
          body={t.ops[`${sheet}Body`]}
          confirmLabel={t.ops[sheet]}
          onConfirm={(note) =>
            void run(() =>
              (sheet === "archive" ? archive : restore)(
                withNote({ adminToken, khatmaId }, note),
              ),
            )
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "delete" && (
        <ConfirmSheet
          title={t.ops.deleteKhatma}
          body={t.ops.deleteKhatmaBody}
          confirmLabel={t.ops.deleteKhatma}
          onConfirm={(note) => void deleteKhatma(note)}
          onClose={() => setSheet(null)}
        />
      )}
      {memberOp && (
        <ConfirmSheet
          title={t.ops[memberOp.op]}
          body={t.ops[`${memberOp.op}Body`]}
          confirmLabel={t.ops[memberOp.op]}
          onConfirm={(note) =>
            void run(() =>
              (memberOp.op === "removeMember" ? removeMember : unblockMember)(
                withNote(
                  { adminToken, khatmaId, memberId: memberOp.memberId },
                  note,
                ),
              ),
            )
          }
          onClose={() => setMemberOp(null)}
        />
      )}
      {sheet === "reset" && (
        <ConfirmSheet
          title={t.ops.resetInvite}
          body={t.ops.resetInviteBody}
          confirmLabel={t.ops.resetInvite}
          onConfirm={(note) =>
            void run(() => reset(withNote({ adminToken, khatmaId }, note)))
          }
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "handOver" && (
        <ConfirmSheet
          title={t.ops.handOver}
          body={t.ops.handOverBody}
          confirmLabel={t.ops.handOver}
          disabled={pick === ""}
          onConfirm={(note) =>
            void run(() =>
              handOver(
                withNote(
                  { adminToken, khatmaId, memberId: pick as Id<"members"> },
                  note,
                ),
              ),
            )
          }
          onClose={() => setSheet(null)}
        >
          <label htmlFor={pickId} className="block text-sm">
            {t.ops.pickMember}
          </label>
          <select
            id={pickId}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="mt-1 w-full rounded-lg border bg-card p-2"
          >
            <option value="" />
            {candidates.map((m) => (
              <option key={m.memberId} value={m.memberId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </ConfirmSheet>
      )}
    </div>
  );
}

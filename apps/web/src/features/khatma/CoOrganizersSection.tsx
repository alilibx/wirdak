import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useId, useState } from "react";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { SwitchRow } from "../../components/SwitchRow";
import { t } from "../../i18n/ar";
import { useRotaBackend, type RotaBackend } from "../rota/backend";
import { ErrorLine } from "../rota/ErrorLine";
import { useRotaCall } from "../rota/useRotaCall";

type Switches = { readings: boolean; people: boolean; settings: boolean };
type CoOrganizer = Switches & {
  coOrganizerId: Id<"coOrganizers">;
  name: string;
  pending: boolean;
};

const SWITCHES = ["readings", "people", "settings"] as const;
const coOrganizerErrors = t.coOrganizers.errors;

/** «القراءة والمشاركون», or «بلا صلاحيات» when every switch is off. */
function permissionWords(switches: Switches): string {
  return t.coOrganizers.permissions(
    SWITCHES.filter((key) => switches[key]).map(
      (key) => t.coOrganizers.switches[key],
    ),
  );
}

/** The three switches, each a real switch, under one heading. */
function SwitchesField({
  value,
  disabled,
  onChange,
}: {
  value: Switches;
  disabled: boolean;
  onChange: (next: Switches) => void;
}) {
  const legendId = useId();
  return (
    <div role="group" aria-labelledby={legendId} className="mt-5">
      <h3 id={legendId} className="font-medium">
        {t.coOrganizers.switchesLegend}
      </h3>
      {SWITCHES.map((key) => (
        <SwitchRow
          key={key}
          label={t.coOrganizers.switches[key]}
          on={value[key]}
          disabled={disabled}
          onChange={(on) => onChange({ ...value, [key]: on })}
        />
      ))}
    </div>
  );
}

/** Picks someone to name, with the switches preset to the admin's defaults. */
function AddSheet({
  fns,
  candidates,
  defaults,
  onClose,
}: {
  fns: Fns;
  candidates: { candidateId: string; name: string }[];
  defaults: Switches;
  onClose: () => void;
}) {
  const set = useMutation(fns.set);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [switches, setSwitches] = useState<Switches>(defaults);
  const { busy, error, run } = useRotaCall(coOrganizerErrors);
  const pickId = useId();
  return (
    <Sheet title={t.coOrganizers.add} onClose={onClose}>
      {candidates.length === 0 ? (
        <p className="leading-relaxed text-ink-soft">
          {t.coOrganizers.noCandidates}
        </p>
      ) : (
        <>
          <fieldset aria-labelledby={pickId} className="min-w-0">
            <h3 id={pickId} className="font-medium">
              {t.coOrganizers.pick}
            </h3>
            <div className="mt-2 grid gap-2">
              {candidates.map((candidate) => (
                <label
                  key={candidate.candidateId}
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-ui border-2 border-line bg-card px-4 py-3 has-[:checked]:border-green has-[:checked]:bg-chosen has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green"
                >
                  <input
                    type="radio"
                    name="co-organizer-candidate"
                    value={candidate.candidateId}
                    checked={candidateId === candidate.candidateId}
                    onChange={() => setCandidateId(candidate.candidateId)}
                    className="size-5 shrink-0 accent-green"
                  />
                  <span className="font-medium">{candidate.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <SwitchesField
            value={switches}
            disabled={busy}
            onChange={setSwitches}
          />
          <div className="mt-5">
            <Button
              disabled={busy || candidateId === null}
              onClick={() =>
                candidateId !== null &&
                void run(
                  () => set({ ...fns.authArgs(), candidateId, ...switches }),
                  onClose,
                )
              }
            >
              {t.coOrganizers.save}
            </Button>
          </div>
        </>
      )}
      <ErrorLine error={error} />
    </Sheet>
  );
}

/** One co-organizer's switches, to change, and the way to take the role away. */
function EditSheet({
  fns,
  coOrganizer,
  onClose,
}: {
  fns: Fns;
  coOrganizer: CoOrganizer;
  onClose: () => void;
}) {
  const set = useMutation(fns.set);
  const remove = useMutation(fns.remove);
  const [switches, setSwitches] = useState<Switches>({
    readings: coOrganizer.readings,
    people: coOrganizer.people,
    settings: coOrganizer.settings,
  });
  const { busy, error, run } = useRotaCall(coOrganizerErrors);
  const changed = SWITCHES.some((key) => switches[key] !== coOrganizer[key]);
  const { coOrganizerId } = coOrganizer;
  return (
    <Sheet title={coOrganizer.name} onClose={onClose}>
      {coOrganizer.pending && (
        <p className="text-ink-soft">{t.coOrganizers.pending}</p>
      )}
      <SwitchesField value={switches} disabled={busy} onChange={setSwitches} />
      <div className="mt-5 grid gap-3">
        <Button
          disabled={busy || !changed}
          onClick={() =>
            void run(
              () => set({ ...fns.authArgs(), coOrganizerId, ...switches }),
              onClose,
            )
          }
        >
          {t.coOrganizers.save}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(
              () => remove({ ...fns.authArgs(), coOrganizerId }),
              onClose,
            )
          }
        >
          {t.coOrganizers.remove}
        </Button>
      </div>
      <ErrorLine error={error} />
    </Sheet>
  );
}

type Open =
  { kind: "add" } | { kind: "edit"; coOrganizerId: Id<"coOrganizers"> };

/** The co-organizer functions of a backend that has them, and how to call them. */
type Fns = {
  list: NonNullable<RotaBackend["coOrganizers"]>;
  set: NonNullable<RotaBackend["setCoOrganizer"]>;
  remove: NonNullable<RotaBackend["removeCoOrganizer"]>;
  scope: RotaBackend["scope"];
  authArgs: RotaBackend["authArgs"];
};

/**
 * The owner's «المنظّمون المساعدون» in a khatma's settings: who helps run it and with which
 * switches, a way to name someone, and a sheet per co-organizer. Shows nothing on a backend
 * without it (an admin has the admin's own card), nothing to anyone the list refuses, and
 * nothing while the feature is off unless someone still holds the role.
 */
export function CoOrganizersSection({ inviteCode }: { inviteCode: string }) {
  const backend = useRotaBackend(inviteCode);
  const { coOrganizers: list, setCoOrganizer: set } = backend;
  const remove = backend.removeCoOrganizer;
  if (!list || !set || !remove) return null;
  return (
    <CoOrganizersList
      fns={{
        list,
        set,
        remove,
        scope: backend.scope,
        authArgs: backend.authArgs,
      }}
    />
  );
}

function CoOrganizersList({ fns }: { fns: Fns }) {
  const view = useQuery(fns.list, fns.scope);
  const [open, setOpen] = useState<Open | null>(null);

  if (!view || "forbidden" in view) return null;
  // With the feature off, the section stays only while someone still holds the role (spec 6).
  if (!view.enabled && view.coOrganizers.length === 0) return null;

  const full = view.coOrganizers.length >= view.max;
  const editing =
    open?.kind === "edit"
      ? view.coOrganizers.find((c) => c.coOrganizerId === open.coOrganizerId)
      : undefined;

  return (
    <section aria-label={t.coOrganizers.heading} className="mt-8">
      <h2 className="mb-3 text-xl font-semibold">{t.coOrganizers.heading}</h2>
      <p className="leading-relaxed text-ink-soft">{t.coOrganizers.hint}</p>
      {view.coOrganizers.length === 0 ? (
        <p className="mt-3 text-ink-soft">{t.coOrganizers.none}</p>
      ) : (
        <ul className="mt-3 grid gap-3">
          {view.coOrganizers.map((coOrganizer) => (
            <li key={coOrganizer.coOrganizerId}>
              <button
                type="button"
                onClick={() =>
                  setOpen({
                    kind: "edit",
                    coOrganizerId: coOrganizer.coOrganizerId,
                  })
                }
                className="min-h-14 w-full rounded-ui border-2 border-line bg-card px-4 py-3 text-start"
              >
                <span className="block font-medium">{coOrganizer.name}</span>
                <span className="block text-base text-ink-soft">
                  {permissionWords(coOrganizer)}
                </span>
                {coOrganizer.pending && (
                  <span className="mt-1 inline-block rounded-full bg-paper-2 px-3 py-0.5 text-base text-ink-soft">
                    {t.coOrganizers.pending}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.enabled &&
        (full ? (
          <p className="mt-3 text-ink-soft">{t.coOrganizers.full}</p>
        ) : (
          <div className="mt-4">
            <Button variant="ghost" onClick={() => setOpen({ kind: "add" })}>
              {t.coOrganizers.add}
            </Button>
          </div>
        ))}

      {open?.kind === "add" && (
        <AddSheet
          fns={fns}
          candidates={view.candidates}
          defaults={view.defaults}
          onClose={() => setOpen(null)}
        />
      )}
      {editing && (
        <EditSheet
          fns={fns}
          coOrganizer={editing}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

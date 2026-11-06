import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import posthog from "posthog-js";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "../../components/Button";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { type RotaBackend, useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { useRotaCall } from "./useRotaCall";

const transferErrors: Record<string, string> = t.organizer.errors;

type Candidate = {
  id: Id<"rotaParticipants">;
  name: string;
  hasAccount: boolean;
};

/**
 * The owner hands a rotating khatma to one of its participants (co-organizers spec 4.5): anyone
 * live in it but the owner, by name only. One without a Wirdak account is listed but can't be
 * picked (the server refuses it as `no_account`), since ownership can't wait for a sign-in. Shows
 * nothing on a backend without it (an admin transfers from the admin's own khatma card).
 */
export function TransferSection({ inviteCode }: { inviteCode: string }) {
  const backend = useRotaBackend(inviteCode);
  const { handOver } = backend;
  if (!handOver) return null;
  return (
    <TransferList
      inviteCode={inviteCode}
      backend={backend}
      handOver={handOver}
    />
  );
}

function TransferList({
  inviteCode,
  backend,
  handOver,
}: {
  inviteCode: string;
  backend: RotaBackend;
  handOver: NonNullable<RotaBackend["handOver"]>;
}) {
  const navigate = useNavigate();
  const people = useQuery(backend.people, backend.scope);
  const transfer = useMutation(handOver);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const { busy, error, run } = useRotaCall(transferErrors);

  if (!people) return null;
  const candidates: Candidate[] = people.participants
    .filter((p) => !p.isOrganizer)
    .map((p) => ({ id: p.id, name: p.name, hasAccount: p.hasAccount }));
  if (candidates.length === 0) return null;

  const confirm = (candidate: Candidate) => {
    setPicked(null);
    return run(
      async () => {
        const result = await transfer({
          ...backend.authArgs(),
          participantId: candidate.id,
        });
        return result.ok ? { ok: true } : { error: result.reason };
      },
      () => {
        posthog.capture("member_management_completed", { action: "handover" });
        void navigate(`/j/${encodeURIComponent(inviteCode)}`, {
          replace: true,
        });
      },
    );
  };

  return (
    <section aria-label={t.organizer.transfer} className="mt-8">
      <h2 className="mb-3 text-xl font-semibold">{t.organizer.transfer}</h2>
      <p className="leading-relaxed text-ink-soft">
        {t.organizer.transferHint}
      </p>
      <ul className="mt-3 grid gap-2">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              disabled={busy || !candidate.hasAccount}
              onClick={() => setPicked(candidate)}
              className="min-h-14 w-full rounded-ui border-2 border-line bg-card px-4 text-start font-medium disabled:opacity-50"
            >
              {candidate.name}
              {!candidate.hasAccount && (
                <span className="ms-2 text-sm font-normal text-ink-soft">
                  {t.coOrganizers.pending}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />

      {picked && (
        <Sheet
          title={t.organizer.transferTitle(picked.name)}
          onClose={() => setPicked(null)}
        >
          <p className="mt-1 leading-relaxed text-ink-soft">
            {t.organizer.transferBody}
          </p>
          <div className="mt-5 grid gap-3">
            <Button disabled={busy} onClick={() => void confirm(picked)}>
              {t.organizer.transferConfirm}
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              {t.organizer.cancel}
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

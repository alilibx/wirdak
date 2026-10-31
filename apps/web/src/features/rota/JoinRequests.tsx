import { toArabicDigits } from "@convex/lib/digits";
import type { PeopleView } from "@convex/lib/rotaOps";
import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { Button } from "../../components/Button";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { fieldClass } from "./fieldClass";
import { useRotaCall } from "./useRotaCall";

type Request = PeopleView["requests"][number];

/** One number that sent the join code: give it a juz' of the next khatma, or say no. */
function JoinRequestCard({
  inviteCode,
  request,
  freeJuz,
}: {
  inviteCode: string;
  request: Request;
  freeJuz: number[];
}) {
  const backend = useRotaBackend(inviteCode);
  const accept = useMutation(backend.acceptJoinRequest);
  const decline = useMutation(backend.declineJoinRequest);
  const { busy, error, run } = useRotaCall(t.rota.joinRequestErrors);
  const nameId = useId();
  const selectId = useId();
  const [name, setName] = useState(request.name ?? "");
  const [chosen, setChosen] = useState<number | null>(null);
  // The juz' may be taken while the card is open: fall back to the first free one.
  const juz = chosen !== null && freeJuz.includes(chosen) ? chosen : freeJuz[0];
  const args = backend.authArgs();
  // Left as it came, the server cleans WhatsApp's name itself, or gives its usual one.
  const nameArg =
    name.trim() === (request.name ?? "") ? {} : { name: name.trim() };

  return (
    <li className="rounded-ui border-2 border-gold bg-[#FBF1D9] p-4">
      <p className="font-medium">
        {t.rota.requestLine(request.name, request.phoneMasked)}
      </p>
      {juz === undefined ? (
        <p className="mt-2 text-ink-soft">{t.rota.addErrors.no_free_juz}</p>
      ) : (
        <>
          <label htmlFor={nameId} className="mt-3 block font-medium">
            {t.rota.personName}
          </label>
          <input
            id={nameId}
            type="text"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={fieldClass}
          />
          <label htmlFor={selectId} className="mt-3 block font-medium">
            {t.rota.requestJuz}
          </label>
          <select
            id={selectId}
            value={juz}
            onChange={(event) => setChosen(Number(event.target.value))}
            className={fieldClass}
          >
            {freeJuz.map((n) => (
              <option key={n} value={n}>
                {toArabicDigits(n)}
              </option>
            ))}
          </select>
        </>
      )}
      <div className="mt-3 grid gap-3">
        <Button
          disabled={busy || juz === undefined}
          onClick={() =>
            void run(() =>
              accept({
                ...args,
                requestId: request.id,
                juz: juz ?? 0,
                ...nameArg,
              }),
            )
          }
        >
          {t.rota.acceptRequest}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(() => decline({ ...args, requestId: request.id }))
          }
        >
          {t.rota.declineRequest}
        </Button>
      </div>
      <ErrorLine error={error} />
    </li>
  );
}

/** The people who asked to join with the khatma's link, above the list; nothing while none waits. */
export function JoinRequests({
  inviteCode,
  view,
}: {
  inviteCode: string;
  view: PeopleView;
}) {
  const headingId = useId();
  if (view.requests.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className="text-xl font-semibold">
        {t.rota.requestsHeading}
      </h2>
      <ul className="mt-2 grid gap-3">
        {view.requests.map((request) => (
          <JoinRequestCard
            key={request.id}
            inviteCode={inviteCode}
            request={request}
            freeJuz={view.freeJuz}
          />
        ))}
      </ul>
    </section>
  );
}

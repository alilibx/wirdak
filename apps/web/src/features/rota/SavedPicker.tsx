import { useMutation, useQuery } from "convex/react";
import { Sheet } from "../../components/Sheet";
import { t } from "../../i18n/ar";
import { useRotaBackend } from "./backend";
import { ErrorLine } from "./ErrorLine";
import { useAddCall } from "./useAddCall";

const savedErrors: Record<string, string> = t.rota.savedErrors;

/**
 * The people the organizer added to earlier khatmas, by name. Pressing one adds them to this
 * khatma: to `juz` when given, else to the first juz' nobody reads. Those already in the khatma
 * can't be pressed. Pool members never show a number, since the organizer never saw it.
 *
 * With `juz` the picker closes once someone is added; without it, it stays open so several people
 * can be added in a row. `onAdded` runs after each one.
 */
export function SavedPicker({
  inviteCode,
  juz,
  onClose,
  onStart,
  onAdded,
}: {
  inviteCode: string;
  juz?: number;
  onClose: () => void;
  /** Called when a person is pressed, before the call. */
  onStart?: () => void;
  onAdded?: () => void;
}) {
  const backend = useRotaBackend(inviteCode);
  const saved = useQuery(backend.saved, backend.scope);
  const addSaved = useMutation(backend.addSaved);
  const { busy, error, add: addCall, question } = useAddCall(savedErrors);

  const add = (contactId: NonNullable<typeof saved>[number]["id"]) => {
    onStart?.();
    return addCall(
      (today) =>
        addSaved({
          ...backend.authArgs(),
          contactId,
          ...(juz === undefined ? {} : { juz }),
          ...today,
        }),
      () => {
        if (juz !== undefined) onClose();
        onAdded?.();
      },
    );
  };

  return (
    <Sheet title={t.rota.savedTitle} onClose={onClose}>
      <p className="text-ink-soft">{t.rota.savedHint}</p>
      <ul aria-label={t.rota.savedTitle} className="mt-3 grid gap-2">
        {(saved ?? []).map((contact) => (
          <li key={contact.id}>
            <button
              type="button"
              disabled={busy || contact.inKhatma || question !== null}
              onClick={() => void add(contact.id)}
              className="flex min-h-14 w-full items-center justify-between gap-3 rounded-ui border-2 border-line bg-card px-4 py-2 text-start disabled:opacity-50"
            >
              <span className="font-medium">{contact.name}</span>
              {contact.inKhatma ? (
                <span className="text-base text-ink-soft">
                  {t.rota.savedInKhatma}
                </span>
              ) : (
                contact.phone !== null && (
                  <span dir="ltr" className="text-base text-ink-soft">
                    {contact.phone}
                  </span>
                )
              )}
            </button>
          </li>
        ))}
      </ul>
      <ErrorLine error={error} />
      {question}
    </Sheet>
  );
}

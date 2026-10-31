import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReference } from "convex/server";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getSessionToken, useSessionToken } from "../../lib/session";

/** Who is asking, and about which khatma: what every call of a rota screen starts with. */
export type RotaScope =
  | { sessionToken?: string; inviteCode: string }
  | { adminToken: string; khatmaId: Id<"khatmas"> };

const organizerFunctions = {
  today: api.rota.today,
  people: api.rota.people,
  settings: api.rota.settings,
  saved: api.rota.saved,
  importable: api.rota.importable,
  finishSetup: api.rota.finishSetup,
  addParticipant: api.rota.addParticipant,
  giveJuz: api.rota.giveJuz,
  moveJuz: api.rota.moveJuz,
  freeJuz: api.rota.freeJuz,
  renameParticipant: api.rota.renameParticipant,
  removeParticipant: api.rota.removeParticipant,
  addSaved: api.rota.addSaved,
  importMembers: api.rota.importMembers,
  ensureJoinLink: api.rota.ensureJoinLink,
  acceptJoinRequest: api.rota.acceptJoinRequest,
  declineJoinRequest: api.rota.declineJoinRequest,
  reassign: api.rota.reassign,
  markDone: api.rota.markDone,
  markNotDone: api.rota.markNotDone,
  update: api.rota.update,
  setPaused: api.rota.setPaused,
  addPauseDate: api.rota.addPauseDate,
  removePauseDate: api.rota.removePauseDate,
  startAgain: api.rota.startAgain,
  archive: api.khatmaLifecycle.archive,
  remove: api.khatmaLifecycle.remove,
};

/** The same function, taking a `RotaScope` where the organizer's takes its token and invite code. */
type Scoped<Fn> =
  Fn extends FunctionReference<infer Type, "public", infer Args, infer Result>
    ? FunctionReference<
        Type,
        "public",
        RotaScope & Omit<Args, "sessionToken" | "inviteCode">,
        Result
      >
    : never;

/** What only an organizer does: a screen hides it for a backend that doesn't have it. */
type OrganizerOnly = "importable" | "importMembers" | "startAgain";

/** The functions behind the rota screens, and the scope they are called with. */
export type RotaBackend = {
  [Name in Exclude<keyof typeof organizerFunctions, OrganizerOnly>]: Scoped<
    (typeof organizerFunctions)[Name]
  >;
} & {
  [Name in OrganizerOnly]?: Scoped<(typeof organizerFunctions)[Name]>;
} & {
  /** For queries: follows the session as the screen renders. */
  scope: RotaScope;
  /** For mutations and actions: read as the call goes out. */
  authArgs: () => RotaScope;
};

const RotaBackendContext = createContext<RotaBackend | null>(null);

/** Runs the rota screens inside it on `backend` instead of the organizer's functions. */
export function RotaBackendProvider({
  backend,
  children,
}: {
  backend: RotaBackend;
  children: ReactNode;
}) {
  return (
    <RotaBackendContext.Provider value={backend}>
      {children}
    </RotaBackendContext.Provider>
  );
}

/**
 * What a rota screen calls. Without a provider, that is the signed-in organizer's own functions
 * for the khatma behind `inviteCode`.
 */
export function useRotaBackend(inviteCode: string): RotaBackend {
  const provided = useContext(RotaBackendContext);
  const sessionToken = useSessionToken();
  return useMemo(
    () =>
      provided ?? {
        ...organizerFunctions,
        scope: { sessionToken, inviteCode },
        authArgs: () => ({
          sessionToken: getSessionToken() ?? undefined,
          inviteCode,
        }),
      },
    [provided, sessionToken, inviteCode],
  );
}

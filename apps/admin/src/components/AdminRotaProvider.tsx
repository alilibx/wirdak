import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  RotaBackendProvider,
  type RotaBackend,
} from "@web/features/rota/backend";
import { useMemo, type ReactNode } from "react";
import { getAdminToken, useAdminToken } from "../lib/adminSession";

const adminFunctions = {
  today: api.adminRota.today,
  people: api.adminRota.people,
  settings: api.adminRota.settings,
  saved: api.adminRota.saved,
  finishSetup: api.adminRota.finishSetup,
  addParticipant: api.adminRota.addParticipant,
  giveJuz: api.adminRota.giveJuz,
  moveJuz: api.adminRota.moveJuz,
  freeJuz: api.adminRota.freeJuz,
  renameParticipant: api.adminRota.renameParticipant,
  removeParticipant: api.adminRota.removeParticipant,
  addSaved: api.adminRota.addSaved,
  ensureJoinLink: api.adminRota.ensureJoinLink,
  acceptJoinRequest: api.adminRota.acceptJoinRequest,
  declineJoinRequest: api.adminRota.declineJoinRequest,
  reassign: api.adminRota.reassign,
  markDone: api.adminRota.markDone,
  markNotDone: api.adminRota.markNotDone,
  update: api.adminRota.update,
  setPaused: api.adminRota.setPaused,
  addPauseDate: api.adminRota.addPauseDate,
  removePauseDate: api.adminRota.removePauseDate,
  archive: api.adminRota.archive,
  remove: api.adminRota.remove,
};

/** Runs the website's rota screens inside it on an admin's functions, for one khatma. */
export function AdminRotaProvider({
  khatmaId,
  children,
}: {
  khatmaId: Id<"khatmas">;
  children: ReactNode;
}) {
  const adminToken = useAdminToken() ?? "";
  const backend = useMemo<RotaBackend>(
    () => ({
      ...adminFunctions,
      scope: { adminToken, khatmaId },
      authArgs: () => ({ adminToken: getAdminToken() ?? "", khatmaId }),
    }),
    [adminToken, khatmaId],
  );
  return (
    <RotaBackendProvider backend={backend}>{children}</RotaBackendProvider>
  );
}

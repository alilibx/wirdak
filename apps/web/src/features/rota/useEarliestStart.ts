import { api } from "@convex/_generated/api";
import { addDays } from "@convex/lib/rota";
import { useQuery } from "convex/react";

/** The first date a new rota khatma may have: tomorrow, unless an admin allows today. */
export function useEarliestStart(today: string): string {
  const settings = useQuery(api.publicSettings.get, {});
  return settings?.rotaStartNextDay === false ? today : addDays(today, 1);
}

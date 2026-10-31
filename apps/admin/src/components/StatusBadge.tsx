import { Badge } from "@/components/ui/badge";
import { t } from "../i18n/ar";

export type PersonStatus = "active" | "notJoined" | "blocked";

/** Says what's unusual about a person; someone active needs no badge. */
export function StatusBadge({ status }: { status: PersonStatus }) {
  if (status === "active") return null;
  return (
    <Badge variant={status === "blocked" ? "destructive" : "secondary"}>
      {t.people.statuses[status]}
    </Badge>
  );
}

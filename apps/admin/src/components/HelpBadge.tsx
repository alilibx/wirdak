import { api } from "@convex/_generated/api";
import { toWesternDigits } from "@convex/lib/digits";
import { useQuery } from "convex/react";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";
import { cn } from "@/lib/utils";

/** How many help requests wait, or nothing when none do. */
export function HelpBadge({ className }: { className?: string }) {
  const adminToken = useAdminToken() ?? "";
  const counts = useQuery(api.adminHelp.counts, { adminToken });
  if (!counts || counts.open === 0) return null;
  return (
    <span
      className={cn(
        "rounded-full bg-sidebar-primary px-1.5 text-[11px] leading-4 font-medium text-sidebar-primary-foreground",
        className,
      )}
    >
      {counts.open >= 100 ? t.help.manyOpen : toWesternDigits(counts.open)}
    </span>
  );
}

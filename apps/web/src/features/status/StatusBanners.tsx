import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { t } from "../../i18n/ar";
import { readStored, writeStored } from "../../lib/session";
import { reloadPage } from "./reload";
import { lastingStorage, versionGate } from "./versionGate";

const DISMISSED = "wirdak.announcementDismissed";

/**
 * The banners the admin panel controls (spec 9.2 to 9.4): maintenance, the
 * announcement, and the update bar when this page is older than required.
 */
export function StatusBanners() {
  const settings = useQuery(api.publicSettings.get, {});
  const [dismissed, setDismissed] = useState(() => readStored(DISMISSED));
  const required = settings?.minClientVersion ?? null;
  // Decided once per required version, so a re-render never reloads twice.
  const [gate, setGate] = useState<{
    required: string | null;
    result: "ok" | "reload" | "stuck";
  }>({ required: null, result: "ok" });

  useEffect(() => {
    if (settings === undefined || gate.required === required) return;
    const result = versionGate(__APP_VERSION__, required, lastingStorage);
    setGate({ required, result });
    if (result === "reload") reloadPage();
  }, [settings, required, gate.required]);

  if (settings === undefined) return null;
  const announcement =
    settings.announcement !== null && settings.announcement !== dismissed
      ? settings.announcement
      : null;
  if (
    !settings.maintenanceMode &&
    announcement === null &&
    gate.result !== "stuck"
  ) {
    return null;
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-2 px-4 pt-3">
      {settings.maintenanceMode && (
        <div
          role="status"
          className="rounded-ui bg-green-fill px-4 py-3 text-center text-sm text-on-green"
        >
          {settings.maintenanceMessage ?? t.status.maintenanceDefault}
        </div>
      )}
      {announcement !== null && (
        <div className="flex items-start gap-3 rounded-ui bg-saffron-soft px-4 py-3 text-sm text-saffron-ink">
          <p className="flex-1">{announcement}</p>
          <button
            type="button"
            className="shrink-0 font-semibold underline"
            onClick={() => {
              writeStored(DISMISSED, announcement);
              setDismissed(announcement);
            }}
          >
            {t.status.dismiss}
          </button>
        </div>
      )}
      {gate.result === "stuck" && (
        <div className="flex items-center gap-3 rounded-ui border border-line bg-card px-4 py-3 text-sm">
          <p className="flex-1">{t.status.updateNeeded}</p>
          <button
            type="button"
            className="shrink-0 rounded-full bg-green-fill px-3 py-1 font-semibold text-on-green"
            onClick={reloadPage}
          >
            {t.status.updateButton}
          </button>
        </div>
      )}
    </div>
  );
}

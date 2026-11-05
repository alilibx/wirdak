import type { Id } from "@convex/_generated/dataModel";
import type { OrganizerAccess } from "@convex/lib/organizerAuth";
import type { SettingsView, TodayView } from "@convex/lib/rotaOps";
import { KhatmaTabs } from "@web/components/KhatmaTabs";
import { ArchivedBanner } from "@web/features/khatma/ArchivedActions";
import { useDeleting } from "@web/features/khatma/deleting";
import { useRotaBackend } from "@web/features/rota/backend";
import { PeoplePanel } from "@web/features/rota/PeoplePanel";
import { TodayPanel } from "@web/features/rota/TodayPanel";
import { t as webT } from "@web/i18n/ar";
import { RotaSettingsContent } from "@web/pages/RotaSettingsPage";
import { useQuery } from "convex/react";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import { AdminRotaProvider } from "../components/AdminRotaProvider";
import { t } from "../i18n/ar";

type Tab = "today" | "people" | "settings";

const TABS = [
  { id: "today", label: webT.rota.tabs.today },
  { id: "people", label: webT.rota.tabs.people },
  { id: "settings", label: webT.khatmaSettings.link },
] as const satisfies readonly { id: Tab; label: string }[];

/** The website's screens for one rota khatma, as its organizer has them. */
function Panels({
  khatmaId,
  today,
  settings,
}: {
  khatmaId: Id<"khatmas">;
  today: TodayView;
  /** `adminRota.settings` gives the owner's access: an admin can do everything. */
  settings: SettingsView & { access: OrganizerAccess };
}) {
  const [tab, setTab] = useState<Tab>("today");
  const ids = useId();
  return (
    <>
      <KhatmaTabs tab={tab} onChange={setTab} idPrefix={ids} tabs={TABS} />
      <section
        role="tabpanel"
        id={`${ids}-panel`}
        aria-labelledby={`${ids}-tab-${tab}`}
      >
        {tab === "today" && (
          <TodayPanel
            inviteCode={khatmaId}
            view={today}
            dayAt={settings.messages.dayAt}
            timeZone={settings.timeZone}
            canStart
          />
        )}
        {tab === "people" && (
          <PeoplePanel inviteCode={khatmaId} archived={today.archived} />
        )}
        {tab === "settings" && (
          <div className="mt-6">
            <RotaSettingsContent
              settings={settings}
              inviteCode={khatmaId}
              headingLevel="h2"
            />
          </div>
        )}
      </section>
    </>
  );
}

function Help({ khatmaId }: { khatmaId: Id<"khatmas"> }) {
  const backend = useRotaBackend(khatmaId);
  const today = useQuery(backend.today, backend.scope);
  const settings = useQuery(backend.settings, backend.scope);
  const deleting = useDeleting(khatmaId);

  // Deleted from here: the queries are about to turn null, and that isn't "not found".
  if (deleting || today === undefined || settings === undefined) return null;
  if (today === null || settings === null) return <p>{t.lookup.notFound}</p>;

  return (
    <div className="flex flex-col">
      <Link
        to={`/khatmas/${khatmaId}`}
        className="inline-flex min-h-11 items-center font-medium text-green underline underline-offset-4"
      >
        {t.rota.back}
      </Link>
      <h1 className="font-display text-3xl break-words text-green-deep">
        {settings.name}
      </h1>
      <p
        role="note"
        className="mt-3 rounded-ui bg-saffron-soft px-4 py-3 font-medium text-saffron-ink"
      >
        {t.rota.helpStrip}
      </p>
      {today.archived && <ArchivedBanner />}
      <Panels khatmaId={khatmaId} today={today} settings={settings} />
    </div>
  );
}

/** An admin helping any rota khatma: its organizer's screens, every change audited. */
export function RotaHelpPage() {
  const khatmaId = useParams().khatmaId as Id<"khatmas">;
  return (
    <AdminRotaProvider khatmaId={khatmaId}>
      <Help khatmaId={khatmaId} />
    </AdminRotaProvider>
  );
}

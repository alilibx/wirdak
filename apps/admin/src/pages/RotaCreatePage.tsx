import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { RotaPeopleSetupContent } from "@web/features/rota/RotaPeopleSetup";
import { t as webT } from "@web/i18n/ar";
import { RotaCreateForm } from "@web/pages/RotaCreatePage";
import { useAction } from "convex/react";
import { useId, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AdminRotaProvider } from "../components/AdminRotaProvider";
import { t } from "../i18n/ar";
import { useAdminToken } from "../lib/adminSession";

const fieldClass =
  "mt-2 min-h-14 w-full rounded-ui border-2 border-line bg-white px-4 text-ink";

const errors: Record<string, string> = {
  ...webT.rota.errors,
  ...t.rota.errors,
};

/** A rotating khatma set up on someone's behalf: whose it is, then the website's first step. */
export function RotaCreatePage() {
  const adminToken = useAdminToken() ?? "";
  const navigate = useNavigate();
  const create = useAction(api.adminRota.create);
  const ids = useId();
  const [organizerName, setOrganizerName] = useState("");
  const [organizerPhone, setOrganizerPhone] = useState("");

  return (
    <RotaCreateForm
      errors={errors}
      create={async (details) => {
        const { khatmaId } = await create({
          adminToken,
          organizerName: organizerName.trim(),
          organizerPhone: organizerPhone.trim(),
          ...details,
        });
        void navigate(`/khatmas/${khatmaId}/rota/setup`);
      }}
    >
      <div className="mb-6">
        <label htmlFor={`${ids}-name`} className="block text-xl font-semibold">
          {t.rota.organizerName}
        </label>
        <input
          id={`${ids}-name`}
          type="text"
          maxLength={60}
          value={organizerName}
          onChange={(event) => setOrganizerName(event.target.value)}
          className={fieldClass}
        />
        <label
          htmlFor={`${ids}-phone`}
          className="mt-4 block text-xl font-semibold"
        >
          {t.rota.organizerPhone}
        </label>
        <input
          id={`${ids}-phone`}
          type="text"
          inputMode="tel"
          autoComplete="off"
          dir="ltr"
          value={organizerPhone}
          onChange={(event) => setOrganizerPhone(event.target.value)}
          className={`${fieldClass} text-right`}
        />
      </div>
    </RotaCreateForm>
  );
}

/** The website's second step, for a khatma an admin set up or is helping. */
export function RotaSetupPage() {
  const khatmaId = useParams().khatmaId as Id<"khatmas">;
  return (
    <AdminRotaProvider khatmaId={khatmaId}>
      <RotaPeopleSetupContent
        inviteCode={khatmaId}
        khatmaPath={`/khatmas/${khatmaId}/rota`}
        canStart
      />
    </AdminRotaProvider>
  );
}

import { expect } from "@playwright/test";
import { t } from "../apps/admin/src/i18n/ar";
import { t as webT } from "../apps/web/src/i18n/ar";
import { ADMIN_URL, randomPhone, signInAsAdmin, test } from "./support";

const KHATMA_NAME = "ختمة نيابة عن منظّم";
const ORGANIZER = "أم خالد";
const PERSON = "سارة";

// An admin in a real browser: from the organizers page sets a rotating khatma up on someone's
// behalf with one person, sees the join link and that it waits for its organizer, opens each tab
// of the help page, then archives and deletes it. The first date stays the form's default,
// tomorrow, so no day starts and the machine's time zone doesn't matter.
test("admin: set up a rotating khatma for someone, help it, archive and delete", async ({
  page,
}) => {
  await signInAsAdmin(page);

  // --- The organizers page leads to setting one up -------------------------------------------
  await page.goto(`${ADMIN_URL}/organizers`);
  await expect(
    page.getByRole("heading", { level: 1, name: t.people.title }),
  ).toBeVisible();
  await page.getByRole("link", { name: t.organizers.createFor }).click();
  await expect(page).toHaveURL(`${ADMIN_URL}/rota/new`);

  // --- Whose it is, its name and days --------------------------------------------------------
  await page.getByLabel(t.rota.organizerName).fill(ORGANIZER);
  await page.getByLabel(t.rota.organizerPhone).fill(`+${randomPhone()}`);
  await page.getByLabel(webT.rota.nameQuestion).fill(KHATMA_NAME);
  await expect(
    page.getByRole("radio", { name: webT.rota.daily, exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: webT.rota.next }).click();

  // --- One person, and the join link ---------------------------------------------------------
  await expect(
    page.getByRole("heading", { level: 1, name: webT.rota.setupTitle }),
  ).toBeVisible();
  await page.getByLabel(webT.rota.personName).fill(PERSON);
  await page.getByLabel(webT.rota.personPhone).fill(`+${randomPhone()}`);
  await page.getByRole("button", { name: webT.rota.add, exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: webT.rota.peopleList })
      .getByText(PERSON, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: webT.rota.shareJoin }),
  ).toHaveAttribute("href", /wa\.me/);
  await page.getByRole("button", { name: webT.rota.done, exact: true }).click();

  // --- The help page, and the khatma's page says it waits for its organizer ------------------
  await expect(
    page.getByRole("heading", { level: 1, name: KHATMA_NAME }),
  ).toBeVisible();
  await expect(page.getByRole("note").first()).toHaveText(t.rota.helpStrip);
  await page.getByRole("link", { name: t.rota.back }).click();
  await expect(page.getByText(t.rota.pending)).toBeVisible();
  await expect(page.getByRole("button", { name: t.rota.copy })).toBeVisible();
  await page.getByRole("link", { name: t.rota.help }).click();

  // --- Each tab opens ------------------------------------------------------------------------
  const panel = page.getByRole("tabpanel");
  await expect(
    page.getByRole("tab", { name: webT.rota.tabs.today }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText(/الختمة ١/).first()).toBeVisible();
  await page.getByRole("tab", { name: webT.rota.tabs.people }).click();
  await expect(panel.getByText(PERSON, { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: webT.khatmaSettings.link }).click();
  await expect(
    panel.getByRole("heading", { level: 2, name: webT.khatmaSettings.link }),
  ).toBeVisible();

  // --- Archive it ----------------------------------------------------------------------------
  await panel.getByRole("button", { name: webT.archive.button }).click();
  await page
    .getByRole("dialog", { name: webT.archive.title })
    .getByRole("button", { name: webT.archive.confirm })
    .click();
  await expect(page.getByText(webT.rota.archivedSettings)).toBeVisible();
  await expect(
    page.getByText(webT.archive.banner, { exact: true }),
  ).toBeVisible();

  // --- Delete it -----------------------------------------------------------------------------
  const khatmaPath = new URL(page.url()).pathname.replace(/\/rota$/, "");
  await panel.getByRole("button", { name: webT.archive.delete }).click();
  await page
    .getByRole("dialog", { name: webT.archive.deleteTitle })
    .getByRole("button", { name: webT.archive.deleteConfirm })
    .click();
  await expect(page).toHaveURL(`${ADMIN_URL}/`);
  await page.goto(`${ADMIN_URL}${khatmaPath}`);
  await expect(page.getByText(t.lookup.notFound)).toBeVisible();
});

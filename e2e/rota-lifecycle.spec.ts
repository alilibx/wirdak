import { expect, type Page } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import {
  allowRota,
  blockExternal,
  randomPhone,
  test,
  today,
  verifyInSheet,
} from "./support";

const KHATMA_NAME = "ختمة الأرشفة";
const PERSON = "سارة";

/** The invite code of the khatma whose page `page` is on (`/j/<code>` or `/j/<code>/...`). */
function inviteCodeOf(page: Page): string {
  const code = new URL(page.url()).pathname.split("/")[2];
  if (!code) throw new Error(`not a khatma page: ${page.url()}`);
  return code;
}

/** Archives the khatma whose settings page is open, through the confirmation. */
async function archiveFromSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: t.archive.button }).click();
  const sheet = page.getByRole("dialog", { name: t.archive.title });
  await sheet.getByRole("button", { name: t.archive.confirm }).click();
  await expect(page.getByText(t.rota.archivedSettings)).toBeVisible();
}

// The life of a rotating khatma after the reading: A creates one with a person, archives it, sees
// it as read-only and under «المؤرشفة», starts again with the same people, archives and deletes
// the new one, and the person they added is still saved in A's settings.
test("rota: archive, start again, delete", async ({ page }) => {
  const aName = `علي ${Math.floor(Math.random() * 1e6)}`;
  const aPhone = randomPhone();
  await blockExternal(page.context());

  // --- A signs in and is allowed to create rotating khatmas ----------------------------------
  await page.goto("/");
  await page.getByRole("button", { name: t.signIn.button }).click();
  await verifyInSheet(page, aName, aPhone);
  await expect(page.getByRole("dialog")).toBeHidden();
  await allowRota(aPhone);

  // --- A creates a khatma and adds a person --------------------------------------------------
  await page.goto("/new");
  await page.getByRole("link", { name: new RegExp(t.rota.rotaTitle) }).click();
  await page.getByLabel(t.rota.nameQuestion).fill(KHATMA_NAME);
  await page
    .getByRole("button", { name: `${t.rota.startLabel}: ${t.rota.change}` })
    .click();
  await page.getByLabel(t.rota.startDateInput).fill(today());
  await page.getByRole("button", { name: t.rota.next }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: t.rota.setupTitle }),
  ).toBeVisible();
  const people = page.getByRole("list", { name: t.rota.peopleList });
  await page.getByLabel(t.rota.personName).fill(PERSON);
  await page.getByLabel(t.rota.personPhone).fill(`+${randomPhone()}`);
  await page.getByRole("button", { name: t.rota.add, exact: true }).click();
  await expect(people.getByText(PERSON)).toBeVisible();
  await page.getByRole("button", { name: t.rota.done, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: KHATMA_NAME }),
  ).toBeVisible();
  const firstCode = inviteCodeOf(page);

  // --- Archive it from its settings ----------------------------------------------------------
  await page.getByRole("link", { name: t.khatmaSettings.link }).click();
  await archiveFromSettings(page);
  await expect(
    page.getByRole("button", { name: t.archive.button }),
  ).toBeHidden();

  // --- The khatma says it is archived, and home lists it under «المؤرشفة» --------------------
  await page.goto(`/j/${firstCode}`);
  await expect(page.getByText(t.archive.banner)).toBeVisible();
  await page.goto("/");
  const archivedList = page.locator("details", { hasText: t.home.archived });
  await archivedList.getByText(t.home.archived).click();
  await expect(archivedList.getByRole("link")).toHaveCount(1);
  await expect(archivedList.getByText(KHATMA_NAME)).toBeVisible();

  // --- Start again with the same people ------------------------------------------------------
  await archivedList.getByRole("link").click();
  await expect(page.getByText(t.archive.banner)).toBeVisible();
  await page.getByRole("button", { name: t.archive.restart }).click();
  await page
    .getByRole("dialog", { name: t.archive.restartTitle })
    .getByRole("button", { name: t.archive.restartConfirm })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: t.rota.setupTitle }),
  ).toBeVisible();
  const secondCode = inviteCodeOf(page);
  expect(secondCode).not.toBe(firstCode);
  await expect(
    page.getByRole("list", { name: t.rota.peopleList }).getByText(PERSON),
  ).toBeVisible();

  // --- Archive the new one and delete it -----------------------------------------------------
  await page.goto(`/j/${secondCode}/settings`);
  await archiveFromSettings(page);
  await page.getByRole("button", { name: t.archive.delete }).click();
  const deleteSheet = page.getByRole("dialog", {
    name: t.archive.deleteTitle,
  });
  await deleteSheet
    .getByLabel(t.archive.deleteTypeLabel)
    .fill(t.archive.deleteWord);
  await deleteSheet
    .getByRole("button", { name: t.archive.deleteConfirm })
    .click();

  // --- Home: the new one is gone and the first is still there --------------------------------
  await expect(page).toHaveURL("/");
  const archivedAfter = page.locator("details", { hasText: t.home.archived });
  await archivedAfter.getByText(t.home.archived).click();
  await expect(archivedAfter.getByRole("link")).toHaveCount(1);
  await expect(archivedAfter.getByText(KHATMA_NAME)).toBeVisible();
  await page.goto(`/j/${secondCode}`);
  await expect(
    page.getByRole("heading", { level: 1, name: t.notFound.dead }),
  ).toBeVisible();

  // --- The person A added is still saved in A's settings -------------------------------------
  await page.goto("/settings");
  const saved = page.getByRole("region", { name: t.settings.savedHeading });
  await expect(saved.getByText(PERSON)).toBeVisible();
});

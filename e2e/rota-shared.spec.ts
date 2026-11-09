import { expect, type Locator, type Page } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import {
  allowRota,
  blockExternal,
  randomPhone,
  test,
  today,
  verifyInSheet,
} from "./support";

const KHATMA_NAME = "ختمة المشاركة";
/** Eight people for setup, then two, one and one more for the people tab. */
const SETUP_PEOPLE = [
  "سارة",
  "خالد",
  "منى",
  "عمر",
  "هدى",
  "يوسف",
  "ليلى",
  "زيد",
];
const LATE_PEOPLE = ["ريم", "طارق"];
const THIRTIETH = "سلمى";
const PARTNER = "نورة";

/** Fills the open add form with a new person and presses its add button. */
async function addPerson(
  scope: Page | ReturnType<Page["getByRole"]>,
  name: string,
) {
  await scope.getByLabel(t.rota.personName).fill(name);
  await scope.getByLabel(t.rota.personPhone).fill(`+${randomPhone()}`);
  await scope.getByRole("button", { name: t.rota.add, exact: true }).click();
}

/**
 * Late in the day the server asks when a new reader starts, before adding them. Answer «يبدأ
 * اليوم», what happens earlier in the day when nobody is asked, so the test passes at any hour.
 */
async function startToday(page: Page, added: Locator) {
  const readsToday = page.getByRole("button", { name: t.rota.readsToday });
  await expect(readsToday.or(added).first()).toBeVisible();
  if (await readsToday.isVisible()) await readsToday.click();
}

// Two readers share one juz' of a rotating khatma, but only once all 30 have a reader. A sets the
// khatma up with nine people (the leftover ajza' spread so 27 are read), leaves it, and fills the
// last three on the people tab. With 29 read nothing about sharing shows; with the 30th, a row's
// sheet offers «أضف قارئاً يشاركه الجزء», and a new person added there reads it beside its reader.
test("rota: an organizer shares a juz' once all 30 have a reader", async ({
  page,
}) => {
  const aName = `علي ${Math.floor(Math.random() * 1e6)}`;
  const aPhone = randomPhone();
  await blockExternal(page.context());

  // --- A signs in and is allowed to create rotating khatmas ----------------------------------
  await page.goto("/");
  await page.getByRole("button", { name: t.signIn.button }).click();
  await verifyInSheet(page, aName, aPhone);
  await expect(page.getByRole("dialog")).toBeHidden();
  await allowRota(aPhone);

  // --- Create the khatma, add eight people, give the leftover ajza' out -----------------------
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
  const setupPeople = page.getByRole("list", { name: t.rota.peopleList });
  for (const name of SETUP_PEOPLE) {
    await addPerson(page, name);
    await expect(setupPeople.getByText(name)).toBeVisible();
  }
  await page.getByRole("button", { name: t.rota.spread }).click();
  await page.getByRole("button", { name: t.rota.done, exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: KHATMA_NAME }),
  ).toBeVisible();

  // --- People tab: fill two of the three open ajza' -------------------------------------------
  await page.getByRole("tab", { name: t.rota.tabs.people }).click();
  const rows = page.locator("ol > li");
  await expect(rows).toHaveCount(30);
  const openRows = page.getByRole("button", { name: /\+ أضف قارئاً للجزء/ });
  await expect(openRows).toHaveCount(3);
  for (const name of LATE_PEOPLE) {
    await openRows.first().click();
    const sheet = page.getByRole("dialog");
    await addPerson(sheet, name);
    await startToday(page, rows.filter({ hasText: name }));
    await expect(sheet).toBeHidden();
    await expect(rows.filter({ hasText: name })).toHaveCount(1);
  }

  // --- 29 have a reader: nothing about sharing shows ------------------------------------------
  await expect(openRows).toHaveCount(1);
  await expect(page.getByText(/مشترك/)).toHaveCount(0);
  const second = rows.nth(1);
  await second.getByRole("button").first().click();
  const personSheet = page.getByRole("dialog");
  await expect(
    personSheet.getByRole("button", { name: t.rota.rename }),
  ).toBeVisible();
  await expect(
    personSheet.getByRole("button", { name: t.rota.shareAction }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  // --- The 30th reader: sharing opens ---------------------------------------------------------
  await openRows.first().click();
  const lastSheet = page.getByRole("dialog");
  await addPerson(lastSheet, THIRTIETH);
  await startToday(page, rows.filter({ hasText: THIRTIETH }));
  await expect(lastSheet).toBeHidden();
  await expect(openRows).toHaveCount(0);

  // --- Share the second juz' with a new person ------------------------------------------------
  await second.getByRole("button").first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: t.rota.shareAction })
    .click();
  const shareSheet = page.getByRole("dialog", { name: t.rota.shareAction });
  await addPerson(shareSheet, PARTNER);
  await expect(page.getByRole("dialog")).toBeHidden();

  // The row shows both readers, and the list says one juz' is shared.
  await expect(rows).toHaveCount(30);
  await expect(second.getByText(PARTNER)).toBeVisible();
  await expect(second.getByRole("button")).toHaveCount(2);
  // Twelve people plus the partner.
  await expect(page.getByText(t.rota.sharedCount(13, 1))).toBeVisible();
});

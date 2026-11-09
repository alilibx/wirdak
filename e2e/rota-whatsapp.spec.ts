import { expect, type Locator } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import { normalizeDigits } from "../convex/lib/digits";
import {
  allowRota,
  blockExternal,
  randomPhone,
  rotaPayload,
  simulateIncoming,
  test,
  today,
  verifyInSheet,
} from "./support";

/** The join message inside the setup screen's share link, which wraps the join link in its text. */
function joinTextFrom(shareHref: string): string {
  const shared = new URL(shareHref).searchParams.get("text") ?? "";
  const joinLink = shared.match(/https:\/\/wa\.me\/\S+/)?.[0];
  expect(joinLink, "the share message holds the join link").toBeDefined();
  const message = new URL(joinLink ?? "").searchParams.get("text");
  expect(message).toMatch(/انضمام .* · [A-Z2-9]{6}$/);
  return message ?? "";
}

// B's side of a rotating khatma on WhatsApp: A creates a daily rota and adds B by phone, B sends the
// join message from B's number (the people row turns to «انضمّ»), the day starts, and B's «أتممت»
// tap, built by the dev helper, finishes B's juz' on Today.
test("rota on WhatsApp: a member joins and finishes their juz'", async ({
  page,
}) => {
  const aPhone = randomPhone();
  const bPhone = randomPhone();
  const bName = "ياسر";
  await blockExternal(page.context());

  // --- A signs in, is allowed rotating khatmas, and starts a daily one ------------------------
  await page.goto("/");
  await page.getByRole("button", { name: t.signIn.button }).click();
  await verifyInSheet(page, `علي ${Math.floor(Math.random() * 1e6)}`, aPhone);
  await expect(page.getByRole("dialog")).toBeHidden();
  await allowRota(aPhone);

  await page.goto("/new");
  await page.getByRole("link", { name: new RegExp(t.rota.rotaTitle) }).click();
  await page.getByLabel(t.rota.nameQuestion).fill("ختمة واتساب");
  await page
    .getByRole("button", { name: `${t.rota.startLabel}: ${t.rota.change}` })
    .click();
  await page.getByLabel(t.rota.startDateInput).fill(today());
  await page.getByRole("button", { name: t.rota.next }).click();

  // --- Step 2: B is added, and A's list shows B has not joined -------------------------------
  await expect(
    page.getByRole("heading", { level: 1, name: t.rota.setupTitle }),
  ).toBeVisible();
  const inviteCode = new URL(page.url()).pathname.split("/")[2];
  expect(inviteCode).toBeTruthy();
  await page.getByLabel(t.rota.personName).fill(bName);
  await page.getByLabel(t.rota.personPhone).fill(`+${bPhone}`);
  await page.getByRole("button", { name: t.rota.add, exact: true }).click();
  const people = page.getByRole("list", { name: t.rota.peopleList });
  const row = people.getByRole("listitem").filter({ hasText: bName });
  await expect(row).toBeVisible();
  await expect(row.getByText(t.rota.notJoined)).toBeVisible();
  const juzIn = async (listItem: Locator) =>
    Number(
      normalizeDigits(
        (await listItem.textContent())?.match(/الجزء\s*(\d+)/)?.[1] ?? "",
      ),
    );
  const bJuz = await juzIn(row);
  const aJuz = await juzIn(
    people.getByRole("listitem").filter({ hasText: t.rota.me }),
  );
  expect(bJuz).toBeGreaterThan(0);
  expect(aJuz).toBeGreaterThan(0);
  expect(aJuz).not.toBe(bJuz);

  // --- B sends the join message from B's number ---------------------------------------------
  const share = page.getByRole("link", { name: t.rota.shareJoin });
  const href = await share.getAttribute("href");
  expect(href).not.toBeNull();
  await simulateIncoming(bPhone, joinTextFrom(href ?? ""));
  await expect(row.getByText(t.rota.joined, { exact: true })).toBeVisible();

  // --- «تمّ» starts the day (its time has passed; e2e/global-setup.ts) -------------------------
  await page.getByRole("button", { name: t.rota.done, exact: true }).click();
  const grid = page.getByRole("region", { name: t.rota.gridLabel });
  await expect(grid).toBeVisible();
  await expect(page.getByText(t.rota.progress(0, 30))).toBeVisible();

  // --- A reads their own juz' first ----------------------------------------------------------
  const tile = (juz: number, state: string) =>
    page.getByRole("button", { name: t.rota.tileLabel(juz, state) });
  await tile(aJuz, t.rota.legendUnread).click();
  await page.getByRole("button", { name: t.rota.markDone }).click();
  await expect(tile(aJuz, t.rota.legendDone)).toBeVisible();
  await expect(page.getByText(t.rota.progress(1, 30))).toBeVisible();

  // --- B taps «أتممت» on WhatsApp ------------------------------------------------------------
  await expect(tile(bJuz, t.rota.legendUnread)).toBeVisible();
  const payload = await rotaPayload(inviteCode ?? "", bPhone, "done");
  await simulateIncoming(bPhone, "أتممت", payload);
  await expect(tile(bJuz, t.rota.legendDone)).toBeVisible();
  await expect(page.getByText(t.rota.progress(2, 30))).toBeVisible();
});

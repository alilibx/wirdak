import { expect } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import {
  allowRota,
  blockExternal,
  randomPhone,
  rotaNewLayout,
  test,
  today,
  verifyInSheet,
} from "./support";

const KHATMA_NAME = "ختمة الشكل الجديد";

// The new rota page, turned on for one organizer: the people come first with Settings as the
// second tab, and the open day is a card above them whose tiles open in a sheet. A makes a daily
// rota from today with one other reader, records a juz' from the card, and pauses from the tab.
// The run moves the default day time to one that has passed (e2e/global-setup.ts), so the first
// day starts as soon as A taps «تمّ».
test("rota, new layout: people first, the day as a card, settings as a tab", async ({
  page,
}) => {
  const aName = `هدى ${Math.floor(Math.random() * 1e6)}`;
  const aPhone = randomPhone();
  await blockExternal(page.context());

  await page.goto("/");
  await page.getByRole("button", { name: t.signIn.button }).click();
  await verifyInSheet(page, aName, aPhone);
  await expect(page.getByRole("dialog")).toBeHidden();
  await allowRota(aPhone);
  await rotaNewLayout(aPhone);

  // --- A daily rota from today, with one more reader ----------------------------------------
  await page.goto("/new");
  await page.getByRole("link", { name: new RegExp(t.rota.rotaTitle) }).click();
  await page.getByLabel(t.rota.nameQuestion).fill(KHATMA_NAME);
  await page
    .getByRole("button", { name: `${t.rota.startLabel}: ${t.rota.change}` })
    .click();
  await page.getByLabel(t.rota.startDateInput).fill(today());
  await page.getByRole("button", { name: t.rota.next }).click();
  await page.getByLabel(t.rota.personName).fill("سارة");
  await page.getByLabel(t.rota.personPhone).fill(`+${randomPhone()}`);
  await page.getByRole("button", { name: t.rota.add, exact: true }).click();
  await page.getByRole("button", { name: t.rota.done, exact: true }).click();

  // --- The page: people first, no settings link, the day as a card --------------------------
  await expect(
    page.getByRole("heading", { level: 1, name: KHATMA_NAME }),
  ).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText([t.rota.tabs.people, t.rota.tabs.settings]);
  await expect(
    page.getByRole("tab", { name: t.rota.tabs.people }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("link", { name: t.khatmaSettings.link }),
  ).toHaveCount(0);
  await expect(page.getByText(t.rota.addReader(3))).toBeVisible();

  const card = page.getByRole("button", { name: /افتح الأجزاء/ });
  await expect(card).toBeVisible();
  await expect(page.getByText(t.rota.progress(0, 30))).toBeVisible();
  await expect(
    page.getByRole("region", { name: t.rota.gridLabel }),
  ).toHaveCount(0);

  // --- The card's tiles: A takes juz' 30 and records it -------------------------------------
  await card.click();
  const grid = page.getByRole("region", { name: t.rota.gridLabel });
  await expect(grid.getByRole("button")).toHaveCount(30);
  await grid
    .getByRole("button", { name: t.rota.tileLabel(30, t.rota.legendUnread) })
    .click();
  await page.getByRole("button", { name: t.rota.readMyself }).click();
  // Closing the juz' sheet goes back to the tiles.
  await grid
    .getByRole("button", {
      name: t.rota.tileLabel(30, t.rota.legendReassigned),
    })
    .click();
  await page.getByRole("button", { name: t.rota.markDone }).click();
  await expect(
    grid.getByRole("button", { name: t.rota.tileLabel(30, t.rota.legendDone) }),
  ).toBeVisible();
  await page.getByRole("button", { name: t.sheet.close }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(t.rota.progress(1, 30))).toBeVisible();

  // --- Settings as a tab: pausing shows the banner above the tabs ---------------------------
  await page.getByRole("tab", { name: t.rota.tabs.settings }).click();
  const pause = page.getByRole("switch", { name: t.rota.pauseNow });
  await pause.click();
  await expect(pause).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(t.rota.pausedBanner)).toBeVisible();

  // The old settings address opens the tab.
  const code = new URL(page.url()).pathname.split("/")[2] ?? "";
  await page.goto(`/j/${code}/settings`);
  await expect(page).toHaveURL(new RegExp(`/j/${code}\\?tab=settings$`));
  await expect(
    page.getByRole("tab", { name: t.rota.tabs.settings }),
  ).toHaveAttribute("aria-selected", "true");
});

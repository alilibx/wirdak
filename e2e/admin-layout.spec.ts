import { expect, type Page } from "@playwright/test";
import { t } from "../apps/admin/src/i18n/ar";
import { t as webT } from "../apps/web/src/i18n/ar";
import { ADMIN_URL, randomPhone, signInAsAdmin, test } from "./support";

const PAGES = [
  "/",
  "/help",
  "/people",
  "/people?tab=organizers",
  "/khatmas",
  "/search",
  "/settings",
  "/audit",
  "/admins",
];

/**
 * How far the page scrolls sideways, plus every element sticking out of the
 * screen. A clipping parent hides overflow from the scroll width alone.
 */
async function overflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const outside = [...document.querySelectorAll("main *")].filter((el) => {
      if (el.closest(".overflow-x-auto")) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && (box.left < -1 || box.right > width + 1);
    });
    return document.documentElement.scrollWidth - width + outside.length;
  });
}

for (const viewport of [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`no sideways scroll at ${viewport.width} in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await signInAsAdmin(page);
      for (const path of PAGES) {
        await page.goto(`${ADMIN_URL}${path}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await overflow(page), path).toBe(0);
      }
    });
  }
}

test("a very long name stays inside its row on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAsAdmin(page);
  await page.goto(`${ADMIN_URL}/rota/new`);
  await page.getByLabel(t.rota.organizerName).fill("عبد".repeat(20));
  await page.getByLabel(t.rota.organizerPhone).fill(`+${randomPhone()}`);
  await page.getByLabel(webT.rota.nameQuestion).fill("ختمة".repeat(10));
  await page.getByRole("button", { name: webT.rota.next }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: webT.rota.setupTitle }),
  ).toBeVisible();

  await page.goto(`${ADMIN_URL}/people?tab=organizers`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The backend trims a long name, so this can't match the whole of it.
  await expect(
    page.getByRole("link", { name: /^(عبد)+/ }).first(),
  ).toBeVisible();
  expect(await overflow(page)).toBe(0);
});

import { expect, type Browser, type Page } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import {
  blockExternal,
  dismissPushPrompt,
  forceGraceEnd,
  newPerson,
  randomPhone,
  test,
  verifyInSheet,
} from "./support";

const KHATMA_NAME = "ختمة الأسرة";
/** What the organizer's note says for one juz' that went back to the pool (any reason, same words). */
const openNote = (juz: string) => `الجزء ${juz} متاح لمن يساعد`;
const juzTile = (page: Page, juz: string) =>
  page.getByRole("button", { name: new RegExp(`^${t.tile.juz(juz)}،`) });

/** A creates a weekly khatma (so A is the organizer) and returns the invite link. */
async function startKhatma(page: Page): Promise<string> {
  const aName = `علي ${Math.floor(Math.random() * 1e6)}`;
  await blockExternal(page.context());
  await page.goto("/");
  await page.getByRole("link", { name: t.home.startNewPlain }).click();
  await page.getByLabel(new RegExp(t.create.nameLabel)).fill(KHATMA_NAME);
  await page.getByRole("button", { name: t.create.submit }).click();
  await verifyInSheet(page, aName, randomPhone());

  const invite = page.getByRole("dialog", { name: t.share.createdTitle });
  const inviteText = await invite.getByText(/\/j\//).innerText();
  const inviteUrl = inviteText.match(/https?:\/\/\S+/)?.[0];
  expect(inviteUrl).toBeDefined();
  await invite.getByRole("button", { name: t.share.done }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: KHATMA_NAME }),
  ).toBeVisible();
  return inviteUrl ?? "";
}

/** B, in a clean browser context, follows the invite, verifies, and takes `juz`. */
async function joinAndTake(browser: Browser, inviteUrl: string, juz: string) {
  const { context, page: b } = await newPerson(browser);
  await b.goto(inviteUrl);
  await juzTile(b, juz).click();
  await verifyInSheet(
    b,
    `سارة ${Math.floor(Math.random() * 1e6)}`,
    randomPhone(),
  );
  await b
    .getByRole("dialog")
    .getByRole("button", { name: t.take.confirm })
    .click();
  await expect(b.getByText(t.card.held)).toBeVisible();
  await dismissPushPrompt(b);
  // B is a member now: the grid has its own tab. Come back to "my juz'" afterwards.
  await b.getByRole("tab", { name: t.nav.tabs.pool }).click();
  await expect(
    b.getByRole("button", { name: new RegExp(t.tile.mine) }),
  ).toHaveCount(1);
  await b.getByRole("tab", { name: t.nav.tabs.mine }).click();
  return { b, context };
}

// Grace end (forced through the dev helper): the juz' opens for everyone else, the organizer is
// told in words that name nobody, takes it from the note, and the reader is thanked.
test("grace end: juz opens, organizer is told and takes it, reader is thanked", async ({
  page,
  browser,
}) => {
  const inviteUrl = await startKhatma(page);
  const code = new URL(inviteUrl).pathname.split("/j/")[1] ?? "";
  expect(code).not.toBe("");
  const { b, context } = await joinAndTake(browser, inviteUrl, "٥");
  try {
    await forceGraceEnd(code, 5);

    // A: tile 5 reads "open" with no name, and the note offers it.
    await page.reload();
    await page.getByRole("tab", { name: t.nav.tabs.pool }).click();
    const tile = juzTile(page, "٥");
    await expect(tile).toContainText(t.tile.open);
    await expect(tile).not.toContainText(t.tile.reading);
    await page.getByRole("tab", { name: t.nav.tabs.mine }).click();
    await expect(page.getByText(openNote("٥"))).toBeVisible();

    // A takes it from the note.
    await page.getByRole("button", { name: t.notes.takeJuz }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t.take.confirm })
      .click();
    await expect(page.getByText(t.card.held)).toBeVisible();
    await dismissPushPrompt(page);
    await page.getByRole("tab", { name: t.nav.tabs.pool }).click();
    await expect(
      page.getByRole("button", { name: new RegExp(t.tile.mine) }),
    ).toHaveCount(1);

    // B: thanked, and no longer holds it.
    await b.reload();
    await expect(
      b.getByText(
        t.notes.text({
          kind: "thanks",
          juz: [5],
          count: null,
          until: null,
        }),
      ),
    ).toBeVisible();
    await expect(b.getByText(t.card.held)).toBeHidden();
  } finally {
    await context.close();
  }
});

// "I can't finish it" reaches the organizer with the same wording as a timeout.
test("release: the organizer's note reads the same as for a timeout", async ({
  page,
  browser,
}) => {
  const inviteUrl = await startKhatma(page);
  const { b, context } = await joinAndTake(browser, inviteUrl, "٦");
  try {
    await b.getByRole("button", { name: t.card.release }).click();
    await b
      .getByRole("dialog")
      .getByRole("button", { name: t.release.confirm })
      .click();
    await expect(b.getByText(t.card.held)).toBeHidden();

    await page.reload();
    await expect(page.getByText(openNote("٦"))).toBeVisible();
    await page.getByRole("tab", { name: t.nav.tabs.pool }).click();
    await expect(juzTile(page, "٦")).toContainText(t.tile.open);
  } finally {
    await context.close();
  }
});

// A finish that stands reaches the reader still on a juz', in words that name nobody.
test("a finish cheers the reader still reading", async ({ page, browser }) => {
  const inviteUrl = await startKhatma(page);
  const { b, context } = await joinAndTake(browser, inviteUrl, "٥");
  try {
    await page.getByRole("button", { name: t.card.take }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: t.take.confirm })
      .click();
    await expect(page.getByText(t.card.held)).toBeVisible();
    await dismissPushPrompt(page);
    await page.getByRole("button", { name: t.card.finish }).click();
    await expect(page.getByText(t.toast.finished)).toBeVisible();

    // The cheer waits out the undo window, then arrives on the open page.
    const cheer = t.notes.text({
      kind: "cheer",
      juz: [],
      count: 1,
      until: null,
    });
    await expect(b.getByText(cheer)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(cheer)).toBeHidden();
  } finally {
    await context.close();
  }
});

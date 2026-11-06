import { expect, type Page } from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import {
  blockExternal,
  dismissPushPrompt,
  newPerson,
  randomPhone,
  test,
  verifyInSheet,
} from "./support";

const KHATMA_NAME = "ختمة الحي";

/** A section of the khatma's settings page, by its heading. */
const section = (page: Page, heading: string) =>
  page.getByRole("region", { name: heading });

// Co-organizers in a pool khatma: A starts one and B joins by A's invite. A names B a
// co-organizer with People only. B's settings page then has the members and the invite reset,
// and none of what stays A's: the name, archiving, handing the khatma over, or naming others.
// A turns People off, and B's settings page loses the invite reset.
test("co-organizers: the owner names one, who gets only their switch", async ({
  page,
  browser,
}) => {
  const aName = `علي ${Math.floor(Math.random() * 1e6)}`;
  const bName = `سارة ${Math.floor(Math.random() * 1e6)}`;
  await blockExternal(page.context());

  // --- A: verify, create a khatma ------------------------------------------------------------
  await page.goto("/");
  await page.getByRole("link", { name: t.home.startNewPlain }).click();
  await page.getByLabel(new RegExp(t.create.nameLabel)).fill(KHATMA_NAME);
  await page.getByRole("button", { name: t.create.submit }).click();
  await verifyInSheet(page, aName, randomPhone());
  const invite = page.getByRole("dialog", { name: t.share.createdTitle });
  const inviteText = await invite.getByText(/\/j\//).innerText();
  const inviteUrl = inviteText.match(/https?:\/\/\S+/)?.[0] ?? "";
  expect(inviteUrl).not.toBe("");
  await invite.getByRole("button", { name: t.share.done }).click();
  const settingsPath = `${new URL(inviteUrl).pathname}/settings`;

  // --- B: follow the invite, verify, take a juz' ---------------------------------------------
  const { context: bContext, page: b } = await newPerson(browser);
  await b.goto(inviteUrl);
  await b.getByRole("button", { name: t.card.take }).click();
  await verifyInSheet(b, bName, randomPhone());
  await b
    .getByRole("dialog")
    .getByRole("button", { name: t.take.confirm })
    .click();
  await dismissPushPrompt(b);

  // --- A: name B a co-organizer with People only ---------------------------------------------
  await page.goto(settingsPath);
  const coOrganizers = section(page, t.coOrganizers.heading);
  await expect(coOrganizers).toContainText(t.coOrganizers.none);
  await coOrganizers.getByRole("button", { name: t.coOrganizers.add }).click();
  const add = page.getByRole("dialog", { name: t.coOrganizers.add });
  await add.getByRole("radio", { name: bName }).check();
  const switchOf = (name: string) => add.getByRole("switch", { name });
  // The admin's defaults turn every switch on: keep People alone.
  await switchOf(t.coOrganizers.switches.readings).click();
  await switchOf(t.coOrganizers.switches.settings).click();
  await expect(switchOf(t.coOrganizers.switches.people)).toBeChecked();
  await add.getByRole("button", { name: t.coOrganizers.save }).click();
  await expect(add).toBeHidden();
  const named = coOrganizers.getByRole("button", { name: new RegExp(bName) });
  await expect(named).toContainText(
    t.coOrganizers.permissions([t.coOrganizers.switches.people]),
  );

  // --- B: the settings page has People's controls and nothing that stays A's -----------------
  await b.goto(settingsPath);
  const members = section(b, t.organizer.membersHeading);
  await expect(members).toContainText(aName);
  await expect(members).toContainText(t.organizer.coOrganizerBadge);
  await expect(
    section(b, t.organizer.resetHeading).getByRole("button", {
      name: t.organizer.reset,
    }),
  ).toBeVisible();
  await expect(section(b, t.organizer.nameHeading)).toHaveCount(0);
  await expect(b.getByLabel(t.create.nameLabel)).toHaveCount(0);
  await expect(section(b, t.archive.heading)).toHaveCount(0);
  await expect(b.getByRole("button", { name: t.archive.button })).toHaveCount(
    0,
  );
  await expect(
    b.getByRole("button", { name: new RegExp(`^${t.organizer.transfer}`) }),
  ).toHaveCount(0);
  await expect(section(b, t.coOrganizers.heading)).toHaveCount(0);

  // --- A: turn People off --------------------------------------------------------------------
  await named.click();
  const edit = page.getByRole("dialog", { name: bName });
  await edit
    .getByRole("switch", { name: t.coOrganizers.switches.people })
    .click();
  await edit.getByRole("button", { name: t.coOrganizers.save }).click();
  await expect(edit).toBeHidden();
  await expect(named).toContainText(t.coOrganizers.permissions([]));

  // --- B: the invite reset is gone, live, and the members list stays -------------------------
  await expect(section(b, t.organizer.resetHeading)).toHaveCount(0);
  await expect(section(b, t.organizer.membersHeading)).toContainText(aName);

  await bContext.close();
});

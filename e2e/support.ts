import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import {
  test as base,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { t } from "../apps/web/src/i18n/ar";
import type { Throttle } from "./throttle";

const run = promisify(execFile);

/** A valid-looking UAE mobile number nobody has used before: country code + 50 + seven random digits. */
export function randomPhone(): string {
  const tail = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  return `97150${tail}`;
}

/** Today's date in the browser's time zone as `YYYY-MM-DD` (the backend uses the same zone). */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Runs an internal Convex function on the local backend (`bun run convex run`). */
async function convexRun(fn: string, args: object): Promise<string> {
  const { stdout } = await run(
    "bun",
    ["run", "convex", "run", fn, JSON.stringify(args)],
    { cwd: new URL("..", import.meta.url).pathname },
  );
  return stdout;
}

/**
 * Stands in for the person pressing "send" in WhatsApp: hands the verification message to the
 * dev-only `dev:simulateIncoming` action, exactly as the webhook would.
 */
export async function simulateIncoming(
  from: string,
  text: string,
  payload?: string,
): Promise<void> {
  await convexRun("dev:simulateIncoming", { from, text, payload });
}

/**
 * The payload of a button on the rota message `phone` (digits only) got for the khatma's open day,
 * for `simulateIncoming` to send as that tap (dev-only helper).
 */
export async function rotaPayload(
  inviteCode: string,
  phone: string,
  action: "done" | "notYet" | "dua",
): Promise<string> {
  const stdout = await convexRun("dev:rotaPayload", {
    inviteCode,
    phone: `+${phone}`,
    action,
  });
  // The CLI prints the return value as JSON on its last line.
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as string;
}

/** Ends the grace of the current hold of `juz` now, instead of waiting hours (dev-only helper). */
export async function forceGraceEnd(
  inviteCode: string,
  juz: number,
): Promise<void> {
  await convexRun("dev:forceGraceEnd", { inviteCode, juz });
}

/** Lets the verified person who sent from `phone` (digits only) create rotating khatmas, as an admin would (dev-only helper). */
export async function allowRota(phone: string): Promise<void> {
  await convexRun("dev:allowRota", { phone: `+${phone}` });
}

/** A session token for the admin with this number, who is made if new (dev-only helper). */
export async function adminSession(phone: string): Promise<string> {
  const stdout = await convexRun("dev:adminSession", { phone });
  // The CLI prints the return value as JSON on its last line.
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as string;
}

/** Where `playwright.config.ts` serves the admin site's build. */
export const ADMIN_URL = "http://localhost:5174";
/** The key `apps/admin/src/lib/adminSession.ts` keeps its token under. */
const ADMIN_TOKEN_KEY = "wirdak.admin.session";
/** One fixed admin, so runs don't leave a new admin row each time on the shared local backend. */
const ADMIN_PHONE = "+971500000077";

/** Opens every later page in this browser as a signed-in admin. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await blockExternal(page.context());
  const token = await adminSession(ADMIN_PHONE);
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key ?? "", value ?? ""),
    [ADMIN_TOKEN_KEY, token],
  );
}

const FONTS_DIR = new URL("../node_modules/@fontsource/", import.meta.url)
  .pathname;

/** The families and weights apps/web/index.html asks Google Fonts for, as Fontsource packages. */
const FONT_WEIGHTS: Record<string, number[]> = {
  "readex-pro": [300, 400, 500, 600, 700],
  "aref-ruqaa": [400, 700],
  "amiri-quran": [400],
};

/** The stylesheet Google Fonts would send, pointing at local copies under fonts.gstatic.com/e2e/. */
const FONT_CSS = Object.entries(FONT_WEIGHTS)
  .flatMap(([family, weights]) =>
    weights.map((weight) =>
      readFileSync(`${FONTS_DIR}${family}/${weight}.css`, "utf8").replaceAll(
        "url(./files/",
        `url(https://fonts.gstatic.com/e2e/${family}/files/`,
      ),
    ),
  )
  .join("\n");

/**
 * No test may reach WhatsApp or Google: WhatsApp links are blocked, and the Google Fonts
 * requests are answered with the same fonts from node_modules. Runs stay offline and
 * deterministic, and every machine lays out text in the real fonts instead of its own fallback,
 * whose widths differ between macOS and Linux.
 */
export async function blockExternal(context: BrowserContext): Promise<void> {
  await context.route(/^https?:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) =>
    route.abort(),
  );
  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
    route.fulfill({
      contentType: "text/css",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: FONT_CSS,
    }),
  );
  await context.route(/^https:\/\/fonts\.gstatic\.com\//, (route) => {
    const file = new URL(route.request().url()).pathname.match(
      /^\/e2e\/([a-z-]+)\/files\/([\w.-]+\.(woff2?))$/,
    );
    if (!file) return route.abort();
    return route.fulfill({
      path: `${FONTS_DIR}${file[1]}/files/${file[2]}`,
      contentType: `font/${file[3]}`,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });
}

/**
 * Runs the open verification sheet to the end as a new number: reads the
 * ready-made message from the "open WhatsApp" link, sends it as `phone`, then types the name and
 * confirms.
 * `whileInWhatsApp` runs between reading the message and sending it, e.g. to reload the tab.
 */
export async function verifyInSheet(
  page: Page,
  displayName: string,
  phone: string,
  whileInWhatsApp?: () => Promise<void>,
): Promise<void> {
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: t.verify.start }).click();

  // The link is the page's only copy of the message; "open again" also matches this name.
  const link = sheet.getByRole("link", { name: t.verify.openWhatsApp });
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const message = new URL(href ?? "").searchParams.get("text");
  expect(message).toMatch(/[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{2}/);

  await whileInWhatsApp?.();
  await simulateIncoming(phone, message ?? "");

  // A new number gives its name only now, once WhatsApp showed it is new.
  await expect(sheet.getByText(t.verify.confirmTitle)).toBeVisible();
  await sheet.getByLabel(t.verify.nameLabel).fill(displayName);
  await sheet.getByRole("button", { name: t.verify.yes }).click();
}

/** What the app offers once after a person's first juz' in a browser, and its "not now". */
const NOTIFY_OFFERS = [
  // Push, where the browser can do it now.
  { title: t.push.title, notNow: t.push.notNow },
  // An iPhone or iPad tab: push works only once the site is on the home screen.
  { title: t.install.title, notNow: t.install.notNow },
  // No push at all: notifications on WhatsApp instead.
  { title: t.whatsappNotes.sheetTitle, notNow: t.whatsappNotes.notNow },
];

/**
 * After a person's first juz' in a browser the app offers notifications once: push, the iPhone
 * install steps, or WhatsApp, depending on the browser. "Not now" closes whichever it is.
 */
export async function dismissPushPrompt(page: Page): Promise<void> {
  const sheets = NOTIFY_OFFERS.map(({ title }) =>
    page.getByRole("dialog", { name: title }),
  );
  const offer = sheets.reduce((either, sheet) => either.or(sheet));
  await expect(offer).toBeVisible();
  const visible = await Promise.all(sheets.map((sheet) => sheet.isVisible()));
  const shown = NOTIFY_OFFERS[visible.indexOf(true)];
  if (!shown) {
    throw new Error(
      `no notification offer stayed open: ${NOTIFY_OFFERS.map((o) => o.title).join(" / ")}`,
    );
  }
  await offer.getByRole("button", { name: shown.notNow, exact: true }).click();
  await expect(offer).toBeHidden();
}

/** The current project's throttle, if it has one. */
function projectThrottle(): Throttle | undefined {
  return test.info().project.metadata.throttle as Throttle | undefined;
}

/** Slows `page` to the project's throttle through the DevTools protocol, before it loads anything. */
async function throttle(page: Page): Promise<void> {
  const slow = projectThrottle();
  if (!slow) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: slow.latencyMs,
    // Bytes per second; a kilobit is 1000 bits, as in DevTools' own presets.
    downloadThroughput: (slow.downloadKbps * 1000) / 8,
    uploadThroughput: (slow.uploadKbps * 1000) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: slow.cpuSlowdown });
}

/** Fails the test on any uncaught error in `page`, whichever browser it shows up in. */
function failOnPageError(page: Page): void {
  page.on("pageerror", (error) => {
    expect
      .soft(error, `uncaught error in the page: ${error.message}`)
      .toBeUndefined();
  });
}

/**
 * Playwright's `test`, with the default `page` throttled for the project and watched for
 * uncaught errors. Every spec imports `test` from here.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await throttle(page);
    failOnPageError(page);
    await use(page);
  },
});

/**
 * Another person on another phone: a clean context with the project's device, external sites
 * blocked, the project's throttle, and uncaught errors failing the test. Close the context after.
 */
export async function newPerson(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await blockExternal(context);
  const page = await context.newPage();
  await throttle(page);
  failOnPageError(page);
  return { context, page };
}

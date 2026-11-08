import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { hmacSha256Hex } from "./lib/crypto";
import { DEFAULT_GRACE } from "./lib/grace";
import { joinText } from "./lib/rotaJoin";
import { helpText, notOnListText } from "./lib/rotaTemplates";
import { cleanParam } from "./lib/whatsappTemplates";
import schema from "./schema";
import {
  adminPinReply,
  describeMessage,
  parseIncoming,
  parseRelayed,
  relayIncoming,
  relaySignature,
  sendPin,
  sendSignInAlert,
  sendVerified,
  sendWhatsAppButtons,
  sendWhatsAppLink,
  sendWhatsAppTemplate,
  whatsappConfigured,
} from "./whatsapp";

const modules = import.meta.glob("./**/*.ts");

const NOW = 1_800_000_000_000;
const APP_SECRET = "test-app-secret";

type Sent = { url: string; auth: string; to: string; body: string };
let sent: Sent[];
/** Every Graph request body, whatever its message type. */
let payloads: Record<string, unknown>[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("WIRDAK_ENV", "dev");
  vi.stubEnv("WHATSAPP_PUBLIC_NUMBER", "971500000000");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "test-verify-token");
  vi.stubEnv("WHATSAPP_GRAPH_VERSION", "v21.0");
  vi.stubEnv("SITE_URL", "https://wirdak.example");
  sent = [];
  payloads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as {
        to: string;
        text?: { body: string };
      };
      payloads.push(payload);
      sent.push({
        url,
        auth: new Headers(init.headers).get("Authorization") ?? "",
        to: payload.to,
        body: payload.text?.body ?? "",
      });
      return new Response(JSON.stringify({ messages: [{ id: "out" }] }), {
        status: 200,
      });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function webhook(
  messages: unknown[],
  extra: Record<string, unknown> = {},
): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "971500000000",
                phone_number_id: "1234567890",
              },
              contacts: [{ profile: { name: "Ali" }, wa_id: "971501234567" }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

const sampleWebhook = webhook([
  {
    from: "971501234567",
    id: "wamid.1",
    timestamp: "1800000000",
    type: "text",
    text: { body: "رمز التحقق في وِردك: K7Q2-9XMB-4T" },
  },
]);

test("parseIncoming extracts text messages", () => {
  expect(parseIncoming(sampleWebhook)).toEqual([
    {
      waMessageId: "wamid.1",
      from: "971501234567",
      text: "رمز التحقق في وِردك: K7Q2-9XMB-4T",
      profileName: "Ali",
    },
  ]);
  expect(
    parseIncoming({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }),
  ).toEqual([]);
});

test("parseIncoming ignores malformed input", () => {
  expect(parseIncoming(null)).toEqual([]);
  expect(parseIncoming("nope")).toEqual([]);
  expect(parseIncoming({ entry: "x" })).toEqual([]);
  expect(parseIncoming({ entry: [null, { changes: [null] }] })).toEqual([]);
  expect(
    parseIncoming(
      webhook([
        { from: "971501234567", id: "wamid.bad", type: "text", text: {} },
        { from: "+97150", id: "wamid.from", type: "text", text: { body: "x" } },
        { from: "971501234567", type: "text", text: { body: "no id" } },
        {
          from: "971501234567",
          id: "wamid.ok",
          type: "text",
          text: { body: "hi" },
        },
      ]),
    ),
  ).toEqual([
    {
      waMessageId: "wamid.ok",
      from: "971501234567",
      text: "hi",
      profileName: "Ali",
    },
  ]);
});

test("parseIncoming reads media, stickers, voice notes and reactions as media with no text", () => {
  const types = [
    "image",
    "sticker",
    "audio",
    "video",
    "document",
    "location",
    "contacts",
    "reaction",
  ];
  expect(
    parseIncoming(
      webhook([
        ...types.map((type) => ({
          from: "971501234567",
          id: `wamid.${type}`,
          type,
          [type]: {},
        })),
        // still not a message we read
        { from: "971501234567", id: "wamid.sys", type: "system", system: {} },
        { from: "+97150", id: "wamid.from", type: "sticker", sticker: {} },
      ]),
    ),
  ).toEqual(
    types.map((type) => ({
      waMessageId: `wamid.${type}`,
      from: "971501234567",
      text: "",
      media: true,
      profileName: "Ali",
    })),
  );
});

test("parseIncoming can keep only messages to our business number", () => {
  expect(parseIncoming(sampleWebhook, "1234567890")).toHaveLength(1);
  expect(parseIncoming(sampleWebhook, "999")).toEqual([]);
  // no metadata: can't prove it was for us
  const bare = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "971501234567",
                  id: "wamid.9",
                  type: "text",
                  text: { body: "hi" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  expect(parseIncoming(bare)).toHaveLength(1);
  expect(parseIncoming(bare, "1234567890")).toEqual([]);
});

test("parseIncoming reads button taps and the sender's profile name", () => {
  const messages = webhook(
    [
      {
        from: "971501234567",
        id: "wamid.btn",
        type: "button",
        button: { payload: "r1|p|done|d1|p1", text: "تمّ" },
      },
      {
        from: "971501234567",
        id: "wamid.int",
        type: "interactive",
        interactive: {
          type: "button_reply",
          button_reply: { id: "r1|p|notYet|d1|p1", title: "ليس بعد" },
        },
      },
      // a list reply is not a button reply
      {
        from: "971501234567",
        id: "wamid.list",
        type: "interactive",
        interactive: {
          type: "list_reply",
          list_reply: { id: "x", title: "y" },
        },
      },
      // a button with no payload can't be told apart from noise
      {
        from: "971501234567",
        id: "wamid.nopayload",
        type: "button",
        button: { text: "تمّ" },
      },
      {
        from: "971501234567",
        id: "wamid.long",
        type: "button",
        button: { payload: "x".repeat(257), text: "تمّ" },
      },
    ],
    {
      contacts: [
        { wa_id: "971509999999", profile: { name: "Someone else" } },
        { wa_id: "971501234567", profile: { name: "ن".repeat(80) } },
      ],
    },
  );
  expect(parseIncoming(messages)).toEqual([
    {
      waMessageId: "wamid.btn",
      from: "971501234567",
      text: "تمّ",
      payload: "r1|p|done|d1|p1",
      profileName: "ن".repeat(60),
    },
    {
      waMessageId: "wamid.int",
      from: "971501234567",
      text: "ليس بعد",
      payload: "r1|p|notYet|d1|p1",
      profileName: "ن".repeat(60),
    },
  ]);
  // a text message carries the profile name but no payload
  const [text] = parseIncoming(sampleWebhook);
  expect(text).toEqual({
    waMessageId: "wamid.1",
    from: "971501234567",
    text: "رمز التحقق في وِردك: K7Q2-9XMB-4T",
    profileName: "Ali",
  });
  expect("payload" in text!).toBe(false);
});

/** A UTF-16 surrogate with no partner: Convex refuses it in an argument. */
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

test("profile names lose control and bidi characters and are cut by code point", () => {
  const name = (profileName: string) =>
    parseIncoming(
      webhook(
        [
          {
            from: "971501234567",
            id: "wamid.n",
            type: "text",
            text: { body: "hi" },
          },
        ],
        {
          contacts: [{ wa_id: "971501234567", profile: { name: profileName } }],
        },
      ),
    )[0]!.profileName;
  expect(name("\u202Eعلي\u202C\u0007  أحمد")).toBe("علي أحمد");
  // an emoji straddling the cut is dropped whole, never split
  const cut = name("ا".repeat(59) + "😀😀");
  expect(cut).toBe("ا".repeat(59) + "😀");
  expect(cut).not.toMatch(LONE_SURROGATE);
  // nothing readable left: no name
  expect(name("\u202E\u200B  ")).toBeUndefined();
  expect(name("😀")).toBeUndefined();
});

test("parseRelayed carries the payload and profile name", () => {
  const relayed = {
    waMessageId: "wamid.btn",
    from: "971501234567",
    text: "تمّ",
    payload: "r1|s|done|d1|p1",
    profileName: "Ali",
  };
  expect(parseRelayed(relayed)).toEqual(relayed);
  expect(
    parseRelayed({ ...relayed, payload: undefined, profileName: undefined }),
  ).toEqual({ waMessageId: "wamid.btn", from: "971501234567", text: "تمّ" });
  expect(parseRelayed({ ...relayed, payload: "x".repeat(257) })).toBeNull();
  expect(parseRelayed({ ...relayed, payload: 5 })).toBeNull();
  expect(
    parseRelayed({ ...relayed, profileName: "ن".repeat(80) })?.profileName,
  ).toBe("ن".repeat(60));
});

test("parseRelayed carries media, and refuses a media flag that isn't true", () => {
  const media = { waMessageId: "wamid.m", from: "971501234567", text: "" };
  expect(parseRelayed({ ...media, media: true })).toEqual({
    ...media,
    media: true,
  });
  expect(parseRelayed(media)).toEqual(media);
  expect(parseRelayed({ ...media, media: "yes" })).toBeNull();
  expect(parseRelayed({ ...media, media: false })).toBeNull();
});

test("recordInbound returns true once per message id", async () => {
  const t = convexTest(schema, modules);
  expect(
    await t.mutation(internal.whatsapp.recordInbound, { waMessageId: "w1" }),
  ).toBe(true);
  expect(
    await t.mutation(internal.whatsapp.recordInbound, { waMessageId: "w1" }),
  ).toBe(false);
  expect(
    await t.mutation(internal.whatsapp.recordInbound, { waMessageId: "w2" }),
  ).toBe(true);
});

test("sendText posts to the Graph API with the bearer token", async () => {
  const t = convexTest(schema, modules);
  await t.action(internal.whatsapp.sendText, {
    to: "+971501234567",
    body: "مرحبا",
  });
  expect(sent).toEqual([
    {
      url: "https://graph.facebook.com/v21.0/1234567890/messages",
      auth: "Bearer test-access-token",
      to: "971501234567",
      body: "مرحبا",
    },
  ]);
  const init = vi.mocked(fetch).mock.calls[0]![1]!;
  expect(init.method).toBe("POST");
  expect(JSON.parse(String(init.body))).toEqual({
    messaging_product: "whatsapp",
    to: "971501234567",
    type: "text",
    text: { body: "مرحبا" },
  });
});

test("sendText in dev without a token logs instead of sending", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await t.action(internal.whatsapp.sendText, {
    to: "+971501234567",
    body: "رمز الدخول إلى وِردك: 123456",
  });
  expect(sent).toEqual([]);
  expect(log.mock.calls.flat().join(" ")).toContain(
    "رمز الدخول إلى وِردك: 123456",
  );
});

test("sendText in prod never logs message bodies", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "prod");
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
  const logged = () =>
    spies.flatMap((s) => s.mock.calls.flat().map(String)).join(" ");
  const body = "رمز الدخول إلى وِردك: 654321";

  // missing token: not sent, not logged
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  await t.action(internal.whatsapp.sendText, { to: "+971501234567", body });
  expect(sent).toEqual([]);
  expect(logged()).not.toContain("654321");

  // Graph API failure: logged without the body
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("bad", { status: 500 })),
  );
  const pending = t.action(internal.whatsapp.sendText, {
    to: "+971501234567",
    body,
  });
  await vi.advanceTimersByTimeAsync(500); // the one retry
  expect(await pending).toBe(false);
  expect(logged()).not.toContain("654321");
  expect(logged()).toContain("500");
});

/** Replaces fetch with one answering the given statuses in order. */
function fetchAnswering(...statuses: number[]) {
  const mock = vi.fn(async () => {
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? "{}" : "err", { status });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

test("sendText retries once on 5xx and 429", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const first of [500, 503, 429]) {
    const mock = fetchAnswering(first, 200);
    const pending = t.action(internal.whatsapp.sendText, {
      to: "+971501234567",
      body: "x",
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe(true);
    expect(mock).toHaveBeenCalledTimes(2);
  }
  // only once: a second failure gives up
  const mock = fetchAnswering(503, 503, 200);
  const pending = t.action(internal.whatsapp.sendText, {
    to: "+971501234567",
    body: "x",
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toBe(false);
  expect(mock).toHaveBeenCalledTimes(2);
});

test("sendText never retries other 4xx", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const status of [400, 401, 403, 404]) {
    const mock = fetchAnswering(status, 200);
    expect(
      await t.action(internal.whatsapp.sendText, {
        to: "+971501234567",
        body: "x",
      }),
    ).toBe(false);
    expect(mock).toHaveBeenCalledTimes(1);
  }
});

test("sendText in dev survives an unreadable error body", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const broken = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("connection reset"));
        },
      }),
      { status: 400 },
    );
  const mock = vi.fn(async () => broken());
  vi.stubGlobal("fetch", mock);
  expect(
    await t.action(internal.whatsapp.sendText, {
      to: "+971501234567",
      body: "x",
    }),
  ).toBe(false);
  expect(mock).toHaveBeenCalledTimes(1);
});

test("sendWhatsAppTemplate posts a template with header, body and url button", async () => {
  expect(
    await sendWhatsAppTemplate("+971501234567", {
      name: "wirdak_reminder_v2",
      header: "ختمة رمضان",
      body: ["12"],
      buttonParam: "j/AB12CD",
    }),
  ).toBe(true);
  expect(payloads).toEqual([
    {
      messaging_product: "whatsapp",
      to: "971501234567",
      type: "template",
      template: {
        name: "wirdak_reminder_v2",
        language: { code: "ar" },
        components: [
          {
            type: "header",
            parameters: [{ type: "text", text: "ختمة رمضان" }],
          },
          { type: "body", parameters: [{ type: "text", text: "12" }] },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "j/AB12CD" }],
          },
        ],
      },
    },
  ]);
});

test("sendWhatsAppTemplate adds a payload for each quick-reply button", async () => {
  await sendWhatsAppTemplate("+971501234567", {
    name: "wirdak_rota_day",
    header: "ختمة رمضان",
    body: ["12"],
    quickReplies: ["r1|p|done|d1|p1", "r1|p|notYet|d1|p1"],
  });
  const template = payloads[0]!.template as { components: unknown[] };
  expect(template.components.slice(2)).toEqual([
    {
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "r1|p|done|d1|p1" }],
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "1",
      parameters: [{ type: "payload", payload: "r1|p|notYet|d1|p1" }],
    },
  ]);
});

test("sendWhatsAppButtons posts an interactive reply-buttons message", async () => {
  expect(
    await sendWhatsAppButtons("+971501234567", "هل أتممت وردك؟", [
      { id: "r1|p|done|d1|p1", title: "تمّ" },
      { id: "r1|p|notYet|d1|p1", title: "ليس بعد" },
      { id: "c", title: "ن".repeat(30) },
      { id: "d", title: "رابع" },
    ]),
  ).toBe(true);
  expect(payloads).toEqual([
    {
      messaging_product: "whatsapp",
      to: "971501234567",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "هل أتممت وردك؟" },
        action: {
          buttons: [
            { type: "reply", reply: { id: "r1|p|done|d1|p1", title: "تمّ" } },
            {
              type: "reply",
              reply: { id: "r1|p|notYet|d1|p1", title: "ليس بعد" },
            },
            { type: "reply", reply: { id: "c", title: "ن".repeat(20) } },
          ],
        },
      },
    },
  ]);
  expect(describeMessage(payloads[0])).toBe(
    `هل أتممت وردك؟\n[تمّ] r1|p|done|d1|p1\n[ليس بعد] r1|p|notYet|d1|p1\n[${"ن".repeat(20)}] c`,
  );
});

test("sendWhatsAppButtons cuts titles by code point", async () => {
  await sendWhatsAppButtons("+971501234567", "x", [
    { id: "a", title: "ن".repeat(19) + "😀😀" },
  ]);
  const interactive = payloads[0]!.interactive as {
    action: { buttons: { reply: { title: string } }[] };
  };
  const title = interactive.action.buttons[0]!.reply.title;
  expect(title).toBe("ن".repeat(19) + "😀");
  expect(title).not.toMatch(LONE_SURROGATE);
});

test("sendWhatsAppTemplate leaves out empty components", async () => {
  await sendWhatsAppTemplate("+971501234567", {
    name: "wirdak_completed_v2",
    body: [],
    buttonParam: "j/X",
  });
  const template = payloads[0]!.template as { components: { type: string }[] };
  expect(template.components.map((c) => c.type)).toEqual(["button"]);
});

test("sendWhatsAppLink posts an interactive cta_url", async () => {
  await sendWhatsAppLink("+971501234567", "تمّ التحقق ✅", {
    label: "ارجع إلى وِردك",
    url: "https://wirdak.example/j/X",
  });
  expect(payloads).toEqual([
    {
      messaging_product: "whatsapp",
      to: "971501234567",
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "تمّ التحقق ✅" },
        action: {
          name: "cta_url",
          parameters: {
            display_text: "ارجع إلى وِردك",
            url: "https://wirdak.example/j/X",
          },
        },
      },
    },
  ]);
});

test("template send failures log the Graph error code only", async () => {
  vi.stubEnv("WIRDAK_ENV", "prod");
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 132001 } }), {
          status: 400,
        }),
    ),
  );
  expect(
    await sendWhatsAppTemplate("+971501234567", {
      name: "wirdak_pin",
      body: ["123456"],
      buttonParam: "123456",
    }),
  ).toBe(false);
  const logged = error.mock.calls.flat().join(" ");
  expect(logged).toBe("whatsapp send failed: HTTP 400 code 132001");
});

test("template and link sends in dev without a token log a summary", async () => {
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await sendWhatsAppTemplate("+971501234567", {
    name: "wirdak_pin",
    body: ["123456"],
    buttonParam: "123456",
  });
  await sendWhatsAppLink("+971501234567", "نص", {
    label: "زر",
    url: "https://wirdak.example/x",
  });
  expect(sent).toEqual([]);
  const logged = log.mock.calls.flat().join(" ");
  expect(logged).toContain("wirdak_pin");
  expect(logged).toContain("123456");
  expect(logged).toContain("https://wirdak.example/x");
});

test("the verified reply links back with a button, not a raw URL", async () => {
  await sendVerified("+971501234567", "/j/AbC-12_x");
  await sendVerified("+971501234567");
  expect(payloads.map(describeMessage)).toEqual([
    "تمّ التحقق ✅ ارجع إلى وِردك لتكمل.\n[ارجع إلى وِردك] https://wirdak.example/j/AbC-12_x",
    "تمّ التحقق ✅ ارجع إلى وِردك لتكمل.\n[ارجع إلى وِردك] https://wirdak.example",
  ]);
  // the text itself never holds the link
  const body = (payloads[0]!.interactive as { body: { text: string } }).body;
  expect(body.text).not.toContain("https://");
});

test("the sign-in alert puts the sign-out link behind a button", async () => {
  await sendSignInAlert("+971501234567", false, "iPhone Safari", "tok_123");
  await sendSignInAlert("+971501234567", true, "iPhone Safari", "tok_456");
  expect(payloads.map(describeMessage)).toEqual([
    "تسجيل دخول جديد إلى وِردك من iPhone Safari. إن لم تكن أنت، اضغط «لستُ أنا» لتسجيل الخروج من الأجهزة الأخرى.\n[لستُ أنا] https://wirdak.example/signout?t=tok_123",
    "تمّ إنشاء حساب في وِردك برقمك من iPhone Safari. إن لم تكن أنت، اضغط «لستُ أنا» لتسجيل الخروج من كل الأجهزة.\n[لستُ أنا] https://wirdak.example/signout?t=tok_456",
  ]);
});

test("sendPin sends the PIN template with the PIN on its copy-code button", async () => {
  expect(await sendPin("+971501234567", "123456")).toBe(true);
  expect(payloads.map(describeMessage)).toEqual([
    "[wirdak_pin] 123456 | 123456",
  ]);
});

test("sendPin falls back to text when the template fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { type: string };
      bodies.push(payload);
      return new Response("{}", {
        status: payload.type === "template" ? 400 : 200,
      });
    }),
  );
  expect(await sendPin("+971501234567", "123456")).toBe(true);
  expect(bodies.map(describeMessage)).toEqual([
    "[wirdak_pin] 123456 | 123456",
    "رمز الدخول إلى وِردك: 123456\nهذا الرمز يُدخل جهازاً جديداً إلى حسابك. لا تعطه لأحد، فوِردك لا يطلبه منك أبداً. إن لم تطلبه الآن فتجاهل هذه الرسالة.",
  ]);
});

test("an admin PIN falls back to the admin panel wording", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body)) as { type: string };
      bodies.push(payload);
      return new Response("{}", {
        status: payload.type === "template" ? 400 : 200,
      });
    }),
  );
  expect(await sendPin("+971501234567", "123456", adminPinReply)).toBe(true);
  expect(describeMessage(bodies[1])).toMatch(
    /^رمز الدخول إلى لوحة إدارة وِردك: 123456\n/,
  );
});

test("sendPin doesn't send a second PIN when the template got no answer", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const mock = vi.fn(async () => {
    throw new TypeError("fetch failed");
  });
  vi.stubGlobal("fetch", mock);
  expect(await sendPin("+971501234567", "123456")).toBe(false);
  expect(mock).toHaveBeenCalledTimes(1);
});

test("cleanParam collapses whitespace WhatsApp refuses in parameters", () => {
  expect(cleanParam("  ختمة\n\tالوالدة     الكريمة ")).toBe(
    "ختمة الوالدة الكريمة",
  );
});

test("webhook rejects a bad signature", async () => {
  const t = convexTest(schema, modules);
  const body = JSON.stringify(sampleWebhook);
  const bad = await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: { "X-Hub-Signature-256": "sha256=00" },
    body,
  });
  expect(bad.status).toBe(401);
  const missing = await t.fetch("/whatsapp/webhook", { method: "POST", body });
  expect(missing.status).toBe(401);
  // signed with another secret
  const other = await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": `sha256=${await hmacSha256Hex("other", body)}`,
    },
    body,
  });
  expect(other.status).toBe(401);
  // nothing recorded or scheduled
  const rows = await t.run((ctx) => ctx.db.query("inboundMessages").collect());
  expect(rows).toEqual([]);
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(jobs).toEqual([]);
});

test("webhook with a valid signature schedules handleIncoming per message", async () => {
  const t = convexTest(schema, modules);
  const body = JSON.stringify(
    webhook([
      {
        from: "971501234567",
        id: "wamid.1",
        type: "text",
        text: { body: "hello" },
      },
      {
        from: "971509999999",
        id: "wamid.2",
        type: "text",
        text: { body: "hi" },
      },
    ]),
  );
  const res = await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(APP_SECRET, body)}`,
    },
    body,
  });
  expect(res.status).toBe(200);
  const jobs = await t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").collect(),
  );
  expect(jobs.map((j) => [j.name, j.args[0]])).toEqual([
    [
      "whatsapp:handleIncoming",
      {
        waMessageId: "wamid.1",
        from: "971501234567",
        text: "hello",
        profileName: "Ali",
      },
    ],
    [
      "whatsapp:handleIncoming",
      { waMessageId: "wamid.2", from: "971509999999", text: "hi" },
    ],
  ]);

  // a signed status-only callback is acknowledged and schedules nothing more
  const statusBody = JSON.stringify(webhook([], { statuses: [{}] }));
  const res2 = await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(APP_SECRET, statusBody)}`,
    },
    body: statusBody,
  });
  expect(res2.status).toBe(200);
});

test("webhook ignores messages sent to another business number", async () => {
  const t = convexTest(schema, modules);
  const signed = async (payload: unknown) => {
    const body = JSON.stringify(payload);
    return await t.fetch("/whatsapp/webhook", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(APP_SECRET, body)}`,
      },
      body,
    });
  };
  const elsewhere = webhook(
    [
      {
        from: "971501234567",
        id: "wamid.o",
        type: "text",
        text: { body: "x" },
      },
    ],
    { metadata: { display_phone_number: "1", phone_number_id: "999" } },
  );
  expect((await signed(elsewhere)).status).toBe(200);
  const jobs = () =>
    t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(await jobs()).toEqual([]);

  // without WHATSAPP_PHONE_NUMBER_ID there's nothing to compare against
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
  expect((await signed(elsewhere)).status).toBe(200);
  expect(await jobs()).toHaveLength(1);
});

test("webhook verify handshake echoes the challenge only for the right token", async () => {
  const t = convexTest(schema, modules);
  const ok = await t.fetch(
    "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345",
  );
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("12345");

  const wrong = await t.fetch(
    "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345",
  );
  expect(wrong.status).toBe(403);
  const mode = await t.fetch(
    "/whatsapp/webhook?hub.mode=unsubscribe&hub.verify_token=test-verify-token&hub.challenge=1",
  );
  expect(mode.status).toBe(403);

  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
  const unset = await t.fetch(
    "/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1",
  );
  expect(unset.status).toBe(403);
});

/** A rota khatma «ختمة» with join code JNC234 and nobody listed. */
async function insertRotaKhatma(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const personId = await ctx.db.insert("people", {
      phone: "+971500000001",
      displayName: "المنظم",
      verifiedAt: 0,
      timeZone: "Asia/Dubai",
      lastSeenAt: 0,
    });
    return await ctx.db.insert("khatmas", {
      name: "ختمة",
      schedule: "none",
      grace: DEFAULT_GRACE.none,
      creatorPersonId: personId,
      inviteCode: "invite",
      joinCode: "JNC234",
      completedRounds: 0,
      createdAt: 0,
      kind: "rota",
      rota: {
        days: { kind: "daily" },
        firstDate: "2027-01-16",
        endDate: null,
        timeZone: "Asia/Dubai",
        messages: {
          dayAt: 480,
          reminder: { at: 960, on: true },
          unread: { at: 1140, on: false },
          summary: { at: 1260, on: false },
        },
        pausedAt: null,
        pauseDates: [],
        archivedAt: null,
      },
    });
  });
}

test("simulateIncoming passes a button tap and profile name through", async () => {
  const t = convexTest(schema, modules);
  const khatmaId = await insertRotaKhatma(t);
  await t.action(internal.dev.simulateIncoming, {
    from: "971501234567",
    text: "أتممت",
    payload: "r1|p|done|d1|p1",
  });
  // a tap: it reaches the rota (which can't place it), never the sign-in path
  expect(sent.map((s) => s.body)).toEqual([helpText]);
  // and the profile name arrives with a join message
  await t.action(internal.dev.simulateIncoming, {
    from: "971501234567",
    text: joinText("ختمة", "JNC234"),
    profileName: "سعيد",
  });
  expect(
    await t.run((ctx) => ctx.db.query("rotaJoinRequests").collect()),
  ).toMatchObject([{ khatmaId, profileName: "سعيد" }]);
});

test("simulateIncoming refuses to run outside dev", async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv("WIRDAK_ENV", "prod");
  await expect(
    t.action(internal.dev.simulateIncoming, {
      from: "971501234567",
      text: "hi",
    }),
  ).rejects.toThrow(/dev/);
  expect(
    await t.run((ctx) => ctx.db.query("inboundMessages").collect()),
  ).toEqual([]);
});

// ---------------------------------------------------------------------------
// Relay (production → staging)

const RELAY_SECRET = "test-relay-secret-0123456789abcdef";
const RELAY_URL = "https://staging.example.convex.site/whatsapp/relay";
const relayed = {
  waMessageId: "wamid.r1",
  from: "971501234567",
  text: "رمز التحقق في وِردك: ZZZZ-2222-ZZ",
};

/** Staging: no Meta webhook secrets, only the relay secret. */
function asStaging() {
  vi.stubEnv("WHATSAPP_APP_SECRET", "");
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
  vi.stubEnv("WHATSAPP_RELAY_SECRET", RELAY_SECRET);
}

async function relayPost(
  t: ReturnType<typeof convexTest>,
  body: string,
  opts: { secret?: string; timestamp?: number; signature?: string | null } = {},
) {
  const timestamp = String(opts.timestamp ?? Date.now());
  const headers: Record<string, string> = {
    "X-Wirdak-Relay-Timestamp": timestamp,
  };
  const signature =
    opts.signature === undefined
      ? await relaySignature(opts.secret ?? RELAY_SECRET, timestamp, body)
      : opts.signature;
  if (signature !== null) headers["X-Wirdak-Relay-Signature"] = signature;
  return await t.fetch("/whatsapp/relay", { method: "POST", headers, body });
}

test("relay endpoint takes a signed, fresh message on staging", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  const res = await relayPost(t, JSON.stringify(relayed));
  expect(res.status).toBe(200);
  // no pending code here: production must answer
  expect(await res.json()).toEqual({ handled: false });
  expect(sent).toEqual([]);

  // a replay of the same message is taken (and stays silent)
  const again = await relayPost(t, JSON.stringify(relayed));
  expect(await again.json()).toEqual({ handled: true });
  expect(sent).toEqual([]);
});

test("relay endpoint refuses bad, stale, or foreign signatures", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  const body = JSON.stringify(relayed);
  const refused = [
    await relayPost(t, body, { signature: null }),
    await relayPost(t, body, { signature: "sha256=00" }),
    await relayPost(t, body, { secret: "other" }),
    // Meta's signature scheme with the relay secret is not a relay signature
    await relayPost(t, body, {
      signature: `sha256=${await hmacSha256Hex(RELAY_SECRET, body)}`,
    }),
    await relayPost(t, body, { timestamp: NOW - 5 * 60_000 - 1 }),
    await relayPost(t, body, { timestamp: NOW + 5 * 60_000 + 1 }),
  ];
  expect(refused.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
  // a signature for one body doesn't cover another
  const timestamp = String(NOW);
  const forged = await t.fetch("/whatsapp/relay", {
    method: "POST",
    headers: {
      "X-Wirdak-Relay-Timestamp": timestamp,
      "X-Wirdak-Relay-Signature": await relaySignature(
        RELAY_SECRET,
        timestamp,
        body,
      ),
    },
    body: JSON.stringify({ ...relayed, from: "971509999999" }),
  });
  expect(forged.status).toBe(401);
  expect(
    await t.run((ctx) => ctx.db.query("inboundMessages").collect()),
  ).toEqual([]);
});

test("relay endpoint is closed on a deployment Meta calls", async () => {
  // production: has the app secret, so a relay secret alone opens nothing
  vi.stubEnv("WHATSAPP_RELAY_SECRET", RELAY_SECRET);
  const t = convexTest(schema, modules);
  expect((await relayPost(t, JSON.stringify(relayed))).status).toBe(401);
  // and a deployment with neither secret is closed too
  vi.stubEnv("WHATSAPP_APP_SECRET", "");
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "");
  expect((await relayPost(t, JSON.stringify(relayed))).status).toBe(401);
  expect(
    await t.run((ctx) => ctx.db.query("inboundMessages").collect()),
  ).toEqual([]);
});

test("relay endpoint never matches a button tap to a sign-in code", async () => {
  asStaging();
  // staging itself, so a tap marked for staging is this deployment's
  vi.stubEnv("WIRDAK_ENV", "staging");
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("verifications", {
      codeNormalized: "ZZZZ2222ZZ",
      secretHash: "hash",
      displayName: "علي",
      status: "pending",
      pinAttempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 600_000,
    }),
  );
  // a tap whose title holds a valid pending code
  const res = await relayPost(
    t,
    JSON.stringify({ ...relayed, payload: "r1|s|done|d1|p1" }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ handled: true });
  // the rota's answer to a tap it can't place, never a sign-in reply
  expect(sent.map((s) => s.body)).toEqual([helpText]);
  const rows = await t.run((ctx) => ctx.db.query("verifications").collect());
  expect(rows.map((r) => r.status)).toEqual(["pending"]);

  // the same text without a payload is a sign-in message and matches
  const typed = await relayPost(
    t,
    JSON.stringify({ ...relayed, waMessageId: "wamid.r2" }),
  );
  expect(await typed.json()).toEqual({ handled: true });
  expect(sent).toHaveLength(2);
  expect(describeMessage(payloads[1])).toMatch(/^تمّ التحقق/);
});

test("relay endpoint takes a join for a staging khatma, with the profile name", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  const khatmaId = await insertRotaKhatma(t);
  const res = await relayPost(
    t,
    JSON.stringify({
      ...relayed,
      text: joinText("ختمة", "JNC234"),
      profileName: "خالد",
    }),
  );
  expect(await res.json()).toEqual({ handled: true });
  const requests = await t.run((ctx) =>
    ctx.db.query("rotaJoinRequests").collect(),
  );
  expect(requests).toMatchObject([
    { khatmaId, phone: "+971501234567", profileName: "خالد" },
  ]);
  expect(sent.map((s) => s.body)).toEqual([`*ختمة*\n${notOnListText}`]);
});

test("relay endpoint records relayed media as a reply and answers nothing", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  const khatmaId = await insertRotaKhatma(t);
  const participantId = await t.run((ctx) =>
    ctx.db.insert("rotaParticipants", {
      khatmaId,
      name: "سارة",
      phone: "+971501234567",
      personId: null,
      addedAt: 0,
      removedAt: null,
      joinedAt: 0,
      silentDays: 3,
      silencedAt: 1,
    }),
  );
  const res = await relayPost(
    t,
    JSON.stringify({ ...relayed, text: "", media: true }),
  );
  expect(res.status).toBe(200);
  // taken, so production stays quiet; and nothing is sent from here either
  expect(await res.json()).toEqual({ handled: true });
  expect(sent).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(participantId))).toMatchObject({
    lastReplyAt: NOW,
    silentDays: 0,
    silencedAt: null,
  });
  expect(await t.run((ctx) => ctx.db.query("waContacts").collect())).toEqual([
    expect.objectContaining({ phone: "+971501234567", lastInboundAt: NOW }),
  ]);
  // media never reaches sign-in, and a redelivery is taken the same way
  const again = await relayPost(
    t,
    JSON.stringify({ ...relayed, text: "", media: true }),
  );
  expect(await again.json()).toEqual({ handled: true });
});

test("relay endpoint rejects malformed messages", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  for (const body of [
    "not json",
    JSON.stringify({ ...relayed, from: "+971501234567" }),
    JSON.stringify({ ...relayed, waMessageId: "" }),
    // production relays only the first 500 characters
    JSON.stringify({ ...relayed, text: "x".repeat(501) }),
    JSON.stringify({ waMessageId: "wamid.x", from: "971501234567" }),
  ]) {
    expect((await relayPost(t, body)).status).toBe(400);
  }
  expect((await relayPost(t, "x".repeat(8193))).status).toBe(413);
});

test("the Meta webhook is closed on staging", async () => {
  asStaging();
  const t = convexTest(schema, modules);
  const body = JSON.stringify(sampleWebhook);
  const res = await t.fetch("/whatsapp/webhook", {
    method: "POST",
    headers: {
      "X-Hub-Signature-256": `sha256=${await hmacSha256Hex(RELAY_SECRET, body)}`,
    },
    body,
  });
  expect(res.status).toBe(401);
});

test("relayIncoming signs the message and reads the answer", async () => {
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", RELAY_SECRET);
  const calls: { url: string; headers: Headers; body: string }[] = [];
  let answer: Response = Response.json({ handled: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: new Headers(init.headers),
        body: String(init.body),
      });
      return answer;
    }),
  );
  expect(await relayIncoming(relayed)).toBe(true);
  const call = calls[0]!;
  expect(call.url).toBe(RELAY_URL);
  expect(JSON.parse(call.body)).toEqual(relayed);
  expect(call.headers.get("X-Wirdak-Relay-Timestamp")).toBe(String(NOW));
  expect(call.headers.get("X-Wirdak-Relay-Signature")).toBe(
    await relaySignature(RELAY_SECRET, String(NOW), call.body),
  );
  // the message carries the person's text, never any of our secrets
  expect(call.body).not.toContain(RELAY_SECRET);
  expect(call.body).not.toContain(APP_SECRET);
  expect(call.body).not.toContain("test-access-token");

  // only what staging scans leaves production
  await relayIncoming({ ...relayed, text: "x".repeat(4096) });
  expect(JSON.parse(calls.at(-1)!.body).text).toBe("x".repeat(500));

  for (const res of [
    Response.json({ handled: false }),
    Response.json({ handled: "yes" }),
    new Response("oops", { status: 200 }),
    new Response(null, { status: 401 }),
    new Response(null, { status: 500 }),
  ]) {
    answer = res;
    expect(await relayIncoming(relayed)).toBe(false);
  }
});

test("relayIncoming gives up after ten seconds", async () => {
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", RELAY_SECRET);
  let called!: () => void;
  const fetching = new Promise<void>((resolve) => (called = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          called();
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ),
  );
  let settled = false;
  const pending = relayIncoming(relayed).finally(() => (settled = true));
  await fetching;
  await vi.advanceTimersByTimeAsync(9_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(false);
});

test("relayIncoming stays off unless this deployment is Meta's, over https", async () => {
  const mock = vi.fn(async () => Response.json({ handled: true }));
  vi.stubGlobal("fetch", mock);
  // no relay configured
  expect(await relayIncoming(relayed)).toBe(false);
  // staging never relays onward, so two deployments can't loop
  vi.stubEnv("WHATSAPP_RELAY_URL", RELAY_URL);
  asStaging();
  expect(await relayIncoming(relayed)).toBe(false);
  // a short relay secret counts as unset, on both sides
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "too-short");
  expect(await relayIncoming(relayed)).toBe(false);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", RELAY_SECRET);
  // plain http is refused outside dev
  vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
  vi.stubEnv("WIRDAK_ENV", "prod");
  vi.stubEnv("WHATSAPP_RELAY_URL", "http://staging.example/whatsapp/relay");
  expect(await relayIncoming(relayed)).toBe(false);
  expect(mock).not.toHaveBeenCalled();
});

test("whatsappConfigured: Meta secrets on production, the relay secret on staging", () => {
  expect(whatsappConfigured()).toBe(true);
  vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "");
  expect(whatsappConfigured()).toBe(false);
  asStaging();
  expect(whatsappConfigured()).toBe(true);
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
  expect(whatsappConfigured()).toBe(false);
  vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "test-access-token");
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "too-short");
  expect(whatsappConfigured()).toBe(false);
  vi.stubEnv("WHATSAPP_RELAY_SECRET", "");
  expect(whatsappConfigured()).toBe(false);
});

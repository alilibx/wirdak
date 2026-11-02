import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { reporterHash } from "./help";
import { hmacSha256Hex, timingSafeEqual } from "./lib/crypto";
import { cleanContext } from "./lib/help";
import {
  adminSiteUrl,
  env,
  inboundSource,
  isDev,
  parseIncoming,
  parseRelayed,
  RELAY_MAX_SKEW_MS,
  RELAY_SIGNATURE_HEADER,
  RELAY_TIMESTAMP_HEADER,
  relaySecret,
  relaySignature,
  siteUrl,
  takeIncoming,
} from "./whatsapp";

const http = httpRouter();

// ---------------------------------------------------------------------------
// POST /api/verification/start

const DEV_ORIGIN = "http://localhost:5173";
const MAX_START_BODY = 4096;
const MAX_DISPLAY_NAME_INPUT = 1000;
const MAX_CLIENT_KEY = 200;
const MAX_IP = 64;

function allowedOrigin(origin: string): boolean {
  const site = siteUrl();
  return (isDev() && origin === DEV_ORIGIN) || (site !== "" && origin === site);
}

const ADMIN_DEV_ORIGIN = "http://localhost:5174";

/** The admin panel's origin. Kept apart from `allowedOrigin`: each route trusts one app. */
function allowedAdminOrigin(origin: string): boolean {
  const admin = adminSiteUrl();
  return (
    (isDev() && origin === ADMIN_DEV_ORIGIN) ||
    (admin !== "" && origin === admin)
  );
}

function corsHeaders(
  origin: string | null,
  allowed: (origin: string) => boolean = allowedOrigin,
): Record<string, string> {
  return origin !== null && allowed(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : { Vary: "Origin" };
}

function json(
  status: number,
  body: unknown,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

/**
 * The caller's IP: Convex's request metadata, else the first address in
 * `X-Forwarded-For`. Best effort only: the local backend derives `meta.ip`
 * from a client-supplied `X-Forwarded-For` too, so the global limit is the
 * hard ceiling.
 */
async function callerIp(ctx: ActionCtx, req: Request): Promise<string | null> {
  const meta = await ctx.meta.getRequestMetadata().catch(() => null);
  const ip =
    meta?.ip ?? req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  // Bounded: it becomes part of a rate-limit key.
  return ip ? ip.slice(0, MAX_IP) : null;
}

/**
 * The request body as text, or `null` once it is known to exceed `maxBytes`:
 * from the `Content-Length` header without reading anything, else by reading
 * the stream and stopping as soon as the running total crosses the cap.
 */
async function readCappedText(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(req.headers.get("Content-Length") ?? Number.NaN);
  if (declared > maxBytes) return null;
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const START_ERROR_STATUS = {
  invalid_name: 400,
  rate_limited: 429,
  maintenance: 503,
  whatsapp_not_configured: 503,
} as const;

http.route({
  path: "/api/verification/start",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => {
    const origin = req.headers.get("Origin");
    if (origin === null || !allowedOrigin(origin)) {
      return new Response(null, { status: 403, headers: corsHeaders(null) });
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

http.route({
  path: "/api/verification/start",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const origin = req.headers.get("Origin");
    if (origin !== null && !allowedOrigin(origin)) {
      return json(403, { error: "forbidden_origin" }, corsHeaders(null));
    }
    const headers = corsHeaders(origin);

    const raw = await readCappedText(req, MAX_START_BODY);
    if (raw === null) return json(413, { error: "too_large" }, headers);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const {
      displayName = "",
      clientKey,
      returnPath,
    } = (body ?? {}) as Record<string, unknown>;
    // A new number gives its name when it claims, so the name here is optional.
    if (
      typeof displayName !== "string" ||
      typeof clientKey !== "string" ||
      displayName.length > MAX_DISPLAY_NAME_INPUT ||
      clientKey.length === 0 ||
      clientKey.length > MAX_CLIENT_KEY
    ) {
      return json(400, { error: "bad_request" }, headers);
    }

    const res = await ctx.runAction(internal.verification.startInternal, {
      displayName,
      clientKey,
      ip: await callerIp(ctx, req),
      // Optional and never refused: a bad path just links to the home page.
      ...(typeof returnPath === "string" ? { returnPath } : {}),
    });
    if ("error" in res) {
      return json(START_ERROR_STATUS[res.error], { error: res.error }, headers);
    }
    return json(200, res, headers);
  }),
});

// ---------------------------------------------------------------------------
// POST /api/admin/verification/start: the admin panel's sign-in (spec 4.2).
// Only the admin origin may call it, and it works during maintenance.

http.route({
  path: "/api/admin/verification/start",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => {
    const origin = req.headers.get("Origin");
    if (origin === null || !allowedAdminOrigin(origin)) {
      return new Response(null, { status: 403, headers: corsHeaders(null) });
    }
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin, allowedAdminOrigin),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }),
});

http.route({
  path: "/api/admin/verification/start",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const origin = req.headers.get("Origin");
    // Unlike the website's route, a request with no Origin is refused too:
    // the admin panel is only ever called from its own pages.
    if (origin === null || !allowedAdminOrigin(origin)) {
      return json(403, { error: "forbidden_origin" }, corsHeaders(null));
    }
    const headers = corsHeaders(origin, allowedAdminOrigin);

    const raw = await readCappedText(req, MAX_START_BODY);
    if (raw === null) return json(413, { error: "too_large" }, headers);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const { clientKey } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof clientKey !== "string" ||
      clientKey.length === 0 ||
      clientKey.length > MAX_CLIENT_KEY
    ) {
      return json(400, { error: "bad_request" }, headers);
    }

    const res = await ctx.runAction(internal.verification.startInternal, {
      displayName: "",
      clientKey,
      ip: await callerIp(ctx, req),
      surface: "admin",
    });
    if ("error" in res) {
      return json(START_ERROR_STATUS[res.error], { error: res.error }, headers);
    }
    return json(200, res, headers);
  }),
});

// ---------------------------------------------------------------------------
// Help requests from signed-out visitors (plan 3 spec 3.5). Over HTTP so the
// per-IP limits can read the IP. Website origin only.

const MAX_HELP_BODY = 8192;
const MIN_REPORTER_TOKEN = 20;
const MAX_REPORTER_TOKEN = 200;

const HELP_ERROR_STATUS: Record<string, number> = {
  rate_limited: 429,
  empty: 400,
  bad_file: 400,
  too_long: 400,
  bad_request: 400,
};

function helpPreflight(path: string) {
  http.route({
    path,
    method: "OPTIONS",
    handler: httpAction(async (_ctx, req) => {
      const origin = req.headers.get("Origin");
      if (origin === null || !allowedOrigin(origin)) {
        return new Response(null, { status: 403, headers: corsHeaders(null) });
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }),
  });
}

/** The JSON body of a help call from the website, or the response that refuses it. */
async function readHelpBody(
  req: Request,
): Promise<
  | { body: Record<string, unknown>; headers: Record<string, string> }
  | { refused: Response }
> {
  const origin = req.headers.get("Origin");
  if (origin === null || !allowedOrigin(origin)) {
    return {
      refused: json(403, { error: "forbidden_origin" }, corsHeaders(null)),
    };
  }
  const headers = corsHeaders(origin);
  const raw = await readCappedText(req, MAX_HELP_BODY);
  if (raw === null) {
    return { refused: json(413, { error: "too_large" }, headers) };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const token = (body as Record<string, unknown> | null)?.reporterToken;
  if (
    typeof body !== "object" ||
    body === null ||
    typeof token !== "string" ||
    token.length < MIN_REPORTER_TOKEN ||
    token.length > MAX_REPORTER_TOKEN
  ) {
    return { refused: json(400, { error: "bad_request" }, headers) };
  }
  return { body: body as Record<string, unknown>, headers };
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

helpPreflight("/api/help/upload-url");
http.route({
  path: "/api/help/upload-url",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const read = await readHelpBody(req);
    if ("refused" in read) return read.refused;
    const requestId = optionalString(read.body.requestId);
    let res: string | { error: "rate_limited" | "not_found" };
    try {
      res = await ctx.runMutation(internal.help.uploadUrlInternal, {
        reporterHash: await reporterHash(read.body.reporterToken as string),
        ip: await callerIp(ctx, req),
        // A malformed id fails the mutation's validator: a bad request.
        ...(requestId !== null ? { requestId: requestId as never } : {}),
      });
    } catch {
      return json(400, { error: "bad_request" }, read.headers);
    }
    if (typeof res !== "string") {
      return json(
        res.error === "not_found" ? 404 : 429,
        { error: res.error },
        read.headers,
      );
    }
    return json(200, { uploadUrl: res }, read.headers);
  }),
});

helpPreflight("/api/help/request");
http.route({
  path: "/api/help/request",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const read = await readHelpBody(req);
    if ("refused" in read) return read.refused;
    const { body, headers } = read;
    const voiceSeconds =
      typeof body.voiceSeconds === "number" ? body.voiceSeconds : null;
    let res: { requestId: string } | { error: string };
    try {
      res = await ctx.runMutation(internal.help.createAsVisitorInternal, {
        reporterHash: await reporterHash(body.reporterToken as string),
        ip: await callerIp(ctx, req),
        inviteCode: optionalString(body.inviteCode)?.slice(0, 40) ?? null,
        text: optionalString(body.text)?.slice(0, 4000) ?? null,
        // A malformed id fails the mutation's validator: a bad request.
        screenshotId: optionalString(body.screenshotId) as never,
        voiceId: optionalString(body.voiceId) as never,
        voiceSeconds,
        context: cleanContext(body.context),
      });
    } catch {
      return json(400, { error: "bad_request" }, headers);
    }
    if ("error" in res) {
      return json(HELP_ERROR_STATUS[res.error] ?? 400, res, headers);
    }
    return json(200, res, headers);
  }),
});

// ---------------------------------------------------------------------------
// WhatsApp Cloud API webhook

http.route({
  path: "/whatsapp/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const params = new URL(req.url).searchParams;
    const expected = env("WHATSAPP_VERIFY_TOKEN");
    const token = params.get("hub.verify_token");
    const challenge = params.get("hub.challenge");
    if (
      params.get("hub.mode") !== "subscribe" ||
      expected === undefined ||
      token === null ||
      challenge === null ||
      !timingSafeEqual(token, expected)
    ) {
      return new Response("forbidden", { status: 403 });
    }
    return new Response(challenge, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }),
});

http.route({
  path: "/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = env("WHATSAPP_APP_SECRET");
    const signature = req.headers.get("X-Hub-Signature-256");
    // Read the raw body exactly once: the signature covers these bytes.
    const raw = await req.text();
    if (secret === undefined) {
      console.error("whatsapp webhook: WHATSAPP_APP_SECRET is not set");
      return new Response(null, { status: 401 });
    }
    const expected = `sha256=${await hmacSha256Hex(secret, raw)}`;
    if (signature === null || !timingSafeEqual(signature, expected)) {
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // Signed but unparseable: acknowledge so Meta doesn't retry it forever.
      console.error("whatsapp webhook: signed body is not JSON");
      return new Response(null, { status: 200 });
    }
    // Only messages sent to our own business number.
    const ours = env("WHATSAPP_PHONE_NUMBER_ID");
    for (const message of parseIncoming(payload, ours)) {
      await ctx.scheduler.runAfter(
        0,
        internal.whatsapp.handleIncoming,
        message,
      );
    }
    return new Response(null, { status: 200 });
  }),
});

// ---------------------------------------------------------------------------
// POST /whatsapp/relay: production relaying a message it can't place, with
// its button payload and profile name (`relayIncoming` in whatsapp.ts). Open
// only on a deployment whose messages come from the relay (staging), never on
// one Meta calls (production).

/**
 * A relayed message is at most 500 characters (each at most 6 bytes as JSON),
 * its IDs, a 256-character payload and a 60-character profile name.
 */
const MAX_RELAY_BODY = 8192;

http.route({
  path: "/whatsapp/relay",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = relaySecret();
    if (inboundSource() !== "relay" || secret === undefined) {
      return new Response(null, { status: 401 });
    }
    const timestamp = req.headers.get(RELAY_TIMESTAMP_HEADER) ?? "";
    const signature = req.headers.get(RELAY_SIGNATURE_HEADER);
    const raw = await readCappedText(req, MAX_RELAY_BODY);
    if (raw === null) return new Response(null, { status: 413 });
    if (
      !/^\d{1,15}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > RELAY_MAX_SKEW_MS ||
      signature === null ||
      !timingSafeEqual(signature, await relaySignature(secret, timestamp, raw))
    ) {
      return new Response(null, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    const message = parseRelayed(payload);
    if (message === null) return json(400, { error: "bad_request" }, {});
    // The same routing as production's (sign-in, then rota), sent inline, not
    // scheduled: a scheduled reply would store a PIN in the clear in
    // `_scheduled_functions`.
    const outcome = await takeIncoming(ctx, message);
    return json(200, { handled: outcome === "taken" }, {});
  }),
});

// ---------------------------------------------------------------------------
// GET /api/preview: the data behind a WhatsApp link preview. Called only by the
// Vercel function that serves /j/:code; it vouches for the visitor's IP.

http.route({
  path: "/api/preview",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const expected = env("PREVIEW_SECRET");
    const secret = req.headers.get("X-Preview-Secret");
    if (
      expected === undefined ||
      expected === "" ||
      secret === null ||
      !timingSafeEqual(secret, expected)
    ) {
      return new Response(null, { status: 401 });
    }

    // Bounded: it becomes part of a rate-limit key.
    const ip = (req.headers.get("X-Visitor-Ip") ?? "unknown").slice(0, MAX_IP);
    if (!(await ctx.runMutation(internal.preview.allowHit, { ip }))) {
      return json(429, { error: "rate_limited" }, {});
    }

    const params = new URL(req.url).searchParams;
    const found = await ctx.runQuery(internal.preview.lookup, {
      inviteCode: (params.get("code") ?? "").slice(0, MAX_CLIENT_KEY),
      from: params.get("from")?.slice(0, MAX_CLIENT_KEY) ?? null,
    });
    if (found === null) return json(404, { error: "not_found" }, {});
    return json(200, found, {});
  }),
});

export default http;

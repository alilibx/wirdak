import type { CaptureResult, Properties } from "posthog-js";

// `/j/<inviteCode>` anywhere in a string. Replacing `/j/:inviteCode` again changes nothing.
const INVITE_PATH_RE = /\/j\/[^/?#\s"']+/g;
// A whole string that is one URL or path: free text that only starts like one keeps its `?`.
const URL_OR_PATH_RE = /^(?:[a-z][a-z\d+.-]*:\/\/|\/)\S*$/i;

/**
 * A URL or path without what is private in it: the query string and fragment go (the home-screen
 * app's `?h=<sign-in token>`), and `/j/<inviteCode>` becomes `/j/:inviteCode`. Any other string
 * only has its invite paths replaced, which covers autocapture's `$elements_chain`.
 */
export function scrubUrl(value: string): string {
  const bare = URL_OR_PATH_RE.test(value)
    ? value.replace(/[?#].*$/s, "")
    : value;
  return bare.replace(INVITE_PATH_RE, "/j/:inviteCode");
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubUrl(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value !== null && typeof value === "object") {
    return scrubProperties(value as Properties);
  }
  return value;
}

function scrubProperties(properties: Properties): Properties {
  const out: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    // Keys too: `$heatmap_data` is keyed by page URL.
    out[scrubUrl(key)] = scrubValue(value);
  }
  return out;
}

/**
 * PostHog's `before_send`: every string in an event's properties, `$set` and `$set_once` goes
 * through `scrubUrl`. Replay snapshots are left alone, since walking them costs a frame each.
 */
export function scrubEvent(event: CaptureResult): CaptureResult {
  if (event.event === "$snapshot") return event;
  return {
    ...event,
    properties: scrubProperties(event.properties),
    ...(event.$set ? { $set: scrubProperties(event.$set) } : {}),
    ...(event.$set_once ? { $set_once: scrubProperties(event.$set_once) } : {}),
  };
}

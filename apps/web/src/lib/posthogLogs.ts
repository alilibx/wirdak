import posthog from "posthog-js";
import { scrubEvent, scrubUrl } from "./analyticsScrub";

type LogAttributes = Record<string, string | number | boolean>;

let logsEnabled = false;

/**
 * Initializes the browser SDK's native OTLP log transport. Console capture deliberately remains
 * disabled, so only records emitted through the helpers below leave this app.
 */
export function initializePostHogLogging(): void {
  const token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN;
  if (!token) {
    if (import.meta.env.DEV) {
      console.error(
        new Error(
          "VITE_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_PROJECT_TOKEN is configured",
        ),
      );
    }
    return;
  }

  const host = import.meta.env.VITE_POSTHOG_HOST;
  posthog.init(token, {
    ...(host ? { api_host: host } : {}),
    // Runs before `HandoffGate` takes `?h=<token>` out of the address bar, so the scrub matters
    // from the very first pageview.
    before_send: scrubEvent,
    logs: {
      serviceName: "wirdak-web",
      environment: import.meta.env.MODE,
    },
  });
  logsEnabled = true;

  posthogLog.info("web application started", { runtime: "browser" });
}

/**
 * PostHog Logs adds the raw page URL as `url.full`; an attribute of that name replaces it, so
 * every record carries the scrubbed one instead.
 */
function withUrl(attributes: LogAttributes): LogAttributes {
  return { ...attributes, "url.full": scrubUrl(window.location.href) };
}

/** The only logger whose records this integration exports to PostHog Logs. */
export const posthogLog = {
  info(message: string, attributes: LogAttributes): void {
    if (logsEnabled) posthog.logger.info(message, withUrl(attributes));
  },
  error(message: string, attributes: LogAttributes): void {
    if (logsEnabled) posthog.logger.error(message, withUrl(attributes));
  },
};

import posthog from "posthog-js";

/**
 * Tells PostHog the server refused a new khatma, with its code (`rota_cap`, `rate_limited`, ...).
 * A network failure (no code) is not a refusal, and neither is a dead sign-in: the person signs
 * in again and the create goes on.
 */
export function captureCreateBlocked(
  kind: "pool" | "rota",
  code: string | null,
): void {
  if (code === null || code === "not_signed_in") return;
  posthog.capture("khatma_create_blocked", { kind, code });
}

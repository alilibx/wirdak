import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import posthog from "posthog-js";
import { useEffect } from "react";
import { useSessionToken } from "./session";

/**
 * Tells PostHog who is signed in, so one person's sessions link up across sign-outs and devices.
 * The id is `me.analyticsId`, a hash: never the phone number, the name or the Convex id. Once
 * signed out, `reset` starts a new anonymous id, so the next person on this phone is not linked
 * to the last. Every way of signing in or out changes the stored token, so this one place
 * covers them all.
 */
export function AnalyticsIdentity() {
  const sessionToken = useSessionToken();
  const me = useQuery(api.people.me, { sessionToken });

  useEffect(() => {
    if (me) {
      if (posthog.get_distinct_id() !== me.analyticsId) {
        posthog.identify(me.analyticsId);
      }
    } else if (sessionToken === undefined && posthog._isIdentified()) {
      posthog.reset();
    }
  }, [me, sessionToken]);

  return null;
}

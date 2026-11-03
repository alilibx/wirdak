import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsIdentity } from "./AnalyticsIdentity";

const m = vi.hoisted(() => ({
  token: undefined as string | undefined,
  me: undefined as
    { rotaAllowed: boolean; analyticsId: string } | null | undefined,
  distinctId: "anon",
  identified: false,
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("./session", () => ({ useSessionToken: () => m.token }));
vi.mock("convex/react", () => ({ useQuery: () => m.me }));
vi.mock("posthog-js", () => ({
  default: {
    get_distinct_id: () => m.distinctId,
    _isIdentified: () => m.identified,
    identify: m.identify,
    reset: m.reset,
  },
}));

const ME = { rotaAllowed: false, analyticsId: "hash-of-person" };

describe("AnalyticsIdentity", () => {
  beforeEach(() => {
    m.token = undefined;
    m.me = undefined;
    m.distinctId = "anon";
    m.identified = false;
    m.identify.mockReset();
    m.reset.mockReset();
  });

  it("identifies a signed-in person by their analytics id", () => {
    m.token = "tok";
    m.me = ME;
    render(<AnalyticsIdentity />);
    expect(m.identify).toHaveBeenCalledWith("hash-of-person");
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("does not identify again when PostHog already knows them", () => {
    m.token = "tok";
    m.me = ME;
    m.distinctId = "hash-of-person";
    m.identified = true;
    render(<AnalyticsIdentity />);
    expect(m.identify).not.toHaveBeenCalled();
  });

  it("waits while the answer is loading", () => {
    m.token = "tok";
    render(<AnalyticsIdentity />);
    expect(m.identify).not.toHaveBeenCalled();
    expect(m.reset).not.toHaveBeenCalled();
  });

  it("resets after a sign-out, so the next person on the phone starts fresh", () => {
    m.token = "tok";
    m.me = ME;
    const { rerender } = render(<AnalyticsIdentity />);
    m.token = undefined;
    m.me = null;
    m.identified = true;
    rerender(<AnalyticsIdentity />);
    expect(m.reset).toHaveBeenCalledTimes(1);
  });

  it("leaves an anonymous visitor's id alone", () => {
    m.me = null;
    render(<AnalyticsIdentity />);
    expect(m.reset).not.toHaveBeenCalled();
    expect(m.identify).not.toHaveBeenCalled();
  });

  it("waits for a dead token to be cleared before resetting", () => {
    m.token = "dead";
    m.me = null;
    m.identified = true;
    render(<AnalyticsIdentity />);
    expect(m.reset).not.toHaveBeenCalled();
  });
});

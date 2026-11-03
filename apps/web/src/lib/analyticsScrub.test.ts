import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import { scrubEvent, scrubUrl } from "./analyticsScrub";

describe("scrubUrl", () => {
  it.each([
    ["https://wirdak.app/?h=SECRET", "https://wirdak.app/"],
    ["https://wirdak.app/j/ABC123", "https://wirdak.app/j/:inviteCode"],
    [
      "https://wirdak.app/j/ABC123/settings?x=1#top",
      "https://wirdak.app/j/:inviteCode/settings",
    ],
    ["/j/ABC123/setup", "/j/:inviteCode/setup"],
    ["/?help=42", "/"],
    ["/new/rota", "/new/rota"],
    ["https://wirdak.app/j/:inviteCode", "https://wirdak.app/j/:inviteCode"],
  ])("%s becomes %s", (raw, scrubbed) => {
    expect(scrubUrl(raw)).toBe(scrubbed);
  });

  it("replaces invite paths inside other strings and keeps the rest", () => {
    expect(scrubUrl('a:href="/j/ABC123"nth-child="1"')).toBe(
      'a:href="/j/:inviteCode"nth-child="1"',
    );
    expect(scrubUrl("rota")).toBe("rota");
    expect(scrubUrl("what? yes")).toBe("what? yes");
  });
});

describe("scrubEvent", () => {
  const event = (over: Partial<CaptureResult>): CaptureResult => ({
    uuid: "u",
    event: "$pageview",
    properties: {},
    ...over,
  });

  it("scrubs every URL in the properties, $set and $set_once, nested ones too", () => {
    const scrubbed = scrubEvent(
      event({
        properties: {
          $current_url: "https://wirdak.app/?h=SECRET",
          $pathname: "/j/ABC123",
          $referrer: "https://wirdak.app/j/ABC123/settings",
          $elements: [{ attr__href: "/j/ABC123", tag_name: "a" }],
          kind: "rota",
          count: 3,
          ok: true,
          nothing: null,
        },
        $set: { $current_url: "https://wirdak.app/j/ABC123?h=SECRET" },
        $set_once: { $initial_current_url: "https://wirdak.app/?h=SECRET" },
      }),
    );
    expect(scrubbed.properties).toEqual({
      $current_url: "https://wirdak.app/",
      $pathname: "/j/:inviteCode",
      $referrer: "https://wirdak.app/j/:inviteCode/settings",
      $elements: [{ attr__href: "/j/:inviteCode", tag_name: "a" }],
      kind: "rota",
      count: 3,
      ok: true,
      nothing: null,
    });
    expect(scrubbed.$set).toEqual({
      $current_url: "https://wirdak.app/j/:inviteCode",
    });
    expect(scrubbed.$set_once).toEqual({
      $initial_current_url: "https://wirdak.app/",
    });
    expect(JSON.stringify(scrubbed)).not.toMatch(/SECRET|ABC123/);
  });

  it("adds no $set when the event has none", () => {
    expect(scrubEvent(event({}))).not.toHaveProperty("$set");
  });

  it("leaves replay snapshots alone", () => {
    const snapshot = event({
      event: "$snapshot",
      properties: { $snapshot_data: [{ href: "/j/ABC123" }] },
    });
    expect(scrubEvent(snapshot)).toBe(snapshot);
  });
});

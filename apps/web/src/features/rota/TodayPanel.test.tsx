import type { Id } from "@convex/_generated/dataModel";
import type { TodayView } from "@convex/lib/rotaOps";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { TodayPanel, type Tile } from "./TodayPanel";

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn().mockResolvedValue({ ok: true }),
}));

const pid = (id: string) => id as Id<"rotaParticipants">;

/** Juz' `juz`, read by Saad alone and not done yet. */
function tile(juz: number, more: Partial<Tile> = {}): Tile {
  return {
    readId: `r${juz}` as Id<"rotaReads">,
    juz,
    state: "unread",
    holderName: "سعد",
    readerName: "سعد",
    readerId: pid("p1"),
    answer: "none",
    partnerId: null,
    partnerName: null,
    partnerAnswer: null,
    doneByName: null,
    ...more,
  };
}

function makeView(tiles: Tile[]): TodayView {
  return {
    day: {
      number: 4,
      cycle: 1,
      date: "2026-11-09",
      doneCount: tiles.filter((x) => x.state === "done").length,
      completedAt: null,
    },
    next: { number: 5, date: "2026-11-10" },
    paused: false,
    archived: false,
    setupDone: true,
    dayAt: 480,
    timeZone: "UTC",
    tiles,
    participants: [
      { id: pid("p1"), name: "سعد", isMe: false, doneToday: false },
      { id: pid("p9"), name: "ليلى", isMe: false, doneToday: false },
    ],
  };
}

function renderPanel(view: TodayView) {
  return render(
    <TodayPanel
      inviteCode="CODE"
      view={view}
      dayAt={480}
      timeZone="UTC"
      canStart
    />,
  );
}

const shared = { partnerId: pid("p9"), partnerName: "ليلى" };

describe("TodayPanel", () => {
  it("a shared tile's sheet shows both readers and answers", async () => {
    renderPanel(
      makeView([
        tile(5, { ...shared, answer: "none", partnerAnswer: "notYet" }),
      ]),
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: t.rota.tileLabel(5, t.rota.legendUnread),
      }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.unreadTitle(5) });
    expect(
      within(sheet).getByText(t.rota.holders("سعد", "ليلى")),
    ).toBeVisible();
    expect(within(sheet).getByText("سعد: لم يردّ")).toBeVisible();
    expect(within(sheet).getByText("ليلى: ليس بعد")).toBeVisible();
  });

  it("a done shared tile says who finished it", async () => {
    renderPanel(
      makeView([
        tile(5, {
          ...shared,
          state: "done",
          answer: null,
          doneByName: "ليلى",
        }),
      ]),
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: t.rota.tileLabel(5, t.rota.legendDone),
      }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.doneTitle(5) });
    expect(
      within(sheet).getByText(t.rota.holders("سعد", "ليلى")),
    ).toBeVisible();
    expect(within(sheet).getByText(t.rota.doneBy("ليلى"))).toBeVisible();
    // Not Saad's alone, as an unshared juz' would say.
    expect(within(sheet).queryByText(t.rota.readBy("سعد"))).toBeNull();
  });

  it("a done shared juz' an organizer marked names nobody as finishing it", async () => {
    renderPanel(
      makeView([tile(5, { ...shared, state: "done", answer: null })]),
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: t.rota.tileLabel(5, t.rota.legendDone),
      }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.doneTitle(5) });
    expect(
      within(sheet).getByText(t.rota.holders("سعد", "ليلى")),
    ).toBeVisible();
    expect(within(sheet).queryByText(/أتمّه/)).toBeNull();
  });

  it("an unshared tile's sheet is as before", async () => {
    renderPanel(makeView([tile(5)]));
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", {
        name: t.rota.tileLabel(5, t.rota.legendUnread),
      }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.unreadTitle(5) });
    expect(within(sheet).getByText(t.rota.holder("سعد"))).toBeVisible();
    expect(within(sheet).getByText(t.rota.answerNone)).toBeVisible();
  });
});

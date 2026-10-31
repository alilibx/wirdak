import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { JoinRequests } from "./JoinRequests";

const m = vi.hoisted(() => ({
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] ?? "";
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
  };
});

function view(name: string | null) {
  return {
    requests: [{ id: "r1", name, phoneMasked: "+971 50 ••• 2233" }],
    freeJuz: [4, 5],
  } as never;
}

beforeEach(() => {
  m.fns = {};
});

describe("JoinRequests", () => {
  it("starts from the WhatsApp name and accepts the one the organizer types", async () => {
    const user = userEvent.setup();
    render(<JoinRequests inviteCode="CODE" view={view("Khalid99")} />);
    const field = screen.getByLabelText(t.rota.personName);
    expect(field).toHaveValue("Khalid99");
    await user.clear(field);
    await user.type(field, "خالد");
    await user.click(
      screen.getByRole("button", { name: t.rota.acceptRequest }),
    );
    expect(m.fns.acceptJoinRequest).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      requestId: "r1",
      juz: 4,
      name: "خالد",
    });
  });

  it("late in the day, holds the card still and accepts with the organizer's answer", async () => {
    m.fns.acceptJoinRequest = vi
      .fn()
      .mockResolvedValueOnce({ error: "ask_today" })
      .mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<JoinRequests inviteCode="CODE" view={view("خالد")} />);
    await user.click(
      screen.getByRole("button", { name: t.rota.acceptRequest }),
    );
    const question = await screen.findByRole("group", {
      name: t.rota.todayQuestion,
    });
    expect(screen.getByLabelText(t.rota.personName)).toHaveAttribute(
      "readonly",
    );
    expect(screen.getByLabelText(t.rota.requestJuz)).toBeDisabled();

    await user.click(
      within(question).getByRole("button", { name: t.rota.readsNextDay }),
    );
    expect(m.fns.acceptJoinRequest).toHaveBeenLastCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      requestId: "r1",
      juz: 4,
      readsToday: false,
    });
  });

  it("sends no name when WhatsApp gave none and none was typed", async () => {
    const user = userEvent.setup();
    render(<JoinRequests inviteCode="CODE" view={view(null)} />);
    await user.click(
      screen.getByRole("button", { name: t.rota.acceptRequest }),
    );
    expect(m.fns.acceptJoinRequest).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      requestId: "r1",
      juz: 4,
    });
  });
});

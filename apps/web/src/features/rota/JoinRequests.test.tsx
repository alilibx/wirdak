import type { Id } from "@convex/_generated/dataModel";
import type { PeopleView } from "@convex/lib/rotaOps";
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

const reader = (n: number) => ({
  id: `p${n}` as Id<"rotaParticipants">,
  name: `قارئ ${n}`,
  isMe: false,
  slots: 1,
  phone: null,
  joined: true,
  stopped: false,
  silenced: false,
  isOrganizer: false,
  isCoOrganizer: false,
  hasAccount: false,
});

/** One request; juz' 4 and 5 have no reader, unless `full`, when juz' 1 is also shared. */
function view(name: string | null, full = false): PeopleView {
  const freeJuz = full ? [] : [4, 5];
  const rows = Array.from({ length: 30 }, (_, i) => ({
    juz: i + 1,
    participant: freeJuz.includes(i + 1) ? null : reader(i + 1),
    partner: full && i === 0 ? reader(31) : null,
  }));
  return {
    title: "ختمة العائلة",
    archived: false,
    daysKind: "daily",
    joinLink: null,
    requests: [
      {
        id: "r1" as Id<"rotaJoinRequests">,
        name,
        phoneMasked: "+971 50 ••• 2233",
        createdAt: 0,
      },
    ],
    target: { number: 2, date: "2026-10-31", isFirst: false },
    rows,
    participants: [],
    freeJuz,
    maxSlots: 2,
    phoneExample: null,
    leftoverBox: true,
    sharing: {
      on: true,
      open: full,
      readers: full ? 31 : 28,
      shared: full ? 1 : 0,
    },
  };
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

  it("a join request can be shared onto a juz' when all are taken", async () => {
    const user = userEvent.setup();
    render(<JoinRequests inviteCode="CODE" view={view("خالد", true)} />);
    expect(
      screen.queryByRole("button", { name: t.rota.acceptRequest }),
    ).toBeNull();
    const picker = screen.getByLabelText(t.rota.requestJuz);
    const options = within(picker)
      .getAllByRole("option")
      .map((o) => Number((o as HTMLOptionElement).value));
    // Juz' 1 has two readers already.
    expect(options).toEqual(Array.from({ length: 29 }, (_, i) => i + 2));
    expect(
      within(picker).getByRole("option", {
        name: t.rota.shareJuzOption(5, "قارئ 5"),
      }),
    ).toBeInTheDocument();
    await user.selectOptions(picker, "5");
    await user.click(screen.getByRole("button", { name: t.rota.shareRequest }));
    expect(m.fns.acceptJoinRequest).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      requestId: "r1",
      juz: 5,
      share: true,
    });
  });

  it("with every juz' taken and sharing closed, says so and offers no accept", () => {
    const closed = view("خالد", true);
    closed.sharing = { ...closed.sharing, open: false };
    render(<JoinRequests inviteCode="CODE" view={closed} />);
    expect(screen.getByText(t.rota.addErrors.no_free_juz!)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: t.rota.shareRequest }),
    ).toBeNull();
  });

  it("an already_shared refusal shows in Arabic", async () => {
    m.fns.acceptJoinRequest = vi
      .fn()
      .mockResolvedValue({ error: "already_shared" });
    const user = userEvent.setup();
    render(<JoinRequests inviteCode="CODE" view={view("خالد", true)} />);
    await user.click(screen.getByRole("button", { name: t.rota.shareRequest }));
    expect(
      await screen.findByText(t.rota.errors.already_shared!),
    ).toBeInTheDocument();
  });
});

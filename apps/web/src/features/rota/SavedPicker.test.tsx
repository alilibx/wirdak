import type { Id } from "@convex/_generated/dataModel";
import type { PeopleView } from "@convex/lib/rotaOps";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { SavedPicker } from "./SavedPicker";

const m = vi.hoisted(() => ({
  saved: undefined as unknown,
  people: undefined as unknown,
  addSaved: vi.fn(),
  addSavedMany: vi.fn(),
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (fn: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(fn) === "rota:people" ? m.people : m.saved,
    useMutation: (fn: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(fn) === "rota:addSavedMany" ? m.addSavedMany : m.addSaved,
  };
});

const contacts = [
  {
    id: "c1",
    name: "أم خالد",
    phone: "+971501234567",
    inKhatma: false,
    active: false,
  },
  { id: "c2", name: "سعد", phone: null, inKhatma: false, active: false },
  {
    id: "c3",
    name: "نورة",
    phone: "+971507654321",
    inKhatma: true,
    active: false,
  },
];

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

/**
 * The People view, whose free ajza' (2 to n + 1) bound how many can be ticked. With every juz'
 * read, `shared` of them have a second reader, and sharing is `open` or not.
 */
function freeJuz(
  n: number,
  { open = false, shared = 0 }: { open?: boolean; shared?: number } = {},
): PeopleView {
  const free = Array.from({ length: n }, (_, i) => i + 2);
  const rows = Array.from({ length: 30 }, (_, i) => ({
    juz: i + 1,
    participant: free.includes(i + 1) ? null : reader(i + 1),
    partner: i < shared ? reader(31 + i) : null,
  }));
  return {
    title: "ختمة العائلة",
    archived: false,
    daysKind: "daily",
    joinLink: null,
    requests: [],
    target: { number: 2, date: "2026-10-31", isFirst: false },
    rows,
    participants: [],
    freeJuz: free,
    // As the server lists them: the ajza' one person reads, once sharing is open.
    unsharedJuz: open
      ? rows
          .filter((r) => r.participant !== null && r.partner === null)
          .map((r) => r.juz)
      : [],
    maxSlots: 2,
    phoneExample: null,
    leftoverBox: true,
    sharing: { on: true, open, readers: 30 - n + shared, shared },
  };
}

const sheet = () => screen.getByRole("dialog", { name: t.rota.savedTitle });

beforeEach(() => {
  m.saved = contacts;
  m.people = freeJuz(29);
  m.addSaved.mockReset().mockResolvedValue({ ok: true });
  m.addSavedMany.mockReset().mockResolvedValue({
    ok: true,
    added: 2,
    alreadyIn: 0,
    noRoom: 0,
    notFound: 0,
  });
});

describe("SavedPicker", () => {
  it("lists the saved people; a hidden number is not shown, and who is in already cannot be pressed", () => {
    render(<SavedPicker inviteCode="CODE" juz={7} onClose={() => {}} />);
    const list = within(sheet()).getByRole("list", { name: t.rota.savedTitle });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("+971501234567")).toBeInTheDocument();
    expect(within(list).getByText("نورة").closest("button")).toBeDisabled();
    expect(within(list).getByText(t.rota.savedInKhatma)).toBeInTheDocument();
    expect(within(list).getByText("سعد").closest("button")).not.toBeDisabled();
    // Only the free person with a number shows one: not the hidden one, nor who is in already.
    expect(within(list).getAllByText(/^\+971/)).toHaveLength(1);
  });

  it("without a juz', ticks several and adds them in one call, in list order", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onAddedMany = vi.fn();
    render(
      <SavedPicker
        inviteCode="CODE"
        onClose={onClose}
        onAddedMany={onAddedMany}
      />,
    );
    const add = screen.getByRole("button", { name: t.rota.savedAddMany(0) });
    expect(add).toBeDisabled();
    // Who is in already can't be ticked.
    expect(screen.getByRole("checkbox", { name: /نورة/ })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /سعد/ }));
    await user.click(screen.getByRole("checkbox", { name: /أم خالد/ }));
    await user.click(
      screen.getByRole("button", { name: t.rota.savedAddMany(2) }),
    );

    expect(m.addSavedMany).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactIds: ["c1", "c2"],
    });
    expect(m.addSaved).not.toHaveBeenCalled();
    expect(onAddedMany).toHaveBeenCalledWith(
      t.rota.savedManyResult({ added: 2, noRoom: 0, skipped: 0 }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops ticking once the ticks fill the free ajza'", async () => {
    const user = userEvent.setup();
    m.people = freeJuz(1);
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    expect(screen.getByText(t.rota.savedRoom(1))).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /أم خالد/ }));
    expect(screen.getByText(t.rota.savedRoom(0))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /سعد/ })).toBeDisabled();
    // Unticking frees the room again.
    await user.click(screen.getByRole("checkbox", { name: /أم خالد/ }));
    expect(screen.getByRole("checkbox", { name: /سعد/ })).not.toBeDisabled();
  });

  it("once every juz' has a reader and sharing is open, the room is the ajza' with one reader", () => {
    m.people = freeJuz(0, { open: true, shared: 2 });
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    expect(screen.getByText(t.rota.savedRoom(28))).toBeInTheDocument();
    expect(screen.getByText(t.rota.savedShareHint)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /أم خالد/ }),
    ).not.toBeDisabled();
  });

  it("with every juz' read and sharing closed, there is no room and no word of sharing", () => {
    m.people = freeJuz(0, { open: false, shared: 2 });
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    expect(screen.getByText(t.rota.savedRoom(0))).toBeInTheDocument();
    expect(screen.queryByText(t.rota.savedShareHint)).toBeNull();
    expect(screen.getByRole("checkbox", { name: /أم خالد/ })).toBeDisabled();
  });

  it("ticks the people who read with the organizer now, up to the room", async () => {
    const user = userEvent.setup();
    m.saved = [
      { id: "a1", name: "زيد", phone: null, inKhatma: false, active: true },
      { id: "a2", name: "عمر", phone: null, inKhatma: false, active: true },
      { id: "a3", name: "هند", phone: null, inKhatma: true, active: true },
      { id: "a4", name: "ليلى", phone: null, inKhatma: false, active: false },
    ];
    m.people = freeJuz(1);
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    // Who is in already shows that instead.
    expect(screen.getAllByText(t.rota.savedActive)).toHaveLength(2);

    await user.click(
      screen.getByRole("button", { name: t.rota.savedPickActive }),
    );

    expect(screen.getByRole("checkbox", { name: /زيد/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /عمر/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /ليلى/ })).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: t.rota.savedPickActive }),
    ).toBeNull();
  });

  it("while the free ajza' load, people can still be ticked", async () => {
    const user = userEvent.setup();
    m.people = undefined;
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    const box = screen.getByRole("checkbox", { name: /أم خالد/ });
    expect(box).not.toBeDisabled();
    await user.click(box);
    expect(box).toBeChecked();
  });

  it("the room line reads right for one, two, and more", () => {
    expect(t.rota.savedRoom(1)).toBe("يتّسع لشخص واحد.");
    expect(t.rota.savedRoom(2)).toBe("يتّسع لشخصين.");
    expect(t.rota.savedRoom(5)).toBe("يتّسع لـ5 أشخاص.");
  });

  it("the result says who was added, who didn't fit, and who was skipped", () => {
    expect(t.rota.savedManyResult({ added: 2, noRoom: 1, skipped: 1 })).toBe(
      "أضفنا شخصين. لم يتّسع لشخص واحد لأن الأجزاء اكتملت. تركنا شخصاً واحداً لأنه في الختمة أو لم يعد في قائمتك. لتصلهم رسائل الختمة يرسل كلٌّ منهم رسالة الانضمام من رابط المجموعة.",
    );
    expect(t.rota.savedManyResult({ added: 0, noRoom: 0, skipped: 3 })).toBe(
      "لم نضف أحداً. تركنا 3 أشخاص لأنهم في الختمة أو لم يعودوا في قائمتك.",
    );
  });

  it("late in the day, asks once and sends the answer for the whole batch", async () => {
    const user = userEvent.setup();
    m.addSavedMany.mockResolvedValueOnce({ error: "ask_today" });
    render(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    await user.click(screen.getByRole("checkbox", { name: /أم خالد/ }));
    await user.click(screen.getByRole("checkbox", { name: /سعد/ }));
    await user.click(
      screen.getByRole("button", { name: t.rota.savedAddMany(2) }),
    );
    await user.click(
      await screen.findByRole("button", { name: t.rota.readsNextDay }),
    );
    expect(m.addSavedMany).toHaveBeenLastCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactIds: ["c1", "c2"],
      readsToday: false,
    });
  });

  it("for one juz', adds there and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SavedPicker inviteCode="CODE" juz={7} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /سعد/ }));
    expect(m.addSaved).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactId: "c2",
      juz: 7,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not press a person already in the khatma", async () => {
    const user = userEvent.setup();
    render(<SavedPicker inviteCode="CODE" juz={7} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: /نورة/ }));
    expect(m.addSaved).not.toHaveBeenCalled();
  });

  it.each([
    ["already_added", t.rota.savedErrors.already_added],
    ["juz_taken", t.rota.savedErrors.juz_taken],
    ["not_found", t.rota.savedErrors.not_found],
  ])(
    "a refusal (%s) is said plainly and keeps the sheet open",
    async (code, line) => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      m.addSaved.mockResolvedValue({ error: code });
      render(<SavedPicker inviteCode="CODE" juz={7} onClose={onClose} />);
      await user.click(screen.getByRole("button", { name: /أم خالد/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(line ?? "");
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("while the list loads, or when it is empty, says nothing is pressable", () => {
    m.saved = undefined;
    const { rerender } = render(
      <SavedPicker inviteCode="CODE" onClose={() => {}} />,
    );
    expect(within(sheet()).queryByRole("listitem")).toBeNull();
    m.saved = [];
    rerender(<SavedPicker inviteCode="CODE" onClose={() => {}} />);
    expect(within(sheet()).queryByRole("listitem")).toBeNull();
  });
});

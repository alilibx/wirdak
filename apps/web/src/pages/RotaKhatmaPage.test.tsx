import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { RotaKhatmaPage } from "./RotaKhatmaPage";

type Person = {
  id: string;
  name: string;
  isMe: boolean;
  juz: number[];
  phone?: string;
  joined?: boolean;
  stopped?: boolean;
  silenced?: boolean;
};

const JOIN_LINK =
  "https://wa.me/971500000000?text=%D8%A7%D9%86%D8%B6%D9%85%D8%A7%D9%85%20%D8%A5%D9%84%D9%89%20%D8%AE%D8%AA%D9%85%D8%A9%20%C2%B7%20ABC234";

const m = vi.hoisted(() => ({
  today: undefined as unknown,
  settings: undefined as unknown,
  people: undefined as unknown,
  mine: [] as unknown,
  me: null as unknown,
  joinLink: null as string | null,
  /** What the khatma's public view says about being archived. */
  archived: false,
  notes: [] as unknown,
  fns: {
    reassign: vi.fn(),
    markDone: vi.fn(),
    markNotDone: vi.fn(),
    addParticipant: vi.fn(),
    giveJuz: vi.fn(),
    moveJuz: vi.fn(),
    removeParticipant: vi.fn(),
    freeJuz: vi.fn(),
    ensureJoinLink: vi.fn(),
    acceptJoinRequest: vi.fn(),
    declineJoinRequest: vi.fn(),
    finishSetup: vi.fn(),
    dismiss: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  },
  startAgain: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("../features/verify/VerifySheet", () => ({
  VerifySheet: (props: { title: string; intent?: unknown }) => (
    <div role="dialog" aria-label={props.title}>
      {JSON.stringify(props.intent)}
    </div>
  ),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      const name = getFunctionName(ref);
      if (args === "skip") return undefined;
      if (name === "rota:today") return m.today;
      if (name === "rota:settings") return m.settings;
      if (name === "rota:people") return m.people;
      // Nobody saved and no pool khatma to bring from: the plain add form.
      if (name === "rota:saved" || name === "rota:importable") return [];
      if (name === "khatmas:mine") return m.mine;
      if (name === "sessions:me") return m.me;
      if (name === "notes:forKhatma") return m.notes;
      if (name === "publicSettings:get") return undefined;
      throw new Error(`unexpected query ${name}`);
    },
    useMutation: (ref: never) =>
      m.fns[getFunctionName(ref).split(":")[1] as keyof typeof m.fns],
    useAction: () => m.startAgain,
  };
});

const settings = {
  name: "ختمة العائلة",
  days: { kind: "daily" },
  firstDate: "2026-10-30",
  firstDatePassed: true,
  endDate: null,
  timeZone: "UTC",
  messages: {
    dayAt: 480,
    reminder: { at: 960, on: true },
    unread: { at: 1140, on: true },
    summary: { at: 1260, on: false },
  },
  pausedAt: null,
  pauseDates: [],
  upcoming: [],
  quiet: { startHour: 22, endHour: 7 },
  lateTap: { override: null, defaultMs: 28_800_000 },
  cheer: {
    override: null,
    defaults: {
      on: true,
      everyone: false,
      gapMs: 86_400_000,
      showName: false,
      showJuz: false,
    },
  },
};

const people = [
  { id: "p1", name: "علي", isMe: true },
  { id: "p2", name: "مريم", isMe: false },
  { id: "p3", name: "سارة", isMe: false },
];

/** Khatma 12 on Tuesday 10 November: 27 done, juz' 8 unread (Sara's), 9 given to Maryam, 10 unread. */
function todayView(overrides: Record<string, unknown> = {}) {
  return {
    day: {
      number: 12,
      cycle: 1,
      date: "2026-11-10",
      doneCount: 27,
      completedAt: null,
    },
    next: { number: 13, date: "2026-11-11" },
    paused: false,
    archived: false,
    setupDone: true,
    tiles: Array.from({ length: 30 }, (_, i) => {
      const juz = i + 1;
      const state =
        juz === 8 || juz === 10 ? "unread" : juz === 9 ? "reassigned" : "done";
      return {
        readId: `r${juz}`,
        juz,
        state,
        holderName: juz === 8 ? "سارة" : juz === 9 ? "خالد" : "مريم",
        readerName: juz === 9 ? "مريم" : "مريم",
        readerId: juz === 9 ? "p2" : juz === 8 ? "p3" : "p2",
        answer: state === "done" ? null : juz === 10 ? "notYet" : "none",
      };
    }),
    participants: people.map((p) => ({ ...p, doneToday: p.id !== "p3" })),
    ...overrides,
  };
}

const withState = (p: Person) => ({
  phone: "+971500000000",
  joined: true,
  stopped: false,
  silenced: false,
  ...p,
});

function peopleView(
  rawHolders: Person[],
  target = { number: 13, date: "2026-11-11", isFirst: false },
  extra: Record<string, unknown> = {},
) {
  const holders = rawHolders.map(withState);
  const byJuz = new Map<number, ReturnType<typeof withState>>();
  for (const p of holders) for (const juz of p.juz) byJuz.set(juz, p);
  return {
    title: "ختمة العائلة",
    daysKind: "monthly",
    joinLink: JOIN_LINK,
    requests: [],
    ...extra,
    target,
    rows: Array.from({ length: 30 }, (_, i) => {
      const p = byJuz.get(i + 1);
      return {
        juz: i + 1,
        participant: p
          ? {
              id: p.id,
              name: p.name,
              isMe: p.isMe,
              slots: p.juz.length,
              phone: p.phone,
              joined: p.joined,
              stopped: p.stopped,
              silenced: p.silenced,
            }
          : null,
      };
    }),
    participants: holders,
    freeJuz: Array.from({ length: 30 }, (_, i) => i + 1).filter(
      (j) => !byJuz.has(j),
    ),
    maxSlots: 3,
  };
}

const roster: Person[] = [
  { id: "p1", name: "علي", isMe: true, juz: [1] },
  { id: "p2", name: "مريم", isMe: false, juz: [2, 3] },
  { id: "p3", name: "سارة", isMe: false, juz: [4] },
];

function renderAt(url = "/j/CODE") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/j/:inviteCode" element={<Page />} />
        <Route path="/j/:inviteCode/setup" element={<p>setup page</p>} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
function Page() {
  return (
    <RotaKhatmaPage
      inviteCode="CODE"
      name="ختمة العائلة"
      archived={m.archived}
      joinLink={m.joinLink}
    />
  );
}

const grid = () => screen.getByRole("region", { name: t.rota.gridLabel });
const args = { sessionToken: "tok", inviteCode: "CODE" };

beforeEach(() => {
  // Tuesday 10 November, noon in UTC, the khatma's time zone.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T12:00:00Z"));
  for (const fn of Object.values(m.fns)) {
    fn.mockReset().mockResolvedValue({ ok: true });
  }
  m.today = todayView();
  m.settings = settings;
  m.people = peopleView(roster);
  m.mine = [];
  m.me = { displayName: "علي" };
  m.joinLink = JOIN_LINK;
  m.archived = false;
  m.notes = [];
  m.startAgain.mockReset().mockResolvedValue({ inviteCode: "NEWCODE" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Today", () => {
  it("shows the day, the count and when the next one comes", () => {
    renderAt();
    expect(
      screen.getByRole("heading", { name: "ختمة العائلة" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("الختمة ١٢ · الثلاثاء ١٠ نوفمبر"),
    ).toBeInTheDocument();
    expect(screen.getByText("٢٧ / ٣٠")).toBeInTheDocument();
    expect(
      screen.getByText("التالي: الختمة ١٣ · غداً ٨:٠٠ ص"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/الدورة/)).toBeNull();
  });

  it("names a later date instead of «غداً» and the cycle after the first", () => {
    m.today = todayView({
      day: {
        number: 42,
        cycle: 2,
        date: "2026-11-10",
        doneCount: 27,
        completedAt: null,
      },
      next: { number: 43, date: "2026-11-17" },
    });
    renderAt();
    expect(screen.getByText("الدورة ٢")).toBeInTheDocument();
    expect(
      screen.getByText("التالي: الختمة ٤٣ · الثلاثاء ١٧ نوفمبر ٨:٠٠ ص"),
    ).toBeInTheDocument();
  });

  it("draws the 30 ajza' with their states", () => {
    renderAt();
    const tiles = within(grid()).getAllByRole("button");
    expect(tiles).toHaveLength(30);
    const named = (word: string) =>
      tiles.filter((tile) => tile.getAttribute("aria-label")?.endsWith(word));
    expect(named(t.rota.legendDone)).toHaveLength(27);
    expect(named(t.rota.legendUnread)).toHaveLength(2);
    expect(named(t.rota.legendReassigned)).toHaveLength(1);
    expect(tiles[7]).toHaveAccessibleName("الجزء ٨، لم يُقرأ");
  });

  it("says when the day is complete", () => {
    m.today = todayView({
      day: {
        number: 12,
        cycle: 1,
        date: "2026-11-10",
        doneCount: 30,
        completedAt: 1,
      },
    });
    renderAt();
    expect(screen.getByRole("status")).toHaveTextContent("اكتملت الختمة ١٢");
  });

  it("shows a banner while paused", () => {
    m.today = todayView({ paused: true, next: { number: 13, date: null } });
    renderAt();
    expect(screen.getByText(t.rota.pausedBanner)).toBeInTheDocument();
    expect(screen.queryByText(/التالي/)).toBeNull();
  });

  it("with no open day, says when the khatma starts and draws no grid", () => {
    m.today = todayView({
      day: null,
      tiles: [],
      next: { number: 1, date: "2026-10-30" },
    });
    renderAt();
    expect(
      screen.getByText("تبدأ الختمة ١ يوم الجمعة ٣٠ أكتوبر الساعة ٨:٠٠ ص"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: t.rota.gridLabel })).toBeNull();
  });

  it("an unread juz' shows who holds it, with the three actions", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    const sheet = screen.getByRole("dialog", { name: "الجزء ٨ لم يُقرأ بعد" });
    expect(within(sheet).getByText("صاحبه اليوم: سارة")).toBeInTheDocument();
    for (const action of [t.rota.assign, t.rota.readMyself, t.rota.markDone]) {
      expect(
        within(sheet).getByRole("button", { name: action }),
      ).toBeInTheDocument();
    }
  });

  it("an unread juz' says whether the reader answered", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(t.rota.answerNone);
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      t.rota.answerNotYet,
    );
    await user.click(screen.getByRole("button", { name: t.sheet.close }));
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ١٠، لم يُقرأ" }),
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(t.rota.answerNotYet);
  });

  it("a done juz' shows no answer", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ١، تمّ" }),
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(t.rota.answerNone);
  });

  it("shows no answer for a done juz' or one with no answer to show", async () => {
    m.today = todayView({
      tiles: (todayView().tiles as Record<string, unknown>[]).map((tile) =>
        tile.juz === 8 ? { ...tile, answer: null } : tile,
      ),
    });
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(t.rota.answerNone);
    await user.click(screen.getByRole("button", { name: t.sheet.close }));
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ١، تمّ" }),
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(t.rota.answerNone);
  });

  it("a reassigned juz' also says who reads it now", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٩، أُسند" }),
    );
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("صاحبه اليوم: خالد")).toBeInTheDocument();
    expect(within(sheet).getByText("يقرؤه الآن: مريم")).toBeInTheDocument();
  });

  it("reassigns to the chosen participant, marking who finished today", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    await user.click(screen.getByRole("button", { name: t.rota.assign }));
    const sheet = screen.getByRole("dialog", {
      name: "من يقرأ الجزء ٨ اليوم؟",
    });
    expect(
      within(sheet).getByRole("button", { name: /مريم/ }),
    ).toHaveTextContent(t.rota.finishedToday);
    expect(
      within(sheet).getByRole("button", { name: /سارة/ }),
    ).not.toHaveTextContent(t.rota.finishedToday);
    await user.click(within(sheet).getByRole("button", { name: /مريم/ }));
    expect(m.fns.reassign).toHaveBeenCalledWith({
      ...args,
      readId: "r8",
      participantId: "p2",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("«سأقرؤه أنا» gives it to the organizer", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    await user.click(screen.getByRole("button", { name: t.rota.readMyself }));
    expect(m.fns.reassign).toHaveBeenCalledWith({
      ...args,
      readId: "r8",
      participantId: "p1",
    });
  });

  it("«سجّله تامّاً» marks it done", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    await user.click(screen.getByRole("button", { name: t.rota.markDone }));
    expect(m.fns.markDone).toHaveBeenCalledWith({ ...args, readId: "r8" });
  });

  it("a done juz' can be taken back", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ١، تمّ" }),
    );
    const sheet = screen.getByRole("dialog", { name: "الجزء ١ تمّت قراءته" });
    expect(within(sheet).getByText("قرأه: مريم")).toBeInTheDocument();
    await user.click(
      within(sheet).getByRole("button", { name: t.rota.undoDone }),
    );
    expect(m.fns.markNotDone).toHaveBeenCalledWith({ ...args, readId: "r1" });
  });

  it.each([
    [{ error: "closed" }, t.rota.todayErrors.closed],
    [{ error: "done" }, t.rota.todayErrors.done],
  ])(
    "keeps the sheet and says why a change was refused (%j)",
    async (result, message) => {
      m.fns.reassign.mockResolvedValue(result);
      const user = userEvent.setup();
      renderAt();
      await user.click(
        within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
      );
      await user.click(screen.getByRole("button", { name: t.rota.readMyself }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message ?? "");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    },
  );

  it("maps a thrown error code, and a failed call is a network error", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    m.fns.markDone.mockRejectedValue(new ConvexError({ code: "forbidden" }));
    await user.click(screen.getByRole("button", { name: t.rota.markDone }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.forbidden ?? "",
    );
    m.fns.markDone.mockRejectedValue(new Error("offline"));
    await user.click(screen.getByRole("button", { name: t.rota.markDone }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.network,
    );
  });

  it("shows the organizer's notes first, and «حسناً» dismisses one", async () => {
    m.notes = [
      {
        noteId: "n1",
        kind: "rotaUnread",
        juz: [8, 10],
        count: null,
        until: null,
        createdAt: 1,
      },
    ];
    const user = userEvent.setup();
    renderAt();
    const notes = screen.getByRole("region", { name: t.notes.heading });
    expect(notes).toHaveTextContent(
      t.notes.text({
        kind: "rotaUnread",
        juz: [8, 10],
        count: null,
        until: null,
      }),
    );
    await user.click(within(notes).getByRole("button", { name: t.notes.ok }));
    expect(m.fns.dismiss).toHaveBeenCalledWith({
      sessionToken: "tok",
      noteId: "n1",
    });
  });

  it("shows no notes on the People tab", () => {
    m.notes = [
      {
        noteId: "n1",
        kind: "rotaSummary",
        juz: [1],
        count: 1,
        until: null,
        createdAt: 1,
      },
    ];
    renderAt("/j/CODE?tab=people");
    expect(screen.queryByRole("region", { name: t.notes.heading })).toBeNull();
  });

  it("before setup is done, asks to start the khatma and starts it", async () => {
    m.today = todayView({
      day: null,
      tiles: [],
      setupDone: false,
      next: { number: 1, date: "2026-11-10" },
    });
    const user = userEvent.setup();
    renderAt();
    expect(screen.getByText(t.rota.setupNotDone)).toBeInTheDocument();
    expect(screen.queryByText(/^تبدأ الختمة ١/)).toBeNull();
    await user.click(screen.getByRole("button", { name: t.rota.startKhatma }));
    expect(m.fns.finishSetup).toHaveBeenCalledWith(args);
  });

  it("says a change was refused because the khatma is archived", async () => {
    m.fns.markDone.mockRejectedValue(new ConvexError({ code: "archived" }));
    const user = userEvent.setup();
    renderAt();
    await user.click(
      within(grid()).getByRole("button", { name: "الجزء ٨، لم يُقرأ" }),
    );
    await user.click(screen.getByRole("button", { name: t.rota.markDone }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.archived ?? "",
    );
  });

  it("leaves the grid alone once the khatma is archived", () => {
    m.today = todayView({ archived: true });
    renderAt();
    for (const tile of within(grid()).getAllByRole("button")) {
      expect(tile).toBeDisabled();
    }
  });
});

describe("page", () => {
  it("shows only the short WhatsApp page to anyone but the organizer, titled with the khatma's name", () => {
    m.today = null;
    renderAt();
    expect(
      screen.getByRole("heading", { name: "ختمة العائلة" }),
    ).toBeInTheDocument();
    expect(screen.getByText(t.rota.whatsappOnly)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    // Signed in, so there is nothing to sign in to.
    expect(
      screen.queryByRole("button", { name: t.rota.imOrganizer }),
    ).toBeNull();
  });

  it("gives a visitor a big «انضمّ عبر واتساب» button to the join link", () => {
    m.today = null;
    renderAt();
    const join = screen.getByRole("link", { name: t.rota.joinOnWhatsApp });
    expect(join).toHaveAttribute("href", JOIN_LINK);
  });

  it("shows no join button while the khatma has no join link", () => {
    m.today = null;
    m.joinLink = null;
    renderAt();
    expect(
      screen.queryByRole("link", { name: t.rota.joinOnWhatsApp }),
    ).toBeNull();
  });

  it("offers a signed-out visitor the sign-in sheet, to come back here as the organizer", async () => {
    m.today = null;
    m.me = null;
    const user = userEvent.setup();
    renderAt();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: t.rota.imOrganizer }));
    expect(
      screen.getByRole("dialog", { name: t.signIn.title }),
    ).toHaveTextContent('{"kind":"signin"}');
  });

  it("falls back to the WhatsApp page when the settings are not the organizer's", () => {
    m.settings = null;
    renderAt();
    expect(screen.getByText(t.rota.whatsappOnly)).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("waits for the answer", () => {
    m.today = undefined;
    renderAt();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("has the two tabs, the settings link and no switch button with one khatma", () => {
    renderAt();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["اليوم", "المشاركون"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("link", { name: t.khatmaSettings.link }),
    ).toHaveAttribute("href", "/j/CODE/settings");
    expect(
      screen.queryByRole("button", { name: t.nav.switchKhatma }),
    ).toBeNull();
  });

  it("offers to switch khatmas when there are two", () => {
    const card = {
      name: "أ",
      createdAt: 0,
      kind: "pool",
      done: 3,
      holding: null,
      hasNote: false,
      schedule: "daily",
    };
    m.mine = [
      { ...card, inviteCode: "CODE", kind: "rota" },
      { ...card, inviteCode: "OTHER" },
    ];
    renderAt();
    expect(
      screen.getByRole("button", { name: t.nav.switchKhatma }),
    ).toBeInTheDocument();
  });

  it("opens the People tab from the URL and switches with the tabs", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    expect(screen.getByRole("tab", { name: "المشاركون" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "اليوم" }));
    expect(screen.getByText("٢٧ / ٣٠")).toBeInTheDocument();
  });
});

describe("an archived khatma", () => {
  beforeEach(() => {
    m.today = todayView({ archived: true });
    m.settings = { ...settings, archived: true };
  });

  it("says its days have ended, paused or not, and never promises a next one", () => {
    m.today = todayView({
      archived: true,
      paused: true,
      day: null,
      tiles: [],
      next: { number: 13, date: null },
    });
    m.people = { ...peopleView(roster), target: { number: 13, date: null } };
    const { unmount } = renderAt();
    expect(screen.getByText(t.rota.ended)).toBeInTheDocument();
    expect(screen.queryByText(t.rota.pausedBanner)).toBeNull();
    unmount();
    renderAt("/j/CODE?tab=people");
    expect(screen.getByText(t.rota.nextBanner(13, null))).toBeInTheDocument();
  });

  it("says so once, on Today and on People", () => {
    const { unmount } = renderAt();
    expect(screen.getAllByText(t.archive.banner)).toHaveLength(1);
    unmount();
    renderAt("/j/CODE?tab=people");
    expect(screen.getAllByText(t.archive.banner)).toHaveLength(1);
  });

  it("offers to start again with the same people, and to delete", () => {
    renderAt();
    expect(
      screen.getByRole("button", { name: t.archive.restart }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: t.archive.delete }),
    ).toBeEnabled();
  });

  it("an active khatma offers neither", () => {
    m.today = todayView();
    m.settings = settings;
    renderAt();
    expect(screen.queryByText(t.archive.banner)).toBeNull();
    expect(
      screen.queryByRole("button", { name: t.archive.restart }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: t.archive.delete })).toBeNull();
  });

  it("start again asks for the first day, then opens the setup of the new khatma", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole("button", { name: t.archive.restart }));
    const sheet = screen.getByRole("dialog", { name: t.archive.restartTitle });
    // Tuesday the 10th, noon in the khatma's zone: tomorrow is Wednesday the 11th.
    expect(sheet).toHaveTextContent("غداً، الأربعاء ١١ نوفمبر");
    await user.click(
      within(sheet).getByRole("button", { name: t.archive.restartConfirm }),
    );
    expect(m.startAgain).toHaveBeenCalledWith({
      ...args,
      firstDate: "2026-11-11",
    });
    expect(await screen.findByText("setup page")).toBeInTheDocument();
  });

  it("delete asks first, then goes home", async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    expect(m.fns.remove).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: t.archive.deleteConfirm }),
    );
    expect(m.fns.remove).toHaveBeenCalledWith(args);
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("Today: no tile opens", () => {
    renderAt();
    for (const tile of within(grid()).getAllByRole("button")) {
      expect(tile).toBeDisabled();
    }
  });

  it("People: the readers show, but nothing can be pressed, added or shared", () => {
    m.people = peopleView(roster, undefined, {
      requests: [
        {
          id: "q1",
          name: "نور",
          phoneMasked: "+971 50 ••• 0009",
          createdAt: 1,
        },
      ],
    });
    renderAt("/j/CODE?tab=people");
    const rows = within(
      document.querySelector("ol") as HTMLElement,
    ).getAllByRole("listitem");
    expect(rows).toHaveLength(30);
    expect(rows[1]).toHaveTextContent("مريم");
    expect(
      within(document.querySelector("ol") as HTMLElement).queryAllByRole(
        "button",
      ),
    ).toHaveLength(0);
    expect(screen.queryByText(/أضف قارئاً/)).toBeNull();
    expect(screen.queryByRole("link", { name: t.rota.shareJoin })).toBeNull();
    expect(screen.queryByText(t.rota.requestsHeading)).toBeNull();
    expect(screen.queryByRole("link", { name: t.rota.notJoined })).toBeNull();
  });

  it("People: no join link is asked for", () => {
    m.people = peopleView(roster);
    (m.people as { joinLink: string | null }).joinLink = null;
    renderAt("/j/CODE?tab=people");
    expect(m.fns.ensureJoinLink).not.toHaveBeenCalled();
  });

  it("delete keeps showing «جارٍ الحذف» while it runs, however the queries turn out", async () => {
    let finish: (value: { ok: true }) => void = () => {};
    m.fns.remove.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    const view = renderAt();
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    await user.click(
      screen.getByRole("button", { name: t.archive.deleteConfirm }),
    );
    expect(m.fns.remove).toHaveBeenCalledWith(args);
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(t.archive.deleting)).toBeInTheDocument();
    // The delete lands: both queries turn null before the move home.
    m.today = null;
    m.settings = null;
    view.rerender(
      <MemoryRouter initialEntries={["/j/CODE"]}>
        <Routes>
          <Route path="/j/:inviteCode" element={<Page />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(t.archive.deleting)).toBeInTheDocument();
    expect(screen.queryByText(t.rota.whatsappOnly)).toBeNull();
    expect(screen.queryByText("home page")).toBeNull();
    finish({ ok: true });
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("a failed delete gives the page back, with the reason under the buttons", async () => {
    m.fns.remove.mockResolvedValue({ error: "not_archived" });
    const user = userEvent.setup();
    renderAt();
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    await user.click(
      screen.getByRole("button", { name: t.archive.deleteConfirm }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.not_archived ?? "",
    );
    expect(
      screen.getByRole("button", { name: t.archive.delete }),
    ).toBeEnabled();
  });

  it("the switch button counts only active khatmas", () => {
    const card = {
      name: "ختمة",
      createdAt: 0,
      done: 0,
      holding: null,
      hasNote: false,
      schedule: "daily",
    };
    m.mine = [
      { ...card, inviteCode: "CODE", kind: "rota", archived: true },
      { ...card, inviteCode: "OLD", archived: true },
    ];
    const { unmount } = renderAt();
    expect(
      screen.queryByRole("button", { name: t.nav.switchKhatma }),
    ).toBeNull();
    unmount();
    m.mine = [
      { ...card, inviteCode: "CODE", kind: "rota", archived: true },
      { ...card, inviteCode: "OTHER" },
    ];
    renderAt();
    expect(
      screen.getByRole("button", { name: t.nav.switchKhatma }),
    ).toBeInTheDocument();
  });
});

describe("an archived khatma, for anyone but the organizer", () => {
  beforeEach(() => {
    m.today = null;
    m.archived = true;
  });

  it("says so, and offers no way to join", () => {
    renderAt();
    expect(screen.getByText(t.archive.banner)).toBeInTheDocument();
    expect(screen.queryByText(t.rota.whatsappOnly)).toBeNull();
    expect(
      screen.queryByRole("link", { name: t.rota.joinOnWhatsApp }),
    ).toBeNull();
  });

  it("a signed-out visitor can still sign in as the organizer", () => {
    m.me = null;
    renderAt();
    expect(
      screen.getByRole("button", { name: t.rota.imOrganizer }),
    ).toBeInTheDocument();
  });

  it("an active khatma keeps its join button", () => {
    m.archived = false;
    renderAt();
    expect(
      screen.getByRole("link", { name: t.rota.joinOnWhatsApp }),
    ).toHaveAttribute("href", JOIN_LINK);
    expect(screen.queryByText(t.archive.banner)).toBeNull();
  });
});

describe("People", () => {
  // The join requests (when there are any) are a list of their own.
  const rows = () =>
    within(document.querySelector("ol") as HTMLElement).getAllByRole(
      "listitem",
    );

  it("shows the next khatma's banner and 30 rows, the open ones inviting an add", () => {
    renderAt("/j/CODE?tab=people");
    expect(
      screen.getByText(
        /الختمة ١٣ يوم الأربعاء ١١ نوفمبر. هذا جزء كل مشارك فيها/,
      ),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(30);
    expect(rows()[0]).toHaveTextContent("أنا");
    expect(rows()[1]).toHaveTextContent("مريم");
    expect(rows()[2]).toHaveTextContent("مريم");
    expect(rows()[2]).toHaveTextContent(t.rota.secondJuz);
    expect(rows()[1]).not.toHaveTextContent(t.rota.secondJuz);
    expect(rows()[6]).toHaveTextContent("+ أضف قارئاً للجزء ٧");
  });

  it("before the start, says whose juz' khatma 1 holds", () => {
    m.people = peopleView(roster, {
      number: 1,
      date: "2026-10-30",
      isFirst: true,
    });
    renderAt("/j/CODE?tab=people");
    expect(
      screen.getByText("جزء كل مشارك في الختمة ١، يوم الجمعة ٣٠ أكتوبر"),
    ).toBeInTheDocument();
  });

  it("an empty row opens the add sheet and sends the name, the number and that juz'", async () => {
    m.fns.addParticipant.mockResolvedValue({
      ok: true,
      participantId: "p9",
      juz: 7,
    });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[6]?.querySelector("button") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "قارئ الجزء ٧" });
    expect(
      within(sheet).getByText(
        "يقرأ الجزء ٧ في الختمة ١٣، ثم ٨ في الختمة ١٤، وهكذا.",
      ),
    ).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText(t.rota.personName), "خالد");
    await user.type(
      within(sheet).getByLabelText(t.rota.personPhone),
      "+971500000007",
    );
    await user.click(within(sheet).getByRole("button", { name: t.rota.add }));
    expect(m.fns.addParticipant).toHaveBeenCalledWith({
      ...args,
      name: "خالد",
      phone: "+971500000007",
      juz: 7,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("wraps the walk after juz' 30 and khatma 30", async () => {
    m.people = peopleView(roster, {
      number: 30,
      date: "2026-11-11",
      isFirst: false,
    });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[29]?.querySelector("button") as HTMLElement);
    expect(
      screen.getByText("يقرأ الجزء ٣٠ في الختمة ٣٠، ثم ١ في الختمة ١، وهكذا."),
    ).toBeInTheDocument();
  });

  it("keeps the add sheet open and says why when the number is refused", async () => {
    m.fns.addParticipant.mockResolvedValue({ error: "bad_phone" });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[6]?.querySelector("button") as HTMLElement);
    await user.type(screen.getByLabelText(t.rota.personName), "خالد");
    await user.type(screen.getByLabelText(t.rota.personPhone), "1");
    await user.click(screen.getByRole("button", { name: t.rota.add }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.addErrors.bad_phone ?? "",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a filled row moves its person to a free juz'", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "سارة" });
    // The first free juz' is preselected.
    expect(within(sheet).getByLabelText(t.rota.moveLabel)).toHaveValue("5");
    await user.selectOptions(
      within(sheet).getByLabelText(t.rota.moveLabel),
      "12",
    );
    await user.click(within(sheet).getByRole("button", { name: t.rota.move }));
    expect(m.fns.moveJuz).toHaveBeenCalledWith({
      ...args,
      participantId: "p3",
      fromJuz: 4,
      toJuz: 12,
    });
  });

  it("says who a person swaps with when the juz' is held", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    const sheet = screen.getByRole("dialog");
    await user.selectOptions(
      within(sheet).getByLabelText(t.rota.moveLabel),
      "1",
    );
    expect(within(sheet).getByText(t.rota.swapsWithMe)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: t.rota.move }));
    expect(m.fns.moveJuz).toHaveBeenCalledWith(
      expect.objectContaining({ fromJuz: 4, toJuz: 1 }),
    );
  });

  it("names the person a juz' swaps with when it is not the organizer", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    await user.selectOptions(screen.getByLabelText(t.rota.moveLabel), "2");
    expect(
      within(screen.getByRole("dialog")).getByText("سيتبادل مع مريم", {
        selector: "p",
      }),
    ).toBeInTheDocument();
  });

  it("gives the person the next free juz' as a second one", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    await user.click(
      screen.getByRole("button", { name: new RegExp(t.rota.giveMore) }),
    );
    expect(m.fns.giveJuz).toHaveBeenCalledWith({
      ...args,
      participantId: "p3",
      juz: 5,
    });
  });

  it("offers no second juz' to someone who reads the most already", async () => {
    m.people = peopleView([
      { id: "p1", name: "علي", isMe: true, juz: [1, 2, 3] },
    ]);
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[0]?.querySelector("button") as HTMLElement);
    expect(
      screen.queryByRole("button", { name: new RegExp(t.rota.giveMore) }),
    ).toBeNull();
  });

  it("removes someone only after asking", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    await user.click(screen.getByRole("button", { name: t.rota.remove }));
    expect(m.fns.removeParticipant).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", { name: "أزل سارة من الختمة؟" });
    await user.click(
      within(sheet).getByRole("button", { name: t.rota.removeConfirm }),
    );
    expect(m.fns.removeParticipant).toHaveBeenCalledWith({
      ...args,
      participantId: "p3",
    });
  });

  it("backing out of the removal removes nobody", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    await user.click(screen.getByRole("button", { name: t.rota.remove }));
    await user.click(screen.getByRole("button", { name: t.rota.cancel }));
    expect(m.fns.removeParticipant).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "سارة" })).toBeInTheDocument();
  });

  it("the organizer's own row cannot be removed", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[0]?.querySelector("button") as HTMLElement);
    expect(screen.getByRole("dialog", { name: t.rota.me })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.rota.remove })).toBeNull();
  });

  it("the organizer can stop reading: each of their ajza' is freed, and they stay", async () => {
    m.people = peopleView([
      { id: "p1", name: "علي", isMe: true, juz: [1, 5] },
      { id: "p2", name: "مريم", isMe: false, juz: [2] },
    ]);
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[0]?.querySelector("button") as HTMLElement);
    await user.click(
      screen.getByRole("button", { name: new RegExp(t.rota.stopReading) }),
    );
    expect(m.fns.freeJuz.mock.calls).toEqual([
      [{ ...args, participantId: "p1", juz: 1 }],
      [{ ...args, participantId: "p1", juz: 5 }],
    ]);
    expect(m.fns.removeParticipant).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only the organizer's own sheet offers to stop reading", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    expect(
      screen.queryByRole("button", { name: new RegExp(t.rota.stopReading) }),
    ).toBeNull();
  });

  it("an empty row can go to someone already in the khatma", async () => {
    m.people = peopleView([
      { id: "p1", name: "علي", isMe: true, juz: [1] },
      { id: "p2", name: "مريم", isMe: false, juz: [2, 3, 4] },
      { id: "p3", name: "سارة", isMe: false, juz: [] },
    ]);
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[6]?.querySelector("button") as HTMLElement);
    const sheet = screen.getByRole("dialog", { name: "قارئ الجزء ٧" });
    const existing = within(sheet).getByRole("list", {
      name: t.rota.orGiveTo,
    });
    // Maryam reads the most already.
    expect(
      within(existing).getByRole("button", { name: /مريم/ }),
    ).toBeDisabled();
    await user.click(within(existing).getByRole("button", { name: /سارة/ }));
    expect(m.fns.giveJuz).toHaveBeenCalledWith({
      ...args,
      participantId: "p3",
      juz: 7,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a refused move without closing", async () => {
    m.fns.moveJuz.mockResolvedValue({ error: "not_found" });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=people");
    await user.click(rows()[3]?.querySelector("button") as HTMLElement);
    await user.click(screen.getByRole("button", { name: t.rota.move }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.peopleErrors.not_found ?? "",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  describe("joining", () => {
    const rowOf = (n: number) => rows()[n - 1] as HTMLElement;
    const request = {
      id: "q1",
      name: "خالد",
      phoneMasked: "+971 50 ••• 2233",
      createdAt: 1,
    };
    const withRequest = () => {
      m.people = peopleView(roster, undefined, { requests: [request] });
    };

    it("says who joined, and offers a resend to a chat with each person who has not", () => {
      m.people = peopleView([
        { id: "p1", name: "علي", isMe: true, juz: [1] },
        { id: "p2", name: "مريم", isMe: false, juz: [2, 3] },
        {
          id: "p3",
          name: "سارة",
          isMe: false,
          juz: [4],
          joined: false,
          phone: "+971 50 555 0001",
        },
      ]);
      renderAt("/j/CODE?tab=people");
      expect(within(rowOf(2)).getByText(t.rota.joined)).toBeInTheDocument();
      // A person's second juz' repeats no badge.
      expect(within(rowOf(3)).queryByText(t.rota.joined)).toBeNull();
      const resend = within(rowOf(4)).getByRole("link", {
        name: t.rota.notJoined,
      });
      expect(resend).toHaveClass("min-h-14");
      const url = new URL(resend.getAttribute("href") ?? "");
      expect(url.origin + url.pathname).toBe("https://wa.me/971505550001");
      expect(url.searchParams.get("text")).toBe(
        t.rota.shareMessage("ختمة العائلة", JOIN_LINK, "monthly"),
      );
    });

    it("the organizer who has not joined opens the join link itself", () => {
      m.people = peopleView([
        { id: "p1", name: "علي", isMe: true, juz: [1], joined: false },
      ]);
      renderAt("/j/CODE?tab=people");
      expect(
        within(rowOf(1)).getByRole("link", { name: t.rota.notJoinedMe }),
      ).toHaveAttribute("href", JOIN_LINK);
    });

    it("tells apart someone who stopped the messages from someone Wirdak stopped", () => {
      m.people = peopleView([
        { id: "p1", name: "علي", isMe: true, juz: [1] },
        { id: "p2", name: "مريم", isMe: false, juz: [2], stopped: true },
        { id: "p3", name: "سارة", isMe: false, juz: [3], silenced: true },
      ]);
      renderAt("/j/CODE?tab=people");
      expect(
        within(rowOf(2)).getByText(t.rota.stoppedMessages),
      ).toBeInTheDocument();
      expect(within(rowOf(2)).queryByText(t.rota.joined)).toBeNull();
      expect(
        within(rowOf(3)).getByText(t.rota.silencedMessages),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: t.rota.notJoined })).toBeNull();
    });

    it("has the share button at the bottom, opening the group message that says how often it is read", () => {
      renderAt("/j/CODE?tab=people");
      const share = screen.getByRole("link", { name: t.rota.shareJoin });
      expect(share).toHaveAttribute(
        "href",
        `https://wa.me/?text=${encodeURIComponent(
          `السلام عليكم، بدأنا ختمة العائلة، ختمة شهرية بالتناوب. اضغطوا الرابط وأرسلوا الرسالة كما هي: ${JOIN_LINK}`,
        )}`,
      );
      expect(rows()[29]?.compareDocumentPosition(share)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it("asks for a join link once when the khatma has none, and shows no share or resend meanwhile", () => {
      m.people = peopleView(
        [
          { id: "p1", name: "علي", isMe: true, juz: [1] },
          { id: "p2", name: "مريم", isMe: false, juz: [2], joined: false },
        ],
        undefined,
        { joinLink: null },
      );
      renderAt("/j/CODE?tab=people");
      expect(m.fns.ensureJoinLink).toHaveBeenCalledTimes(1);
      expect(m.fns.ensureJoinLink).toHaveBeenCalledWith(args);
      expect(screen.queryByRole("link", { name: t.rota.shareJoin })).toBeNull();
      expect(screen.queryByRole("link", { name: t.rota.notJoined })).toBeNull();
    });

    it("does not ask while the link exists", () => {
      renderAt("/j/CODE?tab=people");
      expect(m.fns.ensureJoinLink).not.toHaveBeenCalled();
    });

    it("lists the join requests above the rows, the number masked, with a select of the free ajza'", () => {
      withRequest();
      renderAt("/j/CODE?tab=people");
      const section = screen.getByRole("region", {
        name: t.rota.requestsHeading,
      });
      expect(section).toHaveTextContent("خالد · +971 50 ••• 2233");
      expect(
        section.compareDocumentPosition(
          document.querySelector("ol") as HTMLElement,
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      const select = within(section).getByLabelText(t.rota.requestJuz);
      // 30 minus the four held.
      expect(within(select).getAllByRole("option")).toHaveLength(26);
      expect(select).toHaveValue("5");
    });

    it("«أضفه واختر جزأه» sends the request and the chosen juz'", async () => {
      withRequest();
      const user = userEvent.setup();
      renderAt("/j/CODE?tab=people");
      await user.selectOptions(screen.getByLabelText(t.rota.requestJuz), "12");
      await user.click(
        screen.getByRole("button", { name: t.rota.acceptRequest }),
      );
      expect(m.fns.acceptJoinRequest).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        requestId: "q1",
        juz: 12,
      });
    });

    it("«لا» declines the request", async () => {
      withRequest();
      const user = userEvent.setup();
      renderAt("/j/CODE?tab=people");
      await user.click(
        screen.getByRole("button", { name: t.rota.declineRequest }),
      );
      expect(m.fns.declineJoinRequest).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        requestId: "q1",
      });
      expect(m.fns.acceptJoinRequest).not.toHaveBeenCalled();
    });

    it("says why a request was refused", async () => {
      withRequest();
      m.fns.acceptJoinRequest.mockResolvedValue({ error: "juz_taken" });
      const user = userEvent.setup();
      renderAt("/j/CODE?tab=people");
      await user.click(
        screen.getByRole("button", { name: t.rota.acceptRequest }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.joinRequestErrors.juz_taken ?? "",
      );
    });

    it("cannot accept when no juz' is free", () => {
      m.people = peopleView(
        Array.from({ length: 30 }, (_, i) => ({
          id: `h${i}`,
          name: `ق${i}`,
          isMe: i === 0,
          juz: [i + 1],
        })),
        undefined,
        { requests: [request] },
      );
      renderAt("/j/CODE?tab=people");
      expect(
        screen.getByRole("button", { name: t.rota.acceptRequest }),
      ).toBeDisabled();
    });

    it("shows no requests section without requests", () => {
      renderAt("/j/CODE?tab=people");
      expect(
        screen.queryByRole("region", { name: t.rota.requestsHeading }),
      ).toBeNull();
    });
  });
});

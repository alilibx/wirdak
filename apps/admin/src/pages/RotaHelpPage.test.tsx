import { t as webT } from "@web/i18n/ar";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { RotaHelpPage } from "./RotaHelpPage";

const m = vi.hoisted(() => ({
  today: undefined as unknown,
  settings: undefined as unknown,
  people: undefined as unknown,
  read: [] as { name: string; args: unknown }[],
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      const name = getFunctionName(ref);
      m.read.push({ name, args });
      if (name === "adminRota:today") return m.today;
      if (name === "adminRota:settings") return m.settings;
      if (name === "adminRota:people") return m.people;
      if (name === "adminRota:saved") return [];
      return undefined;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
    useAction: () => vi.fn(),
  };
});
vi.mock("../lib/adminSession", () => ({
  useAdminToken: () => "tok",
  getAdminToken: () => "tok",
}));

const scope = { adminToken: "tok", khatmaId: "k1" };
const tile = {
  readId: "r1",
  juz: 1,
  state: "unread",
  holderName: "أم خالد",
  readerName: "أم خالد",
  readerId: "p1",
  answer: "none",
};
const today = {
  day: {
    number: 1,
    cycle: 1,
    date: "2027-01-16",
    doneCount: 0,
    completedAt: null,
  },
  next: { number: 2, date: "2027-01-17" },
  paused: false,
  archived: false,
  setupDone: true,
  tiles: [tile],
  participants: [{ id: "p1", name: "أم خالد", isMe: false, doneToday: false }],
};
const settings = {
  name: "ختمة العائلة",
  days: { kind: "daily" },
  firstDate: "2027-01-16",
  firstDatePassed: false,
  endDate: null,
  timeZone: "Asia/Dubai",
  messages: {
    dayAt: 480,
    reminder: { at: 960, on: true },
    unread: { at: 1140, on: false },
    summary: { at: 1260, on: false },
  },
  pausedAt: null,
  pauseDates: [],
  upcoming: [],
  quiet: { startHour: 22, endHour: 7 },
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
  archived: false,
};
const organizer = {
  id: "p1",
  name: "أم خالد",
  isMe: false,
  phone: "+971500009000",
  joined: false,
  stopped: false,
  silenced: false,
};
const people = {
  title: "ختمة العائلة",
  daysKind: "daily",
  joinLink: "https://wa.me/971500000000?text=join",
  requests: [],
  target: { number: 1, date: "2027-01-16", isFirst: true },
  rows: Array.from({ length: 30 }, (_, i) => ({
    juz: i + 1,
    participant: i === 0 ? { ...organizer, slots: 1 } : null,
  })),
  participants: [{ ...organizer, juz: [1] }],
  freeJuz: Array.from({ length: 29 }, (_, i) => i + 2),
  maxSlots: 3,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/khatmas/k1/rota"]}>
      <Routes>
        <Route path="/khatmas/:khatmaId/rota" element={<RotaHelpPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.today = today;
  m.settings = settings;
  m.people = people;
  m.read = [];
  m.fns = {};
});

describe("RotaHelpPage", () => {
  it("says the admin is helping, and every change is recorded", () => {
    renderPage();
    expect(screen.getByRole("note")).toHaveTextContent(t.rota.helpStrip);
    expect(t.rota.helpStrip).toBe("تساعد بصفتك مشرفاً. كل تغيير يُسجَّل.");
    expect(
      screen.getByRole("heading", { name: "ختمة العائلة" }),
    ).toBeInTheDocument();
  });

  it("reads only the admin's functions, by khatma", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: webT.rota.tabs.people }));
    await user.click(
      screen.getByRole("tab", { name: webT.khatmaSettings.link }),
    );
    const names = new Set(m.read.map((r) => r.name));
    expect([...names].sort()).toEqual([
      "adminRota:people",
      "adminRota:settings",
      "adminRota:today",
    ]);
    for (const read of m.read) expect(read.args).toEqual(scope);
  });

  it("runs Today: marking a juz' goes to the admin's function", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole("button", {
        name: webT.rota.tileLabel(1, webT.rota.legendUnread),
      }),
    );
    // Nobody is "me" to an admin: they reassign like anyone else.
    expect(
      screen.queryByRole("button", { name: webT.rota.readMyself }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: webT.rota.markDone }));
    expect(m.fns["adminRota:markDone"]).toHaveBeenCalledWith({
      ...scope,
      readId: "r1",
    });
  });

  it("runs People: the organizer's row is an ordinary row with a way to reach them", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: webT.rota.tabs.people }));
    expect(screen.getByRole("button", { name: /أم خالد/ })).toBeInTheDocument();
    expect(screen.queryByText(webT.rota.me)).toBeNull();
    expect(
      screen.getByRole("link", { name: webT.rota.notJoined }),
    ).toHaveAttribute("href", expect.stringContaining("971500009000"));
  });

  it("runs the settings", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole("tab", { name: webT.khatmaSettings.link }),
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 2, name: webT.khatmaSettings.link }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: webT.rota.pauseNow }));
    expect(m.fns["adminRota:setPaused"]).toHaveBeenCalledWith({
      ...scope,
      paused: true,
    });
    await user.click(screen.getByRole("button", { name: webT.archive.button }));
    const sheet = screen.getByRole("dialog", { name: webT.archive.title });
    await user.click(
      within(sheet).getByRole("button", { name: webT.archive.confirm }),
    );
    expect(m.fns["adminRota:archive"]).toHaveBeenCalledWith(scope);
  });

  it("an archived khatma can be deleted but not started again", async () => {
    const user = userEvent.setup();
    m.today = { ...today, archived: true };
    m.settings = { ...settings, archived: true };
    renderPage();
    await user.click(
      screen.getByRole("tab", { name: webT.khatmaSettings.link }),
    );
    expect(
      screen.getByRole("button", { name: webT.archive.delete }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: webT.archive.restart }),
    ).toBeNull();
  });

  it("a pool khatma, or one that is gone, is not found", () => {
    m.today = null;
    m.settings = null;
    renderPage();
    expect(screen.getByText(t.lookup.notFound)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });
});

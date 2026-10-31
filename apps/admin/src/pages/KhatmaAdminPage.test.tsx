import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { KhatmaAdminPage } from "./KhatmaAdminPage";

const m = vi.hoisted(() => ({
  reset: vi.fn(),
  handOver: vi.fn(),
  rota: null as unknown,
  archived: false,
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    kind: m.rota ? "rota" : "pool",
    archived: m.archived,
    rota: m.rota,
    name: "ختمة العائلة",
    inviteCode: "familyKhatma",
    schedule: "weekly",
    grace: { value: 2, unit: "days" },
    createdAt: 0,
    completedRounds: 2,
    organizer: { personId: "p1", displayName: "علي" },
    members: [
      {
        memberId: "m1",
        personId: "p1",
        displayName: "علي",
        joinedAt: 0,
        status: "active",
      },
      {
        memberId: "m2",
        personId: "p2",
        displayName: "سارة",
        joinedAt: 1,
        status: "active",
      },
    ],
    round: { number: 3, startedAt: 0, free: 20, taken: 4, finished: 6 },
    openHelpRequests: 1,
  }),
  useAction: () => m.reset,
  useMutation: () => m.handOver,
}));
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

beforeEach(() => {
  m.rota = null;
  m.archived = false;
  m.reset.mockReset().mockResolvedValue({ inviteCode: "newCode00001" });
  m.handOver.mockReset().mockResolvedValue({ ok: true });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/khatmas/k1"]}>
      <Routes>
        <Route path="/khatmas/:khatmaId" element={<KhatmaAdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("KhatmaAdminPage", () => {
  it("shows the pool as three numbers, with no names next to ajza'", () => {
    renderPage();
    expect(screen.getByText("٢٠")).toBeInTheDocument();
    expect(screen.getByText("٤")).toBeInTheDocument();
    expect(screen.getByText("٦")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "سارة" })).toHaveAttribute(
      "href",
      "/people/p2",
    );
  });

  it("resets the invite link after a confirmation, with the note", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.resetInvite }),
    );
    expect(m.reset).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(t.ops.noteLabel), "leaked");
    await userEvent.click(
      screen.getAllByRole("button", { name: t.ops.resetInvite }).at(-1)!,
    );
    expect(m.reset).toHaveBeenCalledWith({
      adminToken: "tok",
      khatmaId: "k1",
      note: "leaked",
    });
  });

  it("says when a pool khatma is archived", () => {
    const { unmount } = renderPage();
    expect(screen.queryByText(t.lookup.rotaArchived)).not.toBeInTheDocument();
    unmount();
    m.archived = true;
    renderPage();
    expect(screen.getByText(t.lookup.rotaArchived)).toBeInTheDocument();
  });

  it("shows a pool khatma's schedule, and none for a rota khatma", () => {
    const { unmount } = renderPage();
    expect(screen.getByText(t.lookup.schedule)).toBeInTheDocument();
    unmount();

    m.rota = {
      days: { kind: "daily" },
      firstDate: "2026-10-01",
      endDate: null,
      pausedAt: null,
      archivedAt: null,
      number: 1,
      cycle: 1,
      dayOpen: false,
      doneToday: 0,
      total: 30,
    };
    renderPage();
    expect(screen.queryByText(t.lookup.schedule)).not.toBeInTheDocument();
  });

  it("shows nothing about rotation for a pool khatma", () => {
    renderPage();
    expect(screen.queryByText(t.lookup.kindRota)).not.toBeInTheDocument();
    expect(screen.queryByText(/اليوم$/)).not.toBeInTheDocument();
  });

  it("shows a rota khatma's days, number, cycle and the day's progress", () => {
    m.rota = {
      days: { kind: "weekly", weekdays: [1, 4], everyWeeks: 1 },
      firstDate: "2026-10-01",
      endDate: null,
      pausedAt: null,
      archivedAt: null,
      number: 12,
      cycle: 1,
      dayOpen: true,
      doneToday: 27,
      total: 30,
    };
    renderPage();
    expect(screen.getByText(t.lookup.kindRota)).toBeInTheDocument();
    expect(screen.getByText("كل أسبوع: الاثنين، الخميس")).toBeInTheDocument();
    expect(screen.getByText("الختمة ١٢ · الدورة ١")).toBeInTheDocument();
    expect(screen.getByText("٢٧ / ٣٠ اليوم")).toBeInTheDocument();
    expect(screen.queryByText(t.lookup.rotaPaused)).not.toBeInTheDocument();
  });

  it("says when a rota khatma is paused or archived", () => {
    const rota = {
      days: { kind: "daily" },
      firstDate: "2026-10-01",
      endDate: "2026-12-01",
      number: null,
      cycle: null,
      dayOpen: false,
      doneToday: 0,
      total: 30,
    };
    m.rota = { ...rota, pausedAt: 5, archivedAt: null };
    const { unmount } = renderPage();
    expect(screen.getByText(t.lookup.rotaPaused)).toBeInTheDocument();
    expect(screen.getByText(t.lookup.rotaNoDay)).toBeInTheDocument();
    unmount();
    m.rota = { ...rota, pausedAt: null, archivedAt: 9 };
    renderPage();
    expect(screen.getByText(t.lookup.rotaArchived)).toBeInTheDocument();
  });

  const running = {
    days: { kind: "daily" },
    firstDate: "2026-10-01",
    endDate: null,
    pausedAt: null,
    archivedAt: null,
    pendingOrganizer: false,
    joinLink: "https://wa.me/971500000000?text=join",
    number: null,
    cycle: null,
    dayOpen: false,
    doneToday: 0,
    total: 30,
  };

  it("offers a pool khatma no help page and no join link", () => {
    renderPage();
    expect(screen.queryByRole("link", { name: t.rota.help })).toBeNull();
    expect(screen.queryByRole("button", { name: t.rota.copy })).toBeNull();
  });

  it("links a rota khatma's help page, and copies its join link", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    m.rota = running;
    renderPage();
    expect(screen.getByRole("link", { name: t.rota.help })).toHaveAttribute(
      "href",
      "/khatmas/k1/rota",
    );
    expect(screen.queryByText(t.rota.pending)).toBeNull();

    await user.click(screen.getByRole("button", { name: t.rota.copy }));
    expect(writeText).toHaveBeenCalledWith(running.joinLink);
    expect(screen.getByRole("status")).toHaveTextContent(t.rota.copied);
  });

  it("says a khatma waits for its organizer", () => {
    m.rota = { ...running, pendingOrganizer: true };
    renderPage();
    expect(screen.getByText(t.rota.pending)).toBeInTheDocument();
    expect(t.rota.pending).toBe("بانتظار المنظّم");
  });

  it("has nothing to copy without a join link", () => {
    m.rota = { ...running, joinLink: null };
    renderPage();
    expect(screen.queryByRole("button", { name: t.rota.copy })).toBeNull();
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { KhatmaAdminPage } from "./KhatmaAdminPage";

const m = vi.hoisted(() => ({
  reset: vi.fn(),
  handOver: vi.fn(),
  mutation: vi.fn(),
  rota: null as unknown,
  archived: false,
  blockedMember: false,
  handOverCandidates: [{ memberId: "m2", name: "سارة" }] as unknown[],
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
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
          status: m.blockedMember ? "blocked" : "active",
        },
      ],
      coOrganizers: [
        {
          coOrganizerId: "c1",
          name: "خالد",
          readings: true,
          people: false,
          settings: true,
          pending: false,
        },
        {
          coOrganizerId: "c2",
          name: "نور",
          readings: false,
          people: false,
          settings: false,
          pending: true,
        },
      ],
      coOrganizerCandidates: [{ candidateId: "m:m2", name: "سارة" }],
      handOverCandidates: m.handOverCandidates,
      round: { number: 3, startedAt: 0, free: 20, taken: 4, finished: 6 },
      openHelpRequests: 1,
    }),
    useAction: () => m.reset,
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      return name === "adminOps:handOver"
        ? m.handOver
        : (args: unknown) => m.mutation(name, args);
    },
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

beforeEach(() => {
  m.rota = null;
  m.archived = false;
  m.blockedMember = false;
  m.handOverCandidates = [{ memberId: "m2", name: "سارة" }];
  m.mutation.mockReset().mockResolvedValue({ ok: true });
  m.reset.mockReset().mockResolvedValue({ inviteCode: "newCode00001" });
  m.handOver.mockReset().mockResolvedValue({ ok: true });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/khatmas/k1"]}>
      <Routes>
        <Route path="/khatmas/:khatmaId" element={<KhatmaAdminPage />} />
        <Route path="/khatmas" element={<p>the list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Opens a confirmation from its button, then presses the same label inside it. */
async function confirmOp(label: string, note?: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
  if (note) await userEvent.type(screen.getByLabelText(t.ops.noteLabel), note);
  await userEvent.click(screen.getAllByRole("button", { name: label }).at(-1)!);
}

const buttons = () =>
  screen.getAllByRole("button").map((button) => button.textContent);

describe("KhatmaAdminPage lifecycle", () => {
  it("offers a live pool khatma edit and archive, not restore or delete", () => {
    renderPage();
    expect(buttons()).toEqual(
      expect.arrayContaining([t.ops.editKhatma, t.ops.archive]),
    );
    expect(buttons()).not.toContain(t.ops.restore);
    expect(buttons()).not.toContain(t.ops.deleteKhatma);
  });

  it("archives only after the confirmation, with the note", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.ops.archive }));
    expect(m.mutation).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(t.ops.noteLabel), "مهجورة");
    await userEvent.click(
      screen.getAllByRole("button", { name: t.ops.archive }).at(-1)!,
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:archive", {
      adminToken: "tok",
      khatmaId: "k1",
      note: "مهجورة",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(t.ops.done);
  });

  it("offers an archived pool khatma restore and delete only", async () => {
    m.archived = true;
    renderPage();
    expect(buttons()).not.toContain(t.ops.archive);
    expect(buttons()).not.toContain(t.ops.editKhatma);
    await confirmOp(t.ops.restore);
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:restore", {
      adminToken: "tok",
      khatmaId: "k1",
    });
  });

  it("keeps invite reset and hand over on an archived khatma", () => {
    m.archived = true;
    renderPage();
    expect(buttons()).toContain(t.ops.resetInvite);
    expect(buttons()).toContain(t.ops.handOver);
  });

  it("goes back to the list once a khatma is deleted", async () => {
    m.archived = true;
    renderPage();
    await confirmOp(t.ops.deleteKhatma);
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:remove", {
      adminToken: "tok",
      khatmaId: "k1",
    });
    expect(await screen.findByText("the list")).toBeInTheDocument();
  });

  it("stays on the page and says why when a delete is refused", async () => {
    m.archived = true;
    m.mutation.mockResolvedValue({ error: "not_archived" });
    renderPage();
    await confirmOp(t.ops.deleteKhatma);
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.ops.errors.not_archived,
    );
    expect(screen.queryByText("the list")).not.toBeInTheDocument();
  });

  it("gives a rota khatma archive and delete, and never restore", () => {
    const rota = {
      days: { kind: "daily" },
      firstDate: "2027-01-01",
      endDate: null,
      pausedAt: null,
      archivedAt: null,
      number: null,
      cycle: null,
      doneToday: 0,
      total: 30,
      dayOpen: false,
      pendingOrganizer: false,
      joinLink: null,
    };
    m.rota = rota;
    const live = renderPage();
    expect(buttons()).toContain(t.ops.archive);
    expect(buttons()).not.toContain(t.ops.editKhatma);
    live.unmount();

    m.rota = { ...rota, archivedAt: 9 };
    m.archived = true;
    renderPage();
    expect(buttons()).toContain(t.ops.deleteKhatma);
    expect(buttons()).not.toContain(t.ops.restore);
  });

  it("saves the edited name with the schedule and grace it had", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.editKhatma }),
    );
    const name = screen.getByLabelText(t.ops.khatmaName);
    expect(name).toHaveValue("ختمة العائلة");
    await userEvent.clear(name);
    await userEvent.type(name, "ختمة الأصدقاء");
    await userEvent.click(screen.getByRole("button", { name: t.ops.save }));
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:update", {
      adminToken: "tok",
      khatmaId: "k1",
      name: "ختمة الأصدقاء",
      schedule: "weekly",
      grace: { value: 2, unit: "days" },
    });
  });

  it("removes a member, never the organizer", async () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: t.ops.removeMemberOf("علي") }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.removeMemberOf("سارة") }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.removeMember }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:removeMember", {
      adminToken: "tok",
      khatmaId: "k1",
      memberId: "m2",
    });
  });

  it("lets a blocked member back", async () => {
    m.blockedMember = true;
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.unblockMemberOf("سارة") }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.unblockMember }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:unblockMember", {
      adminToken: "tok",
      khatmaId: "k1",
      memberId: "m2",
    });
  });
});

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

describe("KhatmaAdminPage co-organizers", () => {
  it("lists co-organizers with their permissions in words", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: t.coOrganizers.title }),
    ).toBeInTheDocument();
    expect(screen.getByText("خالد")).toBeInTheDocument();
    expect(
      screen.getByText(t.coOrganizers.permissions("القراءة، الإعدادات")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t.coOrganizers.permissions(t.coOrganizers.noPermissions),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(t.coOrganizers.pending)),
    ).toBeInTheDocument();
  });

  it("names a co-organizer with the three switches and a note", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.coOrganizers.add }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText(t.coOrganizers.pick),
      "m:m2",
    );
    await userEvent.click(
      screen.getByRole("switch", { name: t.coOrganizers.people }),
    );
    await userEvent.type(screen.getByLabelText(t.ops.noteLabel), "طلب");
    await userEvent.click(
      screen.getByRole("button", { name: t.coOrganizers.save }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:setCoOrganizer", {
      adminToken: "tok",
      khatmaId: "k1",
      candidateId: "m:m2",
      readings: true,
      people: false,
      settings: true,
      note: "طلب",
    });
  });

  it("edits the switches of one already named, and removes another", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.coOrganizers.editOf("خالد") }),
    );
    await userEvent.click(
      screen.getByRole("switch", { name: t.coOrganizers.people }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: t.coOrganizers.save }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:setCoOrganizer", {
      adminToken: "tok",
      khatmaId: "k1",
      coOrganizerId: "c1",
      readings: true,
      people: true,
      settings: true,
    });
    await userEvent.click(
      screen.getByRole("button", { name: t.coOrganizers.removeOf("نور") }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: t.coOrganizers.remove }).at(-1)!,
    );
    expect(m.mutation).toHaveBeenCalledWith("adminKhatmas:removeCoOrganizer", {
      adminToken: "tok",
      khatmaId: "k1",
      coOrganizerId: "c2",
    });
  });

  it("hands a rota khatma to a participant by participantId, and says when they have no account", async () => {
    m.handOverCandidates = [{ participantId: "r1", name: "هدى" }];
    m.handOver.mockResolvedValue({ error: "no_account" });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.ops.handOver }));
    await userEvent.selectOptions(
      screen.getByLabelText(t.ops.pickMember),
      "p:r1",
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: t.ops.handOver }).at(-1)!,
    );
    expect(m.handOver).toHaveBeenCalledWith({
      adminToken: "tok",
      khatmaId: "k1",
      participantId: "r1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.ops.errors.no_account,
    );
  });
});

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { OrganizerPage } from "./OrganizerPage";

type Fn =
  "update" | "removeMember" | "unblock" | "handOver" | "archive" | "remove";

const m = vi.hoisted(() => ({
  settings: undefined as unknown,
  /** What `api.rota.settings` answers: null for a pool khatma. */
  rotaSettings: null as unknown,
  /** What `api.coOrganizers.list` answers. */
  coList: undefined as unknown,
  /** What `api.rota.people` answers (the rota transfer picker). */
  people: undefined as unknown,
  fns: {
    update: vi.fn(),
    removeMember: vi.fn(),
    unblock: vi.fn(),
    handOver: vi.fn(),
    archive: vi.fn(),
    remove: vi.fn(),
  },
  coFns: {
    "coOrganizers:set": vi.fn(),
    "coOrganizers:remove": vi.fn(),
  } as Record<string, ReturnType<typeof vi.fn>>,
  resetInvite: vi.fn(),
  /** When set, navigate() does nothing, so a test can stop between the action and the route change. */
  holdNavigation: false,
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return ((...args: Parameters<typeof navigate>) =>
        m.holdNavigation ? undefined : navigate(...args)) as typeof navigate;
    },
  };
});
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(ref);
      if (name === "rota:settings") return m.rotaSettings;
      if (name === "coOrganizers:list") return m.coList;
      if (name === "rota:people") return m.people;
      return m.settings;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      if (name.startsWith("coOrganizers:")) return m.coFns[name];
      return m.fns[name.split(":")[1] as Fn];
    },
    useAction: () => m.resetInvite,
  };
});

const OWNER = { owner: true, readings: true, people: true, settings: true };
const coOrganizer = (switches: Partial<typeof OWNER>) => ({
  owner: false,
  readings: false,
  people: false,
  settings: false,
  ...switches,
});

const organizerView = {
  name: "ختمة العائلة",
  schedule: "weekly",
  grace: { value: 2, unit: "days" },
  suggestedGrace: { value: 2, unit: "days" },
  members: [
    {
      memberId: "m1",
      displayName: "أبو علي",
      isOrganizer: true,
      isCoOrganizer: false,
    },
    {
      memberId: "m2",
      displayName: "سارة",
      isOrganizer: false,
      isCoOrganizer: false,
    },
    {
      memberId: "m3",
      displayName: "خالد",
      isOrganizer: false,
      isCoOrganizer: false,
    },
  ],
  blocked: [{ memberId: "m9", displayName: "ليلى" }],
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
  access: OWNER,
};

const visited: string[] = [];

function Where() {
  const location = useLocation();
  useEffect(() => {
    visited.push(location.pathname);
  }, [location.pathname]);
  return (
    <output data-testid="where">
      {location.pathname}|{JSON.stringify(location.state)}
    </output>
  );
}

function renderPage() {
  return render(tree());
}

function tree() {
  return (
    <MemoryRouter initialEntries={["/j/CODE/settings"]}>
      <Where />
      <Routes>
        <Route path="/j/:inviteCode" element={<p>khatma-page</p>} />
        <Route path="/j/:inviteCode/settings" element={<OrganizerPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const section = (name: string) => screen.getByRole("region", { name });

describe("OrganizerPage", () => {
  beforeEach(() => {
    visited.length = 0;
    Object.values(m.fns).forEach((f) =>
      f.mockReset().mockResolvedValue({ ok: true }),
    );
    m.resetInvite.mockReset().mockResolvedValue({ inviteCode: "NEWCODE" });
    m.holdNavigation = false;
    m.settings = structuredClone(organizerView);
    m.rotaSettings = null;
    m.coList = {
      max: 5,
      enabled: true,
      defaults: { readings: true, people: true, settings: true },
      coOrganizers: [],
      candidates: [{ candidateId: "m:m2", name: "سارة" }],
    };
    m.people = undefined;
    Object.values(m.coFns).forEach((f) =>
      f.mockReset().mockResolvedValue({ ok: true }),
    );
  });

  it("shows the rotating khatma's own settings for a rota khatma", () => {
    m.rotaSettings = {
      name: "ختمة الجمعة",
      days: { kind: "daily" },
      firstDate: "2026-10-30",
      firstDatePassed: false,
      endDate: null,
      timeZone: "Asia/Dubai",
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
      access: { owner: true, readings: true, people: true, settings: true },
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
    renderPage();
    expect(screen.getByLabelText(t.rota.nameLabel)).toHaveValue("ختمة الجمعة");
    expect(screen.queryByText(t.organizer.membersHeading)).toBeNull();
  });

  it("non-organizer is sent back to the khatma", () => {
    m.settings = { forbidden: true };
    renderPage();
    expect(screen.getByText("khatma-page")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/j\/CODE\|/);
  });

  it("links back to the khatma's group tab", () => {
    renderPage();
    expect(
      screen.getByRole("link", { name: t.organizer.back }),
    ).toHaveAttribute("href", "/j/CODE?tab=group");
  });

  it("shows a loading state until the settings arrive", () => {
    m.settings = undefined;
    renderPage();
    expect(screen.getByText(t.common.loading)).toBeInTheDocument();
  });

  it("member rows show names only and no reading data", () => {
    renderPage();
    const rows = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("أبو علي");
    expect(rows[0]).toHaveTextContent(t.organizer.organizerBadge);
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    expect(rows[1]).toHaveTextContent(/^سارة/);
    expect(rows[1]).not.toHaveTextContent(/[٠-٩0-9]/);
    expect(
      within(rows[1]!).getByRole("button", { name: /^انقل ملكية الختمة/ }),
    ).toBeVisible();
    expect(
      within(rows[1]!).getByRole("button", { name: /^إزالة/ }),
    ).toBeVisible();
  });

  it("saves the name and the schedule with their own buttons", async () => {
    const user = userEvent.setup();
    renderPage();
    const nameBox = screen.getByLabelText(t.create.nameLabel);
    await user.clear(nameBox);
    await user.type(nameBox, "  ختمة الجيران ");
    await user.click(
      within(section(t.organizer.nameHeading)).getByRole("button", {
        name: t.organizer.save,
      }),
    );
    expect(m.fns.update).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      name: "ختمة الجيران",
    });
    // The confirmation sits under the button that was tapped, not at the foot of the page.
    expect(
      await within(section(t.organizer.nameHeading)).findByRole("status"),
    ).toHaveTextContent(t.organizer.saved);
    expect(
      within(section(t.create.scheduleLegend)).getByRole("status"),
    ).toBeEmptyDOMElement();

    const scheduleSection = section(t.create.scheduleLegend);
    expect(scheduleSection).toHaveTextContent(t.organizer.scheduleNote);
    await user.click(within(scheduleSection).getByLabelText("شهرية"));
    await user.click(
      within(scheduleSection).getByRole("button", { name: t.organizer.save }),
    );
    expect(m.fns.update).toHaveBeenLastCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      schedule: "monthly",
    });
    expect(
      await within(scheduleSection).findByText(t.organizer.saved),
    ).toBeInTheDocument();
  });

  it("an emptied name is sent as null", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.clear(screen.getByLabelText(t.create.nameLabel));
    await user.click(
      within(section(t.organizer.nameHeading)).getByRole("button", {
        name: t.organizer.save,
      }),
    );
    expect(m.fns.update).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      name: null,
    });
  });

  it("save stays off until something changed", () => {
    renderPage();
    for (const name of [
      t.organizer.nameHeading,
      t.create.scheduleLegend,
      t.grace.label,
    ]) {
      expect(
        within(section(name)).getByRole("button", { name: t.organizer.save }),
      ).toBeDisabled();
    }
  });

  it("saves the khatma's own cheer settings", async () => {
    const user = userEvent.setup();
    renderPage();
    const cheerSection = section(t.cheer.heading);
    await user.selectOptions(
      within(cheerSection).getByLabelText(t.cheer.gapLabel),
      "0",
    );
    await user.click(
      within(cheerSection).getByRole("button", { name: t.organizer.save }),
    );
    expect(m.fns.update).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      cheer: {
        on: true,
        everyone: false,
        gapMs: 0,
        showName: false,
        showJuz: false,
      },
    });
    expect(await within(cheerSection).findByRole("status")).toHaveTextContent(
      t.organizer.saved,
    );
  });

  it("saves the grace, and shows the suggestion only when it differs", async () => {
    m.settings = {
      ...structuredClone(organizerView),
      grace: { value: 3, unit: "days" },
    };
    const user = userEvent.setup();
    renderPage();
    const graceSection = section(t.grace.label);
    expect(graceSection).toHaveTextContent(t.organizer.graceNote);
    expect(graceSection).toHaveTextContent(
      t.organizer.suggested(t.grace.amount.days(2)),
    );
    await user.click(
      within(graceSection).getByRole("button", { name: /تغيير/ }),
    );
    const amount = within(graceSection).getByLabelText(t.grace.amountLabel);
    await user.clear(amount);
    await user.type(amount, "٥");
    await user.click(
      within(graceSection).getByRole("button", { name: t.organizer.save }),
    );
    expect(m.fns.update).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      grace: { value: 5, unit: "days" },
    });
  });

  it("hides the suggestion when it equals the current grace", () => {
    renderPage();
    expect(section(t.grace.label)).not.toHaveTextContent("المقترح");
  });

  it("an out-of-range grace cannot be saved", async () => {
    const user = userEvent.setup();
    renderPage();
    const graceSection = section(t.grace.label);
    await user.click(
      within(graceSection).getByRole("button", { name: /تغيير/ }),
    );
    const amount = within(graceSection).getByLabelText(t.grace.amountLabel);
    await user.clear(amount);
    await user.type(amount, "99");
    expect(
      within(graceSection).getByRole("button", { name: t.organizer.save }),
    ).toBeDisabled();
    expect(m.fns.update).not.toHaveBeenCalled();
  });

  it("shows the network copy when saving throws", async () => {
    m.fns.update.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText(t.create.nameLabel), "x");
    await user.click(
      within(section(t.organizer.nameHeading)).getByRole("button", {
        name: t.organizer.save,
      }),
    );
    expect(
      await within(section(t.organizer.nameHeading)).findByRole("alert"),
    ).toHaveTextContent(t.errors.network);
  });

  it("remove asks for confirmation first", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    )[1]!;
    await user.click(within(row).getByRole("button", { name: /^إزالة/ }));
    expect(m.fns.removeMember).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent(
      "سيعود جزؤه إلى الختمة، ولن يستطيع الانضمام مرة أخرى حتى تسمح له.",
    );
    await user.click(within(sheet).getByRole("button", { name: "إزالة" }));
    expect(m.fns.removeMember).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      memberId: "m2",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelling the removal sheet removes nobody", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    )[2]!;
    await user.click(within(row).getByRole("button", { name: /^إزالة/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.organizer.cancel,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.fns.removeMember).not.toHaveBeenCalled();
  });

  it("handover confirmation then returns to the khatma", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    )[1]!;
    await user.click(
      within(row).getByRole("button", { name: /^انقل ملكية الختمة/ }),
    );
    expect(m.fns.handOver).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "انقل الملكية",
      }),
    );
    expect(m.fns.handOver).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      memberId: "m2",
    });
    expect(await screen.findByText("khatma-page")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/j\/CODE\|/);
  });

  it("a refused handover stays here and says so", async () => {
    m.fns.handOver.mockResolvedValue({ ok: false, reason: "not_member" });
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    )[1]!;
    await user.click(
      within(row).getByRole("button", { name: /^انقل ملكية الختمة/ }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "انقل الملكية",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.generic,
    );
    expect(screen.queryByText("khatma-page")).toBeNull();
  });

  it("a mid-session forbidden sends the person back to the khatma", async () => {
    m.fns.removeMember.mockRejectedValue(
      new ConvexError({ code: "forbidden" }),
    );
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.membersHeading)).getAllByRole(
      "listitem",
    )[1]!;
    await user.click(within(row).getByRole("button", { name: /^إزالة/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "إزالة" }),
    );
    expect(await screen.findByText("khatma-page")).toBeInTheDocument();
  });

  it("lets a blocked person back in", async () => {
    const user = userEvent.setup();
    renderPage();
    const row = within(section(t.organizer.blockedHeading)).getByRole(
      "listitem",
    );
    expect(row).toHaveTextContent("ليلى");
    await user.click(
      within(row).getByRole("button", { name: /^السماح بالعودة/ }),
    );
    expect(m.fns.unblock).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      memberId: "m9",
    });
  });

  it("hides the blocked section when nobody is blocked", () => {
    (m.settings as typeof organizerView).blocked = [];
    renderPage();
    expect(
      screen.queryByRole("region", { name: t.organizer.blockedHeading }),
    ).toBeNull();
  });

  it("reset asks first, then navigates to the new code and opens the invite sheet", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(section(t.organizer.resetHeading)).getByRole("button", {
        name: t.organizer.reset,
      }),
    );
    expect(m.resetInvite).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveTextContent(
      "الروابط القديمة ستتوقف عن العمل. أرسل الرابط الجديد إلى المجموعة.",
    );
    await user.click(
      within(sheet).getByRole("button", { name: t.organizer.resetConfirm }),
    );
    expect(m.resetInvite).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(await screen.findByText("khatma-page")).toBeInTheDocument();
    const where = screen.getByTestId("where");
    expect(where).toHaveTextContent(/^\/j\/NEWCODE\|/);
    expect(where).toHaveTextContent('{"openInvite":true}');
  });

  it("a refused removal shows its error inside the members section", async () => {
    m.fns.removeMember.mockResolvedValue({ ok: false, reason: "not_member" });
    const user = userEvent.setup();
    renderPage();
    const members = section(t.organizer.membersHeading);
    await user.click(
      within(within(members).getAllByRole("listitem")[1]!).getByRole("button", {
        name: /^إزالة/,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "إزالة" }),
    );
    expect(await within(members).findByRole("alert")).toHaveTextContent(
      t.errors.generic,
    );
  });

  it("a refused unblock shows the common error inside the blocked section", async () => {
    m.fns.unblock.mockResolvedValue({ ok: false });
    const user = userEvent.setup();
    renderPage();
    const blocked = section(t.organizer.blockedHeading);
    await user.click(
      within(blocked).getByRole("button", { name: /^السماح بالعودة/ }),
    );
    expect(await within(blocked).findByRole("alert")).toHaveTextContent(
      t.errors.generic,
    );
  });

  it("the old code turning forbidden mid-reset does not bounce to the dead link", async () => {
    let finish: (value: { inviteCode: string }) => void = () => {};
    m.resetInvite.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(
      within(section(t.organizer.resetHeading)).getByRole("button", {
        name: t.organizer.reset,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.organizer.resetConfirm,
      }),
    );
    // The server swapped the code: the live query for the old one is now forbidden.
    m.settings = { forbidden: true };
    view.rerender(tree());
    expect(screen.queryByText("khatma-page")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent(
      /^\/j\/CODE\/settings\|/,
    );
    await act(async () => finish({ inviteCode: "NEWCODE" }));
    expect(await screen.findByText("khatma-page")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/j\/NEWCODE\|/);
    expect(visited).not.toContain("/j/CODE");
  });

  it("the old code turning forbidden after the reset succeeds but before the route changes does not bounce", async () => {
    m.holdNavigation = true;
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(
      within(section(t.organizer.resetHeading)).getByRole("button", {
        name: t.organizer.reset,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.organizer.resetConfirm,
      }),
    );
    await vi.waitFor(() => expect(m.resetInvite).toHaveBeenCalled());
    await act(async () => {});
    // The action resolved and navigate() was called, but the route is still the old one.
    m.settings = { forbidden: true };
    view.rerender(tree());
    expect(screen.queryByText("khatma-page")).toBeNull();
    expect(screen.getByTestId("where")).toHaveTextContent(
      /^\/j\/CODE\/settings\|/,
    );
    expect(visited).not.toContain("/j/CODE");
  });

  it("a failed reset gives the page back: a later forbidden state still leaves it", async () => {
    m.resetInvite.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    const view = renderPage();
    await user.click(
      within(section(t.organizer.resetHeading)).getByRole("button", {
        name: t.organizer.reset,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t.organizer.resetConfirm,
      }),
    );
    expect(
      await within(section(t.organizer.resetHeading)).findByRole("alert"),
    ).toBeInTheDocument();
    m.settings = { forbidden: true };
    view.rerender(tree());
    expect(await screen.findByText("khatma-page")).toBeInTheDocument();
  });

  describe("archiving and deleting", () => {
    it("archives after a confirmation that says messages stop and nothing is lost", async () => {
      const user = userEvent.setup();
      renderPage();
      expect(
        screen.queryByRole("button", { name: t.archive.delete }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: t.archive.button }));
      const sheet = screen.getByRole("dialog", { name: t.archive.title });
      expect(within(sheet).getByText(t.archive.body)).toBeInTheDocument();
      expect(m.fns.archive).not.toHaveBeenCalled();
      await user.click(
        within(sheet).getByRole("button", { name: t.archive.confirm }),
      );
      expect(m.fns.archive).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
      });
    });

    it("an archived khatma hides every control that changes it", () => {
      m.settings = { ...organizerView, archived: true };
      renderPage();
      expect(screen.getByText(t.rota.archivedSettings)).toBeInTheDocument();
      // Names stay readable; no field, no save, no member action, no reset.
      expect(screen.getByText("سارة")).toBeInTheDocument();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("radio")).toBeNull();
      for (const name of [
        t.organizer.save,
        t.organizer.reset,
        t.archive.button,
      ]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(
        screen.queryByRole("button", {
          name: `${t.organizer.remove}: سارة`,
        }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: new RegExp(t.organizer.allow) }),
      ).toBeNull();
    });

    it("an archived pool khatma can be deleted, not started again", async () => {
      m.settings = { ...organizerView, archived: true };
      const user = userEvent.setup();
      renderPage();
      expect(
        screen.queryByRole("button", { name: t.archive.restart }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: t.archive.delete }));
      await user.type(
        screen.getByLabelText(t.archive.deleteTypeLabel),
        t.archive.deleteWord,
      );
      const sheet = screen.getByRole("dialog", { name: t.archive.deleteTitle });
      expect(within(sheet).getByText(t.archive.deleteBody)).toBeInTheDocument();
      expect(m.fns.remove).not.toHaveBeenCalled();
      await user.click(
        within(sheet).getByRole("button", { name: t.archive.deleteConfirm }),
      );
      expect(m.fns.remove).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
      });
    });

    it("while a delete runs, the page stays on «جارٍ الحذف» when its settings turn forbidden", async () => {
      m.settings = { ...organizerView, archived: true };
      m.fns.remove.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      const view = renderPage();
      await user.click(screen.getByRole("button", { name: t.archive.delete }));
      await user.type(
        screen.getByLabelText(t.archive.deleteTypeLabel),
        t.archive.deleteWord,
      );
      await user.click(
        screen.getByRole("button", { name: t.archive.deleteConfirm }),
      );
      m.settings = { forbidden: true };
      view.rerender(tree());
      expect(screen.getByText(t.archive.deleting)).toBeInTheDocument();
      expect(screen.queryByText("khatma-page")).toBeNull();
      expect(visited).not.toContain("/j/CODE");
    });

    it("says an organizer change was refused because the khatma got archived", async () => {
      m.fns.update.mockRejectedValue(new ConvexError({ code: "archived" }));
      const user = userEvent.setup();
      renderPage();
      const name = section(t.organizer.nameHeading);
      await user.type(within(name).getByRole("textbox"), "x");
      await user.click(
        within(name).getByRole("button", { name: t.organizer.save }),
      );
      expect(await within(name).findByRole("alert")).toHaveTextContent(
        t.organizer.errors.archived,
      );
    });
  });

  describe("co-organizers", () => {
    const withCoOrganizer = (access: ReturnType<typeof coOrganizer>) => {
      const view = structuredClone(organizerView) as typeof organizerView & {
        access: ReturnType<typeof coOrganizer>;
      };
      // Khalid helps run the khatma too; the viewer is another co-organizer.
      view.members[2]!.isCoOrganizer = true;
      view.access = access;
      return view;
    };
    const memberRows = () =>
      within(section(t.organizer.membersHeading)).getAllByRole("listitem");

    it("the owner sees the co-organizer section, and members labelled «منظّم مساعد»", () => {
      const view = withCoOrganizer(coOrganizer({}));
      view.access = OWNER;
      m.settings = view;
      renderPage();
      expect(
        screen.getByRole("region", { name: t.coOrganizers.heading }),
      ).toBeInTheDocument();
      expect(memberRows()[2]).toHaveTextContent("منظّم مساعد");
      expect(memberRows()[1]).not.toHaveTextContent("منظّم مساعد");
      // The owner can still remove a co-organizer, or hand them the khatma.
      expect(
        within(memberRows()[2]!).getByRole("button", { name: /^إزالة/ }),
      ).toBeInTheDocument();
    });

    it("a co-organizer never sees archive, delete, or transfer", () => {
      m.settings = withCoOrganizer(
        coOrganizer({ readings: true, people: true, settings: true }),
      );
      const view = renderPage();
      expect(
        screen.queryByRole("button", { name: t.archive.button }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^انقل ملكية الختمة/ }),
      ).toBeNull();
      expect(
        screen.queryByRole("region", { name: t.coOrganizers.heading }),
      ).toBeNull();
      // Their switches still give them the rest.
      expect(
        screen.getByRole("region", { name: t.organizer.nameHeading }),
      ).toBeInTheDocument();
      expect(
        within(memberRows()[1]!).getByRole("button", { name: /^إزالة/ }),
      ).toBeInTheDocument();

      m.settings = {
        ...withCoOrganizer(
          coOrganizer({ readings: true, people: true, settings: true }),
        ),
        archived: true,
      };
      view.rerender(tree());
      expect(
        screen.queryByRole("button", { name: t.archive.delete }),
      ).toBeNull();
    });

    it("a co-organizer with People sees no remove on the owner or another co-organizer", () => {
      m.settings = withCoOrganizer(coOrganizer({ people: true }));
      renderPage();
      const rows = memberRows();
      expect(within(rows[0]!).queryByRole("button")).toBeNull();
      expect(rows[2]).toHaveTextContent("منظّم مساعد");
      expect(within(rows[2]!).queryByRole("button")).toBeNull();
      expect(
        within(rows[1]!).getByRole("button", { name: /^إزالة/ }),
      ).toBeInTheDocument();
    });

    it("People alone: the member controls and the invite link, but not the name, schedule, grace or cheer", () => {
      m.settings = withCoOrganizer(coOrganizer({ people: true }));
      renderPage();
      for (const heading of [
        t.organizer.nameHeading,
        t.create.scheduleLegend,
        t.grace.label,
        t.cheer.heading,
      ]) {
        expect(screen.queryByRole("region", { name: heading })).toBeNull();
      }
      expect(
        screen.getByRole("region", { name: t.organizer.blockedHeading }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: t.organizer.reset }),
      ).toBeInTheDocument();
    });

    it("Settings alone: the form, but no member controls, blocked list or invite reset", () => {
      m.settings = withCoOrganizer(coOrganizer({ settings: true }));
      renderPage();
      expect(
        screen.getByRole("region", { name: t.organizer.nameHeading }),
      ).toBeInTheDocument();
      // The names still show.
      expect(memberRows()).toHaveLength(3);
      for (const row of memberRows()) {
        expect(within(row).queryByRole("button")).toBeNull();
      }
      expect(
        screen.queryByRole("region", { name: t.organizer.blockedHeading }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t.organizer.reset }),
      ).toBeNull();
    });

    it("says a removal was refused because that person runs the khatma", async () => {
      m.fns.removeMember.mockResolvedValue({
        ok: false,
        reason: "is_organizer",
      });
      m.settings = withCoOrganizer(coOrganizer({ people: true }));
      const user = userEvent.setup();
      renderPage();
      await user.click(
        within(memberRows()[1]!).getByRole("button", { name: /^إزالة/ }),
      );
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "إزالة",
        }),
      );
      expect(
        await within(section(t.organizer.membersHeading)).findByRole("alert"),
      ).toHaveTextContent(t.organizer.errors.is_organizer);
    });
  });

  describe("a rotating khatma's transfer", () => {
    const rotaSettings = {
      name: "ختمة الجمعة",
      days: { kind: "daily" },
      firstDate: "2026-10-30",
      firstDatePassed: false,
      endDate: null,
      timeZone: "Asia/Dubai",
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
      archived: false,
      access: OWNER,
    };
    const person = (
      id: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      name,
      isMe: false,
      juz: [1],
      phone: "+971500000000",
      joined: true,
      stopped: false,
      silenced: false,
      isOrganizer: false,
      isCoOrganizer: false,
      hasAccount: true,
      ...extra,
    });

    beforeEach(() => {
      m.rotaSettings = rotaSettings;
      m.people = {
        participants: [
          person("p1", "أبو علي", { isMe: true, isOrganizer: true }),
          person("p2", "مريم", { isCoOrganizer: true }),
          person("p3", "هدى"),
        ],
      };
    });

    it("offers every participant but the owner, and sends the participant", async () => {
      const user = userEvent.setup();
      renderPage();
      const transfer = section(t.organizer.transfer);
      const choices = within(transfer).getAllByRole("button");
      expect(choices.map((b) => b.textContent)).toEqual(["مريم", "هدى"]);
      // No number reaches this list.
      expect(transfer).not.toHaveTextContent(/[٠-٩0-9]/);
      await user.click(within(transfer).getByRole("button", { name: "هدى" }));
      const sheet = screen.getByRole("dialog", {
        name: t.organizer.transferTitle("هدى"),
      });
      await user.click(
        within(sheet).getByRole("button", {
          name: t.organizer.transferConfirm,
        }),
      );
      expect(m.fns.handOver).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        participantId: "p3",
      });
      expect(await screen.findByText("khatma-page")).toBeInTheDocument();
    });

    it("still says when the participant lost their account by the time of confirming (a stale list)", async () => {
      m.fns.handOver.mockResolvedValue({ ok: false, reason: "no_account" });
      const user = userEvent.setup();
      renderPage();
      const transfer = section(t.organizer.transfer);
      await user.click(within(transfer).getByRole("button", { name: "هدى" }));
      await user.click(
        screen.getByRole("button", { name: t.organizer.transferConfirm }),
      );
      expect(await within(transfer).findByRole("alert")).toHaveTextContent(
        t.organizer.errors.no_account,
      );
      expect(screen.queryByText("khatma-page")).toBeNull();
    });

    it("shows the owner the co-organizer section", () => {
      renderPage();
      expect(
        screen.getByRole("region", { name: t.coOrganizers.heading }),
      ).toBeInTheDocument();
    });

    it("a co-organizer with Settings sees no transfer, co-organizers, or archive", () => {
      m.rotaSettings = {
        ...rotaSettings,
        access: coOrganizer({ settings: true }),
      };
      renderPage();
      expect(screen.getByLabelText(t.rota.nameLabel)).toHaveValue(
        "ختمة الجمعة",
      );
      expect(
        screen.queryByRole("region", { name: t.organizer.transfer }),
      ).toBeNull();
      expect(
        screen.queryByRole("region", { name: t.coOrganizers.heading }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: t.archive.button }),
      ).toBeNull();
    });
  });
});

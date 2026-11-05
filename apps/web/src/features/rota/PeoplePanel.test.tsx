import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { PeoplePanel } from "./PeoplePanel";

const m = vi.hoisted(() => ({
  view: undefined as unknown,
  saved: undefined as unknown,
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("./JoinRequests", () => ({ JoinRequests: () => null }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) =>
      getFunctionName(ref) === "rota:saved" ? m.saved : m.view,
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] ?? "";
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
  };
});

const state = {
  joined: false,
  stopped: false,
  silenced: false,
  isOrganizer: false,
  isCoOrganizer: false,
};
const hidden = {
  id: "p1",
  name: "سعد",
  isMe: false,
  phone: null,
  ...state,
};
const shown = {
  id: "p2",
  name: "منى",
  isMe: false,
  phone: "+971501234567",
  ...state,
};

function makeView() {
  return {
    title: "ختمة العائلة",
    daysKind: "daily",
    joinLink: "https://wa.me/971500000000?text=JOIN",
    requests: [],
    target: { number: 2, date: "2026-10-31", isFirst: false },
    rows: Array.from({ length: 30 }, (_, i) => ({
      juz: i + 1,
      participant:
        i === 0
          ? { ...hidden, slots: 1 }
          : i === 1
            ? { ...shown, slots: 1 }
            : null,
    })),
    participants: [
      { ...hidden, juz: [1] },
      { ...shown, juz: [2] },
    ],
    freeJuz: Array.from({ length: 28 }, (_, i) => i + 3),
    phoneExample: null,
    maxSlots: 2,
  };
}

beforeEach(() => {
  m.fns = {};
  m.view = makeView();
  m.saved = [
    { id: "c1", name: "أم خالد", phone: "+971509998877", inKhatma: false },
  ];
});

describe("PeoplePanel", () => {
  it("says how many ajza' have no reader above the 30 rows, and spreads them in one press", async () => {
    m.fns.spreadFreeJuz = vi
      .fn()
      .mockResolvedValue({ ok: true, given: 2, left: 26 });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    const count = screen.getByText("بقي ٢٨ جزءاً بلا قارئ");
    const firstRow = screen.getByRole("button", { name: /سعد/ });
    expect(
      count.compareDocumentPosition(firstRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.rota.spread }));
    expect(m.fns.spreadFreeJuz).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.rota.spreadResult(26),
    );
  });

  it("shows why a spread was refused", async () => {
    m.fns.spreadFreeJuz = vi.fn().mockResolvedValue({ error: "no_room" });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(screen.getByRole("button", { name: t.rota.spread }));
    expect(
      await screen.findByText(t.rota.spreadErrors.no_room ?? ""),
    ).toBeInTheDocument();
  });

  it("offers no spread when nobody left can take one more", () => {
    const view = makeView();
    m.view = {
      ...view,
      participants: [
        { ...hidden, juz: [1, 3] },
        { ...shown, juz: [2], stopped: true },
        { ...shown, id: "p3", juz: [4], silenced: true },
        // Stopped reading on purpose: holds none, and the spread gives none back.
        { ...shown, id: "p4", juz: [] },
      ],
    };
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    // The count still shows: the organizer can add people or free a row.
    expect(screen.getByText("بقي ٢٨ جزءاً بلا قارئ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.rota.spread })).toBeNull();
  });

  it("has no count or spread once archived", () => {
    render(<PeoplePanel inviteCode="CODE" archived />);
    expect(screen.queryByText("بقي ٢٨ جزءاً بلا قارئ")).toBeNull();
    expect(screen.queryByRole("button", { name: t.rota.spread })).toBeNull();
  });

  it("shows each person's number under their name, unless it's hidden", () => {
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    expect(screen.getByRole("button", { name: /منى/ })).toHaveTextContent(
      "+971501234567",
    );
    expect(screen.getByRole("button", { name: /سعد/ })).not.toHaveTextContent(
      "+",
    );
  });

  it("an empty juz' also offers the saved people, and adds the one picked to that juz'", async () => {
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء ٥/ }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.readerTitle(5) });
    await user.click(
      within(sheet).getByRole("button", { name: t.rota.savedFrom }),
    );
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    await user.click(within(picker).getByRole("button", { name: /أم خالد/ }));
    expect(m.fns.addSaved).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactId: "c1",
      juz: 5,
    });
    // Added: the whole sheet is gone.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks when someone added late in the day starts, then adds them with the answer", async () => {
    m.fns.addParticipant = vi
      .fn()
      .mockResolvedValueOnce({ error: "ask_today" })
      .mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء ٥/ }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.readerTitle(5) });
    await user.type(within(sheet).getByLabelText(t.rota.personName), "ليلى");
    await user.type(
      within(sheet).getByLabelText(t.rota.personPhone),
      "+971507654321",
    );
    await user.click(within(sheet).getByRole("button", { name: t.rota.add }));

    const question = await within(sheet).findByRole("group", {
      name: t.rota.todayQuestion,
    });
    await user.click(
      within(question).getByRole("button", { name: t.rota.readsNextDay }),
    );

    expect(m.fns.addParticipant).toHaveBeenLastCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      name: "ليلى",
      phone: "+971507654321",
      juz: 5,
      readsToday: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("asks the same for a saved person, and adds them with the answer", async () => {
    m.fns.addSaved = vi
      .fn()
      .mockResolvedValueOnce({ error: "ask_today" })
      .mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء ٥/ }),
    );
    await user.click(screen.getByRole("button", { name: t.rota.savedFrom }));
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    await user.click(within(picker).getByRole("button", { name: /أم خالد/ }));
    const question = await within(picker).findByRole("group", {
      name: t.rota.todayQuestion,
    });
    await user.click(
      within(question).getByRole("button", { name: t.rota.readsToday }),
    );

    expect(m.fns.addSaved).toHaveBeenLastCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactId: "c1",
      juz: 5,
      readsToday: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("going back from the question adds nobody", async () => {
    m.fns.addParticipant = vi.fn().mockResolvedValue({ error: "ask_today" });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء ٥/ }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.readerTitle(5) });
    await user.click(within(sheet).getByRole("button", { name: t.rota.add }));
    const question = await within(sheet).findByRole("group", {
      name: t.rota.todayQuestion,
    });
    await user.click(
      within(question).getByRole("button", { name: t.rota.cancel }),
    );

    expect(m.fns.addParticipant).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group")).toBeNull();
    expect(
      within(sheet).getByRole("button", { name: t.rota.add }),
    ).toBeInTheDocument();
  });

  it("renames a person from their sheet", async () => {
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(screen.getByRole("button", { name: /سعد/ }));
    await user.click(screen.getByRole("button", { name: t.rota.rename }));
    const sheet = screen.getByRole("dialog", { name: t.rota.renameTitle });
    const field = within(sheet).getByLabelText(t.rota.personName);
    expect(field).toHaveValue("سعد");
    await user.clear(field);
    await user.type(field, "أبو سعد");
    await user.click(
      within(sheet).getByRole("button", { name: t.rota.renameSave }),
    );
    expect(m.fns.renameParticipant).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      participantId: "p1",
      name: "أبو سعد",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("going back from renaming changes nothing", async () => {
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(screen.getByRole("button", { name: /سعد/ }));
    await user.click(screen.getByRole("button", { name: t.rota.rename }));
    await user.click(screen.getByRole("button", { name: t.rota.cancel }));
    expect(m.fns.renameParticipant).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.rota.rename })).toBeVisible();
  });

  it("offers nothing from before when no one is saved", async () => {
    const user = userEvent.setup();
    m.saved = [];
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء ٥/ }),
    );
    expect(screen.queryByRole("button", { name: t.rota.savedFrom })).toBeNull();
  });

  it("a person whose number is hidden has no resend link; one with a number does", () => {
    render(<PeoplePanel inviteCode="CODE" archived={false} />);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
    expect(
      within(rows[0] as HTMLElement).getByText(t.rota.notJoinedShort),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole("link", {
        name: t.rota.notJoined,
      }),
    ).toBeInTheDocument();
  });

  it("nobody can remove the organizer, whoever is looking; anyone else can be removed", async () => {
    const user = userEvent.setup();
    const view = makeView();
    // An admin's view: the organizer's row isn't "me".
    view.rows[0] = {
      juz: 1,
      participant: { ...hidden, isOrganizer: true, slots: 1 },
    };
    view.participants[0] = { ...hidden, isOrganizer: true, juz: [1] };
    m.view = view;
    render(<PeoplePanel inviteCode="CODE" archived={false} />);

    await user.click(screen.getByRole("button", { name: /سعد/ }));
    const organizer = screen.getByRole("dialog", { name: "سعد" });
    expect(
      within(organizer).queryByRole("button", { name: t.rota.remove }),
    ).toBeNull();
    await user.click(
      within(organizer).getByRole("button", { name: t.sheet.close }),
    );

    await user.click(screen.getByRole("button", { name: /منى/ }));
    const other = screen.getByRole("dialog", { name: "منى" });
    expect(
      within(other).getByRole("button", { name: t.rota.remove }),
    ).toBeInTheDocument();
  });

  describe("co-organizers", () => {
    /** Saad owns the khatma, Muna helps run it, and Huda only reads. */
    function runView() {
      const view = makeView();
      const owner = { ...hidden, isOrganizer: true };
      const co = { ...shown, isCoOrganizer: true };
      const huda = { ...shown, id: "p3", name: "هدى" };
      view.rows[0] = { juz: 1, participant: { ...owner, slots: 1 } };
      view.rows[1] = { juz: 2, participant: { ...co, slots: 1 } };
      view.rows[2] = { juz: 3, participant: { ...huda, slots: 1 } };
      view.participants = [
        { ...owner, juz: [1] },
        { ...co, juz: [2] },
        { ...huda, juz: [3] },
      ];
      view.freeJuz = view.freeJuz.filter((j) => j !== 3);
      return view;
    }

    it("labels a co-organizer «منظّم مساعد» in the list", () => {
      m.view = runView();
      render(<PeoplePanel inviteCode="CODE" archived={false} />);
      expect(screen.getByRole("button", { name: /منى/ })).toHaveTextContent(
        "منظّم مساعد",
      );
      expect(screen.getByRole("button", { name: /هدى/ })).not.toHaveTextContent(
        "منظّم مساعد",
      );
      expect(screen.getByRole("button", { name: /سعد/ })).not.toHaveTextContent(
        "منظّم مساعد",
      );
    });

    it("a co-organizer with People sees no remove on the owner or another co-organizer", async () => {
      m.view = runView();
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      for (const name of ["سعد", "منى"]) {
        await user.click(
          screen.getByRole("button", { name: new RegExp(name) }),
        );
        const sheet = screen.getByRole("dialog", { name });
        expect(
          within(sheet).queryByRole("button", { name: t.rota.remove }),
        ).toBeNull();
        await user.click(
          within(sheet).getByRole("button", { name: t.sheet.close }),
        );
      }
      await user.click(screen.getByRole("button", { name: /هدى/ }));
      expect(
        within(screen.getByRole("dialog", { name: "هدى" })).getByRole(
          "button",
          { name: t.rota.remove },
        ),
      ).toBeInTheDocument();
    });

    it("the owner can remove a co-organizer", async () => {
      m.view = runView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} />);
      await user.click(screen.getByRole("button", { name: /منى/ }));
      expect(
        within(screen.getByRole("dialog", { name: "منى" })).getByRole(
          "button",
          { name: t.rota.remove },
        ),
      ).toBeInTheDocument();
    });

    it("a co-organizer is not offered to stop reading their own ajza'", async () => {
      const view = runView();
      view.rows[1] = {
        juz: 2,
        participant: { ...shown, isCoOrganizer: true, isMe: true, slots: 1 },
      };
      view.participants[1] = {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        juz: [2],
      };
      m.view = view;
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: new RegExp(t.rota.me) }),
      );
      const sheet = screen.getByRole("dialog", { name: t.rota.me });
      expect(
        within(sheet).queryByRole("button", {
          name: new RegExp(t.rota.stopReading),
        }),
      ).toBeNull();
      expect(
        within(sheet).queryByRole("button", { name: t.rota.remove }),
      ).toBeNull();
    });

    it("says why a change to someone who runs the khatma was refused", async () => {
      m.view = runView();
      m.fns.moveJuz = vi.fn().mockResolvedValue({ error: "is_organizer" });
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      await user.click(screen.getByRole("button", { name: /منى/ }));
      await user.click(screen.getByRole("button", { name: t.rota.move }));
      expect(
        await screen.findByText(t.rota.peopleErrors.is_organizer!),
      ).toBeInTheDocument();
    });
  });
});

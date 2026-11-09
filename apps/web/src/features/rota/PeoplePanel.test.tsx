import type { Id } from "@convex/_generated/dataModel";
import { toWesternDigits } from "@convex/lib/digits";
import type { PeopleView } from "@convex/lib/rotaOps";
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

type Row = PeopleView["rows"][number];
type Reader = NonNullable<Row["participant"]>;
const pid = (id: string) => id as Id<"rotaParticipants">;

const state = {
  joined: false,
  stopped: false,
  silenced: false,
  isOrganizer: false,
  isCoOrganizer: false,
  hasAccount: false,
};
const hidden = {
  id: pid("p1"),
  name: "سعد",
  isMe: false,
  phone: null as string | null,
  ...state,
};
const shown = {
  id: pid("p2"),
  name: "منى",
  isMe: false,
  phone: "+971501234567" as string | null,
  ...state,
};

/** A participant's ajza', each counting toward the cap, none of them shared. */
const held = (juz: number[]) => ({
  juz,
  heldSlots: juz.length,
  shared: [] as number[],
});

/** One of the 30 rows: its first reader, and a second one when it is shared. */
function slot(
  juz: number,
  participant: Reader | null,
  partner: Reader | null = null,
): Row {
  return { juz, participant, partner };
}

function makeView(): PeopleView {
  return {
    title: "ختمة العائلة",
    archived: false,
    daysKind: "daily",
    joinLink: "https://wa.me/971500000000?text=JOIN",
    requests: [],
    target: { number: 2, date: "2026-10-31", isFirst: false },
    rows: Array.from({ length: 30 }, (_, i) =>
      slot(
        i + 1,
        i === 0
          ? { ...hidden, slots: 1 }
          : i === 1
            ? { ...shown, slots: 1 }
            : null,
      ),
    ),
    participants: [
      { ...hidden, ...held([1]) },
      { ...shown, ...held([2]) },
    ],
    freeJuz: Array.from({ length: 28 }, (_, i) => i + 3),
    phoneExample: null,
    maxSlots: 2,
    leftoverBox: true,
    sharing: { on: true, open: false, readers: 2, shared: 0 },
  };
}

beforeEach(() => {
  m.fns = {};
  m.view = makeView();
  m.saved = [
    {
      id: "c1",
      name: "أم خالد",
      phone: "+971509998877",
      inKhatma: false,
      active: false,
    },
  ];
});

describe("PeoplePanel", () => {
  it("shows no leftover box when an admin turned it off, and the open rows still invite an add", () => {
    m.view = { ...makeView(), leftoverBox: false };
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    expect(screen.queryByText("بقي 28 جزءاً بلا قارئ")).toBeNull();
    expect(screen.queryByRole("button", { name: t.rota.spread })).toBeNull();
    expect(screen.getByText(t.rota.addReader(3))).toBeInTheDocument();
  });

  it("says how many ajza' have no reader above the 30 rows, and spreads them in one press", async () => {
    m.fns.spreadFreeJuz = vi
      .fn()
      .mockResolvedValue({ ok: true, given: 2, left: 26 });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    const count = screen.getByText("بقي 28 جزءاً بلا قارئ");
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
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
        { ...hidden, ...held([1, 3]) },
        { ...shown, ...held([2]), stopped: true },
        { ...shown, id: pid("p3"), ...held([4]), silenced: true },
        // Stopped reading on purpose: holds none, and the spread gives none back.
        { ...shown, id: pid("p4"), ...held([]) },
      ],
    };
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    // The count still shows: the organizer can add people or free a row.
    expect(screen.getByText("بقي 28 جزءاً بلا قارئ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t.rota.spread })).toBeNull();
  });

  it("has no count or spread once archived", () => {
    render(<PeoplePanel inviteCode="CODE" archived viewerIsOwner />);
    expect(screen.queryByText("بقي 28 جزءاً بلا قارئ")).toBeNull();
    expect(screen.queryByRole("button", { name: t.rota.spread })).toBeNull();
  });

  it("shows each person's number under their name, unless it's hidden", () => {
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    expect(screen.getByRole("button", { name: /منى/ })).toHaveTextContent(
      "+971501234567",
    );
    expect(screen.getByRole("button", { name: /سعد/ })).not.toHaveTextContent(
      "+",
    );
  });

  it("offers one more juz' by the count the server checks, not by how many ajza' are listed", async () => {
    const view = makeView();
    // Saad reads juz' 1 alone and shares juz' 3, which doesn't count toward the cap.
    view.rows[2] = slot(3, { ...shown, slots: 1 }, { ...hidden, slots: 1 });
    view.participants[0] = {
      ...hidden,
      juz: [1, 3],
      heldSlots: 1,
      shared: [3],
    };
    view.freeJuz = view.freeJuz.filter((j) => j !== 3);
    m.view = view;
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(screen.getAllByRole("button", { name: /سعد/ })[0]!);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText(t.rota.giveMore)).toBeInTheDocument();
  });

  it("offers no more once the server's count reaches the cap", async () => {
    const view = makeView();
    view.participants[0] = { ...hidden, juz: [1], heldSlots: 2, shared: [] };
    m.view = view;
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(screen.getByRole("button", { name: /سعد/ }));
    expect(
      within(screen.getByRole("dialog")).queryByText(t.rota.giveMore),
    ).toBeNull();
  });

  it("an empty juz' also offers the saved people, and adds the one picked to that juz'", async () => {
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء 5/ }),
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء 5/ }),
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء 5/ }),
    );
    await user.click(
      within(
        screen.getByRole("dialog", { name: t.rota.readerTitle(5) }),
      ).getByRole("button", { name: t.rota.savedFrom }),
    );
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء 5/ }),
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
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
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(screen.getByRole("button", { name: /سعد/ }));
    await user.click(screen.getByRole("button", { name: t.rota.rename }));
    await user.click(screen.getByRole("button", { name: t.rota.cancel }));
    expect(m.fns.renameParticipant).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.rota.rename })).toBeVisible();
  });

  it("the leftover banner adds several saved people and says what it did", async () => {
    m.fns.addSavedMany = vi.fn().mockResolvedValue({
      ok: true,
      added: 1,
      alreadyIn: 0,
      noRoom: 0,
      notFound: 0,
    });
    const user = userEvent.setup();
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    const banner = screen.getByText(/بلا قارئ/, { selector: "p" })
      .parentElement as HTMLElement;
    await user.click(
      within(banner).getByRole("button", { name: t.rota.savedFrom }),
    );
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    await user.click(within(picker).getByRole("checkbox", { name: /أم خالد/ }));
    await user.click(
      within(picker).getByRole("button", { name: t.rota.savedAddMany(1) }),
    );
    expect(m.fns.addSavedMany).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactIds: ["c1"],
    });
    expect(
      await screen.findByText(
        t.rota.savedManyResult({ added: 1, noRoom: 0, skipped: 0 }),
      ),
    ).toBeInTheDocument();
  });

  it("the leftover banner offers no saved list when everyone saved is in already", () => {
    m.saved = [
      { id: "c1", name: "أم خالد", phone: null, inKhatma: true, active: false },
    ];
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    expect(screen.queryByRole("button", { name: t.rota.savedFrom })).toBeNull();
  });

  it("offers nothing from before when no one is saved", async () => {
    const user = userEvent.setup();
    m.saved = [];
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
    await user.click(
      screen.getByRole("button", { name: /أضف قارئاً للجزء 5/ }),
    );
    expect(screen.queryByRole("button", { name: t.rota.savedFrom })).toBeNull();
  });

  it("a person whose number is hidden has no resend link; one with a number does", () => {
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
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
    view.rows[0] = slot(1, { ...hidden, isOrganizer: true, slots: 1 });
    view.participants[0] = { ...hidden, isOrganizer: true, ...held([1]) };
    m.view = view;
    render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);

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

  describe("freeing one juz'", () => {
    /** Muna reads juz' 2 and juz' 5. */
    function twoView() {
      const view = makeView();
      view.rows[4] = slot(5, { ...shown, slots: 2 });
      view.rows[1] = slot(2, { ...shown, slots: 2 });
      view.participants[1] = { ...shown, ...held([2, 5]) };
      view.freeJuz = view.freeJuz.filter((j) => j !== 5);
      return view;
    }
    const freeButton = (juz: number) => ({
      name: new RegExp(t.rota.freeThis(juz)),
    });
    /** A juz' row, not the row of another juz' that starts with the same digit. */
    const row = (juz: number) => new RegExp(`^${toWesternDigits(juz)}(?!\\d)`);

    it("frees the juz' that was pressed for someone who reads two, and keeps them", async () => {
      m.view = twoView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      // Juz' 5 is Muna's second row.
      await user.click(screen.getByRole("button", { name: row(5) }));
      await user.click(screen.getByRole("button", freeButton(5)));
      expect(m.fns.freeJuz).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        participantId: "p2",
        juz: 5,
      });
      expect(m.fns.removeParticipant).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("someone with one juz' is taken out instead, so there is nothing to free", async () => {
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /منى/ }));
      const sheet = screen.getByRole("dialog", { name: "منى" });
      expect(within(sheet).queryByRole("button", freeButton(2))).toBeNull();
    });

    it("an admin frees the organizer's ajza', one at a time", async () => {
      const view = makeView();
      // An admin's view: the organizer's row isn't "me".
      const organizer = { ...hidden, isOrganizer: true };
      view.rows[0] = slot(1, { ...organizer, slots: 2 });
      view.rows[2] = slot(3, { ...organizer, slots: 2 });
      view.participants[0] = { ...organizer, ...held([1, 3]) };
      view.freeJuz = view.freeJuz.filter((j) => j !== 3);
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: row(3) }));
      await user.click(screen.getByRole("button", freeButton(3)));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(screen.getByRole("button", { name: row(1) }));
      await user.click(screen.getByRole("button", freeButton(1)));
      expect(m.fns.freeJuz).toHaveBeenCalledTimes(2);
      expect(m.fns.freeJuz).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ participantId: "p1", juz: 3 }),
      );
      expect(m.fns.freeJuz).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ participantId: "p1", juz: 1 }),
      );
    });

    it("an admin frees the organizer's only juz' too, since the organizer can't be taken out", async () => {
      const view = makeView();
      view.rows[0] = slot(1, { ...hidden, isOrganizer: true, slots: 1 });
      view.participants[0] = { ...hidden, isOrganizer: true, ...held([1]) };
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      await user.click(screen.getByRole("button", freeButton(1)));
      expect(m.fns.freeJuz).toHaveBeenCalledWith(
        expect.objectContaining({ participantId: "p1", juz: 1 }),
      );
    });

    it("the owner frees one of their own two ajza', besides stopping altogether", async () => {
      const view = makeView();
      const me = { ...hidden, isOrganizer: true, isMe: true };
      view.rows[0] = slot(1, { ...me, slots: 2 });
      view.rows[2] = slot(3, { ...me, slots: 2 });
      view.participants[0] = { ...me, ...held([1, 3]) };
      view.freeJuz = view.freeJuz.filter((j) => j !== 3);
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: row(1) }));
      const sheet = screen.getByRole("dialog", { name: t.rota.me });
      expect(
        within(sheet).getByRole("button", {
          name: new RegExp(t.rota.stopReading),
        }),
      ).toBeInTheDocument();
      const free = within(sheet).getByRole("button", freeButton(1));
      // Said to the owner, not about them.
      expect(free).toHaveTextContent(t.rota.freeThisHintMe);
      await user.click(free);
      expect(m.fns.freeJuz).toHaveBeenCalledTimes(1);
      expect(m.fns.freeJuz).toHaveBeenCalledWith(
        expect.objectContaining({ participantId: "p1", juz: 1 }),
      );
    });

    it("says why a free was refused", async () => {
      m.view = twoView();
      m.fns.freeJuz = vi.fn().mockResolvedValue({ error: "is_organizer" });
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: row(5) }));
      await user.click(screen.getByRole("button", freeButton(5)));
      expect(
        await screen.findByText(t.rota.peopleErrors.is_organizer!),
      ).toBeInTheDocument();
    });
  });

  describe("a second reader on a juz'", () => {
    /** Every juz' has a reader: Saad 1, Muna 2, and 28 others. */
    function fullView(): PeopleView {
      const view = makeView();
      const others = Array.from({ length: 28 }, (_, i) => ({
        ...shown,
        id: pid(`q${i + 3}`),
        name: `قارئ ${i + 3}`,
        phone: null,
      }));
      view.rows = view.rows.map((row, i) => {
        const other = others[i - 2];
        return other ? slot(row.juz, { ...other, slots: 1 }) : row;
      });
      view.participants.push(
        ...others.map((p, i) => ({ ...p, ...held([i + 3]) })),
      );
      view.freeJuz = [];
      view.sharing = { on: true, open: true, readers: 30, shared: 0 };
      return view;
    }

    const layla = {
      ...shown,
      id: pid("p9"),
      name: "ليلى",
      phone: "+971507654321",
      joined: true,
    };

    /** Layla reads juz' 1 with Saad. */
    function sharedView(): PeopleView {
      const view = fullView();
      view.rows[0] = slot(1, { ...hidden, slots: 1 }, { ...layla, slots: 1 });
      view.participants.push({ ...layla, ...held([1]) });
      view.sharing = { on: true, open: true, readers: 31, shared: 1 };
      return view;
    }

    const shareButton = { name: t.rota.shareAction };

    it("no share action while a slot is empty", async () => {
      // Sharing is on, but juz' 3 to 30 have no reader.
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      const sheet = screen.getByRole("dialog", { name: "سعد" });
      expect(within(sheet).queryByRole("button", shareButton)).toBeNull();
    });

    it("no share action when sharing is off", async () => {
      m.view = {
        ...fullView(),
        sharing: { on: false, open: false, readers: 30, shared: 0 },
      };
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      const sheet = screen.getByRole("dialog", { name: "سعد" });
      expect(within(sheet).queryByRole("button", shareButton)).toBeNull();
    });

    it("adding a second reader spells out what follows", async () => {
      m.view = fullView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      await user.click(screen.getByRole("button", shareButton));
      const sheet = screen.getByRole("dialog", { name: t.rota.shareAction });
      await user.type(within(sheet).getByLabelText(t.rota.personName), "ليلى");
      await user.type(
        within(sheet).getByLabelText(t.rota.personPhone),
        "+971507654321",
      );
      const explain = within(sheet).getByText(
        t.rota.shareExplain("سعد", "ليلى", 1, 2),
      );
      const add = within(sheet).getByRole("button", { name: t.rota.add });
      expect(
        explain.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await user.click(add);
      expect(m.fns.addParticipant).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        name: "ليلى",
        phone: "+971507654321",
        juz: 1,
        share: true,
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("a saved person shares the juz' once the organizer confirms what follows", async () => {
      m.view = fullView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      await user.click(screen.getByRole("button", shareButton));
      await user.click(
        within(
          screen.getByRole("dialog", { name: t.rota.shareAction }),
        ).getByRole("button", { name: t.rota.savedFrom }),
      );
      const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
      await user.click(within(picker).getByRole("button", { name: /أم خالد/ }));
      expect(m.fns.addSaved).not.toHaveBeenCalled();
      expect(
        within(picker).getByText(t.rota.shareExplain("سعد", "أم خالد", 1, 2)),
      ).toBeInTheDocument();
      await user.click(
        within(picker).getByRole("button", { name: t.rota.add }),
      );
      expect(m.fns.addSaved).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        contactId: "c1",
        juz: 1,
        share: true,
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("a not_full refusal shows in Arabic", async () => {
      // A juz' lost its reader after the sheet opened.
      m.view = fullView();
      m.fns.addParticipant = vi.fn().mockResolvedValue({ error: "not_full" });
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      await user.click(screen.getByRole("button", shareButton));
      const sheet = screen.getByRole("dialog", { name: t.rota.shareAction });
      await user.type(within(sheet).getByLabelText(t.rota.personName), "ليلى");
      await user.type(
        within(sheet).getByLabelText(t.rota.personPhone),
        "+971507654321",
      );
      await user.click(within(sheet).getByRole("button", { name: t.rota.add }));
      expect(
        await within(sheet).findByText(t.rota.errors.not_full!),
      ).toBeInTheDocument();
    });

    it("a shared row shows both names", () => {
      m.view = sharedView();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      const first = screen.getAllByRole("listitem")[0] as HTMLElement;
      expect(within(first).getByRole("button", { name: /سعد/ })).toBeVisible();
      expect(within(first).getByRole("button", { name: /ليلى/ })).toBeVisible();
      // Each with whether they joined: Saad hasn't, Layla has.
      expect(within(first).getByText(t.rota.notJoinedShort)).toBeVisible();
      expect(within(first).getByText(t.rota.joined)).toBeVisible();
      // Above the list: how many read now.
      expect(
        screen
          .getByText(t.rota.sharedCount(31, 1))
          .compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("removing a reader who also reads a juz' alone says that juz' is left empty", async () => {
      const view = sharedView();
      view.rows[2] = slot(3, { ...layla, slots: 2 });
      view.participants[view.participants.length - 1] = {
        ...layla,
        ...held([1, 3]),
      };
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getAllByRole("button", { name: /ليلى/ })[0]!);
      await user.click(screen.getByRole("button", { name: t.rota.remove }));
      const confirm = screen.getByRole("dialog", {
        name: t.rota.removeTitle("ليلى"),
      });
      expect(
        within(confirm).getByText(t.rota.leavesAlone("سعد")),
      ).toBeVisible();
      expect(within(confirm).getByText(t.rota.removeBody)).toBeVisible();
    });

    it("offers the saved list once every juz' has a reader and sharing is open", () => {
      m.view = fullView();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      expect(
        screen.getByRole("button", { name: t.rota.savedFrom }),
      ).toBeInTheDocument();
    });

    it("offers no saved list once every juz' has a reader but sharing is closed", () => {
      m.view = {
        ...fullView(),
        sharing: { on: true, open: false, readers: 30, shared: 0 },
      };
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      expect(
        screen.queryByRole("button", { name: t.rota.savedFrom }),
      ).toBeNull();
    });

    it("no count of readers while nothing is shared", () => {
      m.view = fullView();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      expect(screen.queryByText(/مشترك/)).toBeNull();
    });

    it("a shared row's sheet offers no share", async () => {
      m.view = sharedView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /سعد/ }));
      const sheet = screen.getByRole("dialog", { name: "سعد" });
      expect(within(sheet).queryByRole("button", shareButton)).toBeNull();
    });

    it("removing one reader warns the other reads it alone", async () => {
      m.view = sharedView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /ليلى/ }));
      await user.click(screen.getByRole("button", { name: t.rota.remove }));
      const confirm = screen.getByRole("dialog", {
        name: t.rota.removeTitle("ليلى"),
      });
      expect(
        within(confirm).getByText(t.rota.leavesAlone("سعد")),
      ).toBeInTheDocument();
      // Her reading today stays; she reads no juz' alone, so none is left empty.
      expect(
        within(confirm).getByText(t.rota.removeBodyShared),
      ).toBeInTheDocument();
      expect(within(confirm).queryByText(t.rota.removeBody)).toBeNull();
      await user.click(
        within(confirm).getByRole("button", { name: t.rota.removeConfirm }),
      );
      expect(m.fns.removeParticipant).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        participantId: "p9",
      });
    });

    it("freeing one reader of a shared juz' says the other reads it alone", async () => {
      const view = sharedView();
      // Saad reads juz' 3 too, so his juz' 1 can be freed.
      view.rows[2] = slot(3, { ...hidden, slots: 2 });
      view.participants[0] = { ...hidden, ...held([1, 3]) };
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getAllByRole("button", { name: /سعد/ })[0]!);
      const free = screen.getByRole("button", {
        name: new RegExp(t.rota.freeThis(1)),
      });
      expect(free).toHaveTextContent(t.rota.leavesAlone("ليلى"));
      expect(free).toHaveTextContent(t.rota.freeThisStaysShared);
    });

    it("a reader of a shared juz' moves only to an empty one, and is told the other stays", async () => {
      const view = sharedView();
      // Juz' 30 lost its reader since: sharing stays, and closes to new shares.
      view.rows[29] = slot(30, null);
      view.freeJuz = [30];
      view.sharing = { on: true, open: false, readers: 30, shared: 1 };
      m.view = view;
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /ليلى/ }));
      const sheet = screen.getByRole("dialog", { name: "ليلى" });
      const targets = within(within(sheet).getByRole("combobox"))
        .getAllByRole("option")
        .map((o) => Number((o as HTMLOptionElement).value));
      expect(targets).toEqual([30]);
      expect(within(sheet).getByText(t.rota.leavesAlone("سعد"))).toBeVisible();
      await user.click(
        within(sheet).getByRole("button", { name: t.rota.move }),
      );
      expect(m.fns.moveJuz).toHaveBeenCalledWith({
        sessionToken: "tok",
        inviteCode: "CODE",
        participantId: "p9",
        fromJuz: 1,
        toJuz: 30,
      });
    });

    it("a whole juz' can't swap into a shared one, and a refused swap says why", async () => {
      m.view = sharedView();
      m.fns.moveJuz = vi.fn().mockResolvedValue({ error: "shared" });
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /منى/ }));
      const sheet = screen.getByRole("dialog", { name: "منى" });
      const targets = within(within(sheet).getByRole("combobox"))
        .getAllByRole("option")
        .map((o) => Number((o as HTMLOptionElement).value));
      expect(targets).not.toContain(1);
      await user.click(
        within(sheet).getByRole("button", { name: t.rota.move }),
      );
      expect(
        await within(sheet).findByText(t.rota.peopleErrors.shared!),
      ).toBeInTheDocument();
    });

    /** Saad owns the khatma and Muna, who is looking, helps run it. */
    function coRunView(): PeopleView {
      const view = fullView();
      view.rows[0] = slot(1, { ...hidden, isOrganizer: true, slots: 1 });
      view.rows[1] = slot(2, {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        slots: 1,
      });
      view.participants[0] = { ...hidden, isOrganizer: true, ...held([1]) };
      view.participants[1] = {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        ...held([2]),
      };
      return view;
    }

    it("a co-organizer can't add a second reader to a juz' of someone running the khatma", async () => {
      m.view = coRunView();
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      for (const name of ["سعد", t.rota.me]) {
        await user.click(
          screen.getByRole("button", { name: new RegExp(name) }),
        );
        const sheet = screen.getByRole("dialog", { name });
        expect(within(sheet).queryByRole("button", shareButton)).toBeNull();
        await user.click(
          within(sheet).getByRole("button", { name: t.sheet.close }),
        );
      }
      // Anyone else's juz' they may share.
      await user.click(screen.getByRole("button", { name: /قارئ 3(?!\d)/ }));
      expect(
        within(screen.getByRole("dialog", { name: "قارئ 3" })).getByRole(
          "button",
          shareButton,
        ),
      ).toBeInTheDocument();
    });

    it("the owner can add a second reader to a co-organizer's juz'", async () => {
      m.view = coRunView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /منظّم مساعد/ }));
      expect(
        within(screen.getByRole("dialog")).getByRole("button", shareButton),
      ).toBeInTheDocument();
    });

    it("says why a share onto someone running the khatma was refused", async () => {
      // Huda was named a co-organizer since this screen loaded.
      m.view = fullView();
      m.fns.addParticipant = vi
        .fn()
        .mockResolvedValue({ error: "is_organizer" });
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      await user.click(screen.getByRole("button", { name: /قارئ 3(?!\d)/ }));
      await user.click(screen.getByRole("button", shareButton));
      const sheet = screen.getByRole("dialog", { name: t.rota.shareAction });
      await user.type(within(sheet).getByLabelText(t.rota.personName), "ليلى");
      await user.type(
        within(sheet).getByLabelText(t.rota.personPhone),
        "+971507654321",
      );
      await user.click(within(sheet).getByRole("button", { name: t.rota.add }));
      expect(
        await within(sheet).findByText(t.rota.errors.is_organizer!),
      ).toBeInTheDocument();
    });
  });

  describe("co-organizers", () => {
    /** Saad owns the khatma, Muna helps run it, and Huda only reads. */
    function runView() {
      const view = makeView();
      const owner = { ...hidden, isOrganizer: true };
      const co = { ...shown, isCoOrganizer: true };
      const huda = { ...shown, id: pid("p3"), name: "هدى" };
      view.rows[0] = slot(1, { ...owner, slots: 1 });
      view.rows[1] = slot(2, { ...co, slots: 1 });
      view.rows[2] = slot(3, { ...huda, slots: 1 });
      view.participants = [
        { ...owner, ...held([1]) },
        { ...co, ...held([2]) },
        { ...huda, ...held([3]) },
      ];
      view.freeJuz = view.freeJuz.filter((j) => j !== 3);
      return view;
    }

    it("labels a co-organizer «منظّم مساعد» in the list", () => {
      m.view = runView();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
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
        expect(
          within(sheet).queryByRole("button", {
            name: new RegExp(t.rota.freeThis(name === "سعد" ? 1 : 2)),
          }),
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

    it("the owner can remove a co-organizer, or free their only juz' and keep them", async () => {
      m.view = runView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /منى/ }));
      const sheet = screen.getByRole("dialog", { name: "منى" });
      expect(
        within(sheet).getByRole("button", { name: t.rota.remove }),
      ).toBeInTheDocument();
      expect(
        within(sheet).getByRole("button", {
          name: new RegExp(t.rota.freeThis(2)),
        }),
      ).toBeInTheDocument();
    });

    it("a co-organizer is not offered to stop reading their own ajza'", async () => {
      const view = runView();
      view.rows[1] = slot(2, {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        slots: 1,
      });
      view.participants[1] = {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        ...held([2]),
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
      // Huda was named a co-organizer since this screen loaded.
      m.view = runView();
      m.fns.removeParticipant = vi
        .fn()
        .mockResolvedValue({ error: "is_organizer" });
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      await user.click(screen.getByRole("button", { name: /هدى/ }));
      await user.click(screen.getByRole("button", { name: t.rota.remove }));
      await user.click(
        screen.getByRole("button", { name: t.rota.removeConfirm }),
      );
      expect(
        await screen.findByText(t.rota.peopleErrors.is_organizer!),
      ).toBeInTheDocument();
    });

    it("a co-organizer can't move the owner's, another co-organizer's or their own juz', nor swap into them", async () => {
      const view = runView();
      // Muna, the co-organizer, is the one looking.
      view.rows[1] = slot(2, {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        slots: 1,
      });
      view.participants[1] = {
        ...shown,
        isCoOrganizer: true,
        isMe: true,
        ...held([2]),
      };
      const other = {
        ...shown,
        id: pid("p4"),
        name: "ريم",
        isCoOrganizer: true,
      };
      view.rows[3] = slot(4, { ...other, slots: 1 });
      view.participants.push({ ...other, ...held([4]) });
      view.freeJuz = view.freeJuz.filter((j) => j !== 4);
      m.view = view;
      const user = userEvent.setup();
      render(
        <PeoplePanel
          inviteCode="CODE"
          archived={false}
          viewerIsOwner={false}
        />,
      );
      for (const name of ["سعد", t.rota.me, "ريم"]) {
        await user.click(
          screen.getByRole("button", { name: new RegExp(name) }),
        );
        const sheet = screen.getByRole("dialog", { name });
        expect(
          within(sheet).queryByRole("button", { name: t.rota.move }),
        ).toBeNull();
        expect(within(sheet).queryByRole("combobox")).toBeNull();
        await user.click(
          within(sheet).getByRole("button", { name: t.sheet.close }),
        );
      }
      // A plain reader's juz' moves, but never into a juz' someone who runs the khatma holds.
      await user.click(screen.getByRole("button", { name: /هدى/ }));
      const sheet = screen.getByRole("dialog", { name: "هدى" });
      expect(
        within(sheet).getByRole("button", { name: t.rota.move }),
      ).toBeInTheDocument();
      const targets = within(within(sheet).getByRole("combobox"))
        .getAllByRole("option")
        .map((o) => Number((o as HTMLOptionElement).value));
      expect(targets).not.toContain(1);
      expect(targets).not.toContain(2);
      expect(targets).not.toContain(4);
      expect(targets).toContain(5);
    });

    it("the owner can move anyone's juz', into anyone's", async () => {
      m.view = runView();
      const user = userEvent.setup();
      render(<PeoplePanel inviteCode="CODE" archived={false} viewerIsOwner />);
      await user.click(screen.getByRole("button", { name: /منى/ }));
      const sheet = screen.getByRole("dialog", { name: "منى" });
      const targets = within(within(sheet).getByRole("combobox"))
        .getAllByRole("option")
        .map((o) => Number((o as HTMLOptionElement).value));
      expect(targets).toContain(1);
      expect(targets).toContain(3);
    });
  });
});

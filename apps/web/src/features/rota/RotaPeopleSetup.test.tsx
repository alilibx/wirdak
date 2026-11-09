import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { coOrganizerAccess, OWNER_ACCESS } from "../../test/fixtures";
import { RotaPeopleSetup } from "./RotaPeopleSetup";

const m = vi.hoisted(() => ({
  view: undefined as unknown,
  khatma: undefined as unknown,
  saved: undefined as unknown,
  importable: undefined as unknown,
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "rota:saved") return m.saved;
      if (name === "rota:importable") return m.importable;
      if (name === "khatmas:view") return m.khatma;
      return m.view;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] ?? "";
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
  };
});

const state = { joined: false, stopped: false, silenced: false };

function makeView() {
  return {
    title: "ختمة العائلة",
    daysKind: "daily",
    joinLink: "https://wa.me/971500000000?text=JOIN",
    requests: [],
    target: { number: 1, date: "2026-10-31", isFirst: true },
    rows: [],
    participants: [
      {
        id: "p1",
        name: "سعد",
        isMe: false,
        phone: null,
        juz: [1],
        heldSlots: 1,
        shared: [] as number[],
        ...state,
      },
    ],
    freeJuz: [2, 3],
    unsharedJuz: [] as number[],
    phoneExample: null,
    maxSlots: 2,
  };
}

const pool = {
  inviteCode: "POOL1",
  title: "ختمة الجيران",
  memberCount: 27,
};

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={["/j/CODE/setup"]}>
      <Routes>
        <Route path="/j/:inviteCode/setup" element={<RotaPeopleSetup />} />
        <Route path="/j/:inviteCode" element={<p>khatma page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.fns = {};
  m.view = makeView();
  m.khatma = { rota: true, organizerAccess: OWNER_ACCESS };
  m.saved = [
    { id: "c1", name: "أم خالد", phone: "+971509998877", inKhatma: false },
  ];
  m.importable = [pool];
});

describe("RotaPeopleSetup: an archived khatma", () => {
  it("goes to the khatma's page, and draws no join link on the way", () => {
    m.view = { ...makeView(), archived: true, joinLink: null };
    renderSetup();
    expect(screen.getByText("khatma page")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: t.rota.setupTitle }),
    ).toBeNull();
    expect(m.fns.ensureJoinLink ?? vi.fn()).not.toHaveBeenCalled();
  });
});

describe("RotaPeopleSetup: «تمّ»", () => {
  it("starts the khatma for the owner, then goes to its page", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.done }));
    expect(m.fns.finishSetup).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(await screen.findByText("khatma page")).toBeInTheDocument();
  });

  it("only takes a co-organizer without Settings back to the khatma's page", async () => {
    m.khatma = {
      rota: true,
      organizerAccess: coOrganizerAccess({ people: true }),
    };
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.done }));
    expect(await screen.findByText("khatma page")).toBeInTheDocument();
    expect(m.fns.finishSetup ?? vi.fn()).not.toHaveBeenCalled();
  });
});

describe("RotaPeopleSetup: bringing people in", () => {
  it("shows a number under the name, and none for a hidden one", () => {
    const view = makeView();
    const [hidden] = view.participants;
    m.view = {
      ...view,
      participants: [
        hidden,
        { ...hidden, id: "p2", name: "منى", phone: "+971501234567" },
      ],
    };
    renderSetup();
    const list = screen.getByRole("list", { name: t.rota.peopleList });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).not.toHaveTextContent("+");
    expect(rows[1]).toHaveTextContent("+971501234567");
  });

  it("renames someone from the list", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(
      screen.getByRole("button", { name: t.rota.renameOf("سعد") }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.renameTitle });
    const field = within(sheet).getByLabelText(t.rota.personName);
    await user.clear(field);
    await user.type(field, "أبو سعد");
    await user.click(
      within(sheet).getByRole("button", { name: t.rota.renameSave }),
    );
    expect(m.fns.renameParticipant).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: expect.any(String),
      participantId: "p1",
      name: "أبو سعد",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers a pool khatma's members, by names only, and says how many", () => {
    renderSetup();
    const button = screen.getByRole("button", {
      name: new RegExp(t.rota.importTitle("ختمة الجيران")),
    });
    expect(button).toHaveTextContent("27 عضواً، بالأسماء فقط");
    expect(screen.getByText(t.rota.importHint)).toBeInTheDocument();
  });

  it("brings them in on a press and says how many were added and how many left out", async () => {
    const user = userEvent.setup();
    m.fns.importMembers = vi
      .fn()
      .mockResolvedValue({ ok: true, added: 25, skipped: 2 });
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(t.rota.importTitle("ختمة الجيران")),
      }),
    );
    expect(m.fns.importMembers).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      sourceInviteCode: "POOL1",
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(t.rota.importResult(25, 2));
    expect(status).toHaveTextContent("25 شخصاً");
    expect(status).toHaveTextContent("شخصين");
  });

  it("says how many of those brought in share a juz'", async () => {
    const user = userEvent.setup();
    m.fns.importMembers = vi
      .fn()
      .mockResolvedValue({ ok: true, added: 45, skipped: 0, shared: 15 });
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(t.rota.importTitle("ختمة الجيران")),
      }),
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(t.rota.importResult(45, 0, 15));
    expect(status).toHaveTextContent("أضفنا 45 شخصاً.");
    expect(status).toHaveTextContent("يشترك 15 شخصاً منهم في جزء");
    // None shared, nothing said about it.
    expect(t.rota.importResult(3, 0, 0)).toBe(t.rota.importResult(3, 0));
    expect(t.rota.importResult(3, 0)).not.toContain("يشترك");
  });

  it("marks a juz' two people share in the list", () => {
    const view = makeView();
    const [first] = view.participants;
    m.view = {
      ...view,
      participants: [
        { ...first, juz: [1, 4], heldSlots: 2, shared: [4] },
        { ...first, id: "p2", name: "منى", juz: [4], shared: [4] },
        { ...first, id: "p3", name: "هدى", juz: [5], shared: [] },
      ],
    };
    renderSetup();
    const list = screen.getByRole("list", { name: t.rota.peopleList });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("الأجزاء 1 و4 (مشترك)");
    expect(rows[1]).toHaveTextContent("الجزء 4 (مشترك)");
    expect(rows[2]).toHaveTextContent("الجزء 5");
    expect(rows[2]).not.toHaveTextContent("مشترك");
  });

  it("offers a leftover juz' to whoever the server would still give one to", async () => {
    const user = userEvent.setup();
    const view = makeView();
    const [first] = view.participants;
    m.view = {
      ...view,
      maxSlots: 2,
      participants: [
        // Two ajza', but the shared one doesn't count toward the cap.
        { ...first, juz: [1, 4], heldSlots: 1, shared: [4] },
        { ...first, id: "p2", name: "منى", juz: [5, 6], heldSlots: 2 },
      ],
    };
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: (name) => name.startsWith(t.rota.leftover([2, 3])),
      }),
    );
    const sheet = screen.getByRole("dialog", { name: t.rota.giveTitle(2) });
    expect(within(sheet).getByRole("button", { name: /سعد/ })).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: /منى/ })).toBeDisabled();
  });

  it("keeps the result when the import leaves nothing to bring, and drops it once another add starts", async () => {
    const user = userEvent.setup();
    m.saved = [];
    m.fns.importMembers = vi.fn().mockImplementation(async () => {
      // Everyone is in now, so the pool is no longer offered.
      m.importable = [];
      return { ok: true, added: 3, skipped: 0 };
    });
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(t.rota.importTitle("ختمة الجيران")),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.rota.importResult(3, 0),
    );
    expect(screen.queryByText(t.rota.importHint)).toBeNull();

    await user.click(screen.getByRole("button", { name: t.rota.add }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("drops the result when a saved person is added", async () => {
    const user = userEvent.setup();
    m.fns.importMembers = vi
      .fn()
      .mockResolvedValue({ ok: true, added: 1, skipped: 0 });
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(t.rota.importTitle("ختمة الجيران")),
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.rota.importResult(1, 0),
    );

    await user.click(screen.getByRole("button", { name: t.rota.savedFrom }));
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    await user.click(within(picker).getByRole("checkbox", { name: /أم خالد/ }));
    await user.click(
      within(picker).getByRole("button", { name: t.rota.savedAddMany(1) }),
    );
    expect(m.fns.addSavedMany).toHaveBeenCalled();
    // The import's line is gone; the add's own line takes its place.
    expect(screen.getAllByRole("status").at(-1)).not.toHaveTextContent(
      t.rota.importResult(1, 0),
    );
  });

  it("a refusal is said plainly", async () => {
    const user = userEvent.setup();
    m.fns.importMembers = vi.fn().mockResolvedValue({ error: "not_found" });
    renderSetup();
    await user.click(
      screen.getByRole("button", {
        name: new RegExp(t.rota.importTitle("ختمة الجيران")),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.importErrors.not_found ?? "",
    );
  });

  it("shows no import when there is no pool khatma to bring from", () => {
    m.importable = [];
    renderSetup();
    expect(screen.queryByText(t.rota.importHint)).toBeNull();
    expect(screen.queryByRole("button", { name: /^أضف أعضاء/ })).toBeNull();
  });

  it("opens the saved people as a checklist and adds the ticked ones in one call", async () => {
    const user = userEvent.setup();
    m.fns.addSavedMany = vi.fn().mockResolvedValue({
      ok: true,
      added: 1,
      alreadyIn: 0,
      noRoom: 0,
      notFound: 0,
    });
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.savedFrom }));
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    // Two free ajza' in the view.
    expect(within(picker).getByText(t.rota.savedRoom(2))).toBeInTheDocument();
    await user.click(within(picker).getByRole("checkbox", { name: /أم خالد/ }));
    await user.click(
      within(picker).getByRole("button", { name: t.rota.savedAddMany(1) }),
    );
    expect(m.fns.addSavedMany).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactIds: ["c1"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByText(
        t.rota.savedManyResult({ added: 1, noRoom: 0, skipped: 0 }),
      ),
    ).toBeInTheDocument();
  });

  it("offers no saved list when nobody is saved", () => {
    m.saved = [];
    renderSetup();
    expect(screen.queryByRole("button", { name: t.rota.savedFrom })).toBeNull();
  });

  it("the imported person has no resend link", () => {
    renderSetup();
    const list = screen.getByRole("list", { name: t.rota.peopleList });
    expect(within(list).queryByRole("link")).toBeNull();
  });
});

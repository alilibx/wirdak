import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { RotaPeopleSetup } from "./RotaPeopleSetup";

const m = vi.hoisted(() => ({
  view: undefined as unknown,
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
        ...state,
      },
    ],
    freeJuz: [2, 3],
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
    expect(button).toHaveTextContent("٢٧ عضواً، بالأسماء فقط");
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
    expect(status).toHaveTextContent("٢٥ شخصاً");
    expect(status).toHaveTextContent("شخصين");
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
    await user.click(within(picker).getByRole("button", { name: /أم خالد/ }));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
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

  it("opens the saved people and adds one, with no juz' chosen", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.savedFrom }));
    const picker = screen.getByRole("dialog", { name: t.rota.savedTitle });
    await user.click(within(picker).getByRole("button", { name: /أم خالد/ }));
    expect(m.fns.addSaved).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      contactId: "c1",
    });
    // Several can be added in a row: the sheet stays until it is closed.
    expect(
      screen.getByRole("dialog", { name: t.rota.savedTitle }),
    ).toBeVisible();
    await user.click(
      within(picker).getByRole("button", { name: t.sheet.close }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

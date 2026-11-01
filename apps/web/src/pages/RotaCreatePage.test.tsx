import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RotaPeopleSetup } from "../features/rota/RotaPeopleSetup";
import { t } from "../i18n/ar";
import { RotaCreatePage } from "./RotaCreatePage";

type Person = {
  id: string;
  name: string;
  isMe: boolean;
  juz: number[];
  joined?: boolean;
};

const JOIN_LINK = "https://wa.me/971500000000?text=join";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  addParticipant: vi.fn(),
  giveJuz: vi.fn(),
  finishSetup: vi.fn(),
  ensureJoinLink: vi.fn(),
  joinLink: null as string | null,
  me: undefined as unknown,
  people: undefined as unknown,
  publicSettings: undefined as unknown,
  listeners: new Set<() => void>(),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  const { useSyncExternalStore } = await import("react");
  return {
    // Reactive like Convex: a change to the roster re-renders whoever reads it.
    useQuery: (ref: never) => {
      const people = useSyncExternalStore(
        (listener) => {
          m.listeners.add(listener);
          return () => m.listeners.delete(listener);
        },
        () => m.people,
      );
      if (getFunctionName(ref) === "publicSettings:get")
        return m.publicSettings;
      return getFunctionName(ref) === "people:me" ? m.me : people;
    },
    useAction: () => m.create,
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "rota:addParticipant") return m.addParticipant;
      if (name === "rota:finishSetup") return m.finishSetup;
      if (name === "rota:ensureJoinLink") return m.ensureJoinLink;
      return m.giveJuz;
    },
  };
});

/** The view `api.rota.people` returns for these participants (their juz' already placed). */
function peopleView(people: Person[]) {
  const participants = people.map((p) => ({
    phone: "+971500000001",
    joined: false,
    stopped: false,
    silenced: false,
    ...p,
  }));
  const holder = new Map<number, Person>();
  for (const p of participants) for (const juz of p.juz) holder.set(juz, p);
  return {
    title: "ختمة العائلة",
    daysKind: "weekly",
    joinLink: m.joinLink,
    requests: [],
    target: { number: 1, date: "2026-10-30", isFirst: true },
    rows: Array.from({ length: 30 }, (_, i) => {
      const person = holder.get(i + 1);
      return {
        juz: i + 1,
        participant: person
          ? {
              id: person.id,
              name: person.name,
              isMe: person.isMe,
              slots: person.juz.length,
            }
          : null,
      };
    }),
    participants,
    freeJuz: Array.from({ length: 30 }, (_, i) => i + 1).filter(
      (juz) => !holder.has(juz),
    ),
    maxSlots: 3,
  };
}

let roster: Person[] = [];
function setRoster(next: Person[]) {
  roster = next;
  m.people = peopleView(next);
  for (const listener of m.listeners) listener();
}

function Landing() {
  const location = useLocation();
  return <p>landed {location.pathname}</p>;
}

function renderCreate() {
  return render(
    <MemoryRouter initialEntries={["/new/rota"]}>
      <Routes>
        <Route path="/new/rota" element={<RotaCreatePage />} />
        <Route path="/new" element={<Landing />} />
        <Route path="/j/:inviteCode/setup" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

function renderSetup() {
  return render(
    <MemoryRouter initialEntries={["/j/CODE/setup"]}>
      <Routes>
        <Route path="/j/:inviteCode/setup" element={<RotaPeopleSetup />} />
        <Route path="/j/:inviteCode" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

// 2026-10-29 is a Thursday. The device's time zone is pinned to UTC so "tomorrow" is Friday the
// 30th whatever zone the machine running the tests is in.
beforeEach(() => {
  const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...resolved.call(this), timeZone: "UTC" };
    },
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
  m.create.mockReset();
  m.create.mockResolvedValue({ inviteCode: "NEWCODE" });
  m.addParticipant.mockReset();
  m.giveJuz.mockReset();
  m.finishSetup.mockReset();
  m.finishSetup.mockResolvedValue({ ok: true });
  m.ensureJoinLink.mockReset();
  m.ensureJoinLink.mockResolvedValue({ ok: true });
  m.joinLink = JOIN_LINK;
  m.me = { rotaAllowed: true };
  m.publicSettings = undefined;
  setRoster([{ id: "p1", name: "علي", isMe: true, juz: [1] }]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RotaCreatePage (step 1)", () => {
  it("shows step 1 of 2 with the name and the days, every day chosen", () => {
    renderCreate();
    expect(screen.getByText("١ من ٢")).toBeInTheDocument();
    expect(screen.getByLabelText(t.rota.nameQuestion)).toHaveValue("");
    expect(screen.getByRole("radio", { name: "كل يوم" })).toBeChecked();
    expect(screen.getByText("غداً، الجمعة ٣٠ أكتوبر")).toBeInTheDocument();
    expect(screen.getByText("تستمر دائماً")).toBeInTheDocument();
  });

  it("sends the defaults: every day, from tomorrow, no end, then goes to the people screen", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(
      screen.getByLabelText(t.rota.nameQuestion),
      "  ختمة العائلة ",
    );
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(m.create).toHaveBeenCalledWith({
      sessionToken: "tok",
      name: "ختمة العائلة",
      days: { kind: "daily" },
      firstDate: "2026-10-30",
      endDate: null,
    });
    expect(
      await screen.findByText("landed /j/NEWCODE/setup"),
    ).toBeInTheDocument();
  });

  it("sends Friday every week after choosing every week", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(t.rota.nameQuestion), "ختمة الجمعة");
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(m.create).toHaveBeenCalledWith({
      sessionToken: "tok",
      name: "ختمة الجمعة",
      days: { kind: "weekly", weekdays: [5], everyWeeks: 1 },
      firstDate: "2026-10-30",
      endDate: null,
    });
  });

  it("starts on the first reading day: tomorrow is skipped when it is not one", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(t.rota.nameQuestion), "ختمة");
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(screen.getByRole("button", { name: "الأحد" }));
    await user.click(screen.getByRole("button", { name: "الجمعة" }));
    // Sunday 1 November is the first reading day after Thursday.
    expect(screen.getByText("الأحد ١ نوفمبر")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ firstDate: "2026-11-01" }),
    );
  });

  it("lets the organizer change the start and the end with a date field each", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(t.rota.nameQuestion), "ختمة");
    await user.click(
      screen.getByRole("button", {
        name: `${t.rota.startLabel}: ${t.rota.change}`,
      }),
    );
    fireEvent.change(screen.getByLabelText(t.rota.startDateInput), {
      target: { value: "2026-11-05" },
    });
    await user.click(
      screen.getByRole("button", {
        name: `${t.rota.endLabel}: ${t.rota.change}`,
      }),
    );
    fireEvent.change(screen.getByLabelText(t.rota.endDateInput), {
      target: { value: "2027-03-01" },
    });
    expect(screen.getByText("الخميس ٥ نوفمبر")).toBeInTheDocument();
    expect(screen.getByText("الاثنين ١ مارس")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({
        firstDate: "2026-11-05",
        endDate: "2027-03-01",
      }),
    );
  });

  it("starts tomorrow at the earliest", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(
      screen.getByRole("button", {
        name: `${t.rota.startLabel}: ${t.rota.change}`,
      }),
    );
    expect(screen.getByLabelText(t.rota.startDateInput)).toHaveAttribute(
      "min",
      "2026-10-30",
    );
  });

  it("lets the start be today when an admin allows it, but no day before", async () => {
    m.publicSettings = { rotaStartNextDay: false };
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText(t.rota.nameQuestion), "ختمة");
    await user.click(
      screen.getByRole("button", {
        name: `${t.rota.startLabel}: ${t.rota.change}`,
      }),
    );
    const field = screen.getByLabelText(t.rota.startDateInput);
    expect(field).toHaveAttribute("min", "2026-10-29");
    fireEvent.change(field, { target: { value: "2026-10-29" } });
    expect(
      screen.getByText(t.rota.today("الخميس ٢٩ أكتوبر")),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({ firstDate: "2026-10-29" }),
    );
  });

  it("keeps the date field on the day the line shows when the picked start is not a reading day", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(
      screen.getByRole("button", {
        name: `${t.rota.startLabel}: ${t.rota.change}`,
      }),
    );
    // Thursday 5 November is not a Friday, so the start moves on to Friday the 6th.
    fireEvent.change(screen.getByLabelText(t.rota.startDateInput), {
      target: { value: "2026-11-05" },
    });
    expect(screen.getByText("الجمعة ٦ نوفمبر")).toBeInTheDocument();
    expect(screen.getByLabelText(t.rota.startDateInput)).toHaveValue(
      "2026-11-06",
    );
  });

  it("shows the message of an error code and stays on the page", async () => {
    m.create.mockRejectedValue(new ConvexError({ code: "invalid_name" }));
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "اكتب اسماً للختمة",
    );
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it.each([
    ["rota_cap", t.rota.errors.rota_cap],
    ["rota_not_allowed", t.rota.errors.rota_not_allowed],
    ["rate_limited", t.rota.errors.rate_limited],
    ["something_new", t.errors.generic],
  ])("maps %s to its message", async (code, message) => {
    m.create.mockRejectedValue(new ConvexError({ code }));
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message ?? "");
  });

  it("shows the network message when the call itself fails", async () => {
    m.create.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال");
  });

  it("creates only once while the call is in flight", async () => {
    let resolve: (v: { inviteCode: string }) => void = () => {};
    m.create.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "التالي" }));
    const busy = screen.getByRole("button", { name: t.rota.creating });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(m.create).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ inviteCode: "X" }));
    expect(await screen.findByText("landed /j/X/setup")).toBeInTheDocument();
  });

  it("sends someone who may not create one back to the type page", () => {
    m.me = { rotaAllowed: false };
    renderCreate();
    expect(screen.getByText("landed /new")).toBeInTheDocument();
  });

  it("waits for the answer before deciding", () => {
    m.me = undefined;
    renderCreate();
    expect(screen.queryByText("landed /new")).toBeNull();
    expect(screen.queryByLabelText(t.rota.nameQuestion)).toBeNull();
  });
});

describe("RotaPeopleSetup (step 2)", () => {
  it("shows step 2 of 2, the fields and the organizer first as «أنا»", () => {
    renderSetup();
    expect(screen.getByText("٢ من ٢")).toBeInTheDocument();
    const phone = screen.getByLabelText(t.rota.personPhone);
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(screen.getByText(/مع رمز الدولة، مثل/)).toBeInTheDocument();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("١");
    expect(items[0]).toHaveTextContent("أنا");
  });

  it("has the big share button next to «تمّ», opening the group message with the join link", () => {
    m.joinLink =
      "https://wa.me/971500000000?text=%D8%A7%D9%86%D8%B6%D9%85%D8%A7%D9%85";
    setRoster(roster);
    renderSetup();
    const share = screen.getByRole("link", { name: t.rota.shareJoin });
    expect(share).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(t.rota.shareMessage("ختمة العائلة", m.joinLink, "weekly"))}`,
    );
    expect(
      share.compareDocumentPosition(
        screen.getByRole("button", { name: t.rota.done }),
      ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(m.ensureJoinLink).not.toHaveBeenCalled();
  });

  it("shows who has joined, and a resend for each who has not", () => {
    setRoster([
      { id: "p1", name: "علي", isMe: true, juz: [1], joined: true },
      { id: "p2", name: "خالد", isMe: false, juz: [2] },
    ]);
    renderSetup();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(
      within(items[0] as HTMLElement).getByText(t.rota.joined),
    ).toBeInTheDocument();
    const resend = within(items[1] as HTMLElement).getByRole("link", {
      name: t.rota.notJoined,
    });
    expect(resend.getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/971500000001\?text=/,
    );
  });

  it("asks for a join link when the khatma has none and offers no share button until it comes", () => {
    m.joinLink = null;
    setRoster(roster);
    renderSetup();
    expect(m.ensureJoinLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: t.rota.shareJoin })).toBeNull();
    expect(
      screen.getByRole("button", { name: t.rota.done }),
    ).toBeInTheDocument();
  });

  it("adds two people in order and lists them as 2 and 3", async () => {
    m.addParticipant.mockImplementation(
      (args: { name: string; phone: string }) => {
        const juz = roster.length + 1;
        const id = `p${juz}`;
        setRoster([
          ...roster,
          { id, name: args.name, isMe: false, juz: [juz] },
        ]);
        return Promise.resolve({ ok: true, participantId: id, juz });
      },
    );
    const user = userEvent.setup();
    renderSetup();
    for (const [name, phone] of [
      ["أم أحمد", "+971500000001"],
      ["خالد", "+971500000002"],
    ] as const) {
      await user.type(screen.getByLabelText(t.rota.personName), name);
      await user.type(screen.getByLabelText(t.rota.personPhone), phone);
      await user.click(screen.getByRole("button", { name: "أضف" }));
      // The fields empty after each add.
      expect(await screen.findByLabelText(t.rota.personName)).toHaveValue("");
      expect(screen.getByLabelText(t.rota.personPhone)).toHaveValue("");
    }
    expect(m.addParticipant).toHaveBeenNthCalledWith(1, {
      sessionToken: "tok",
      inviteCode: "CODE",
      name: "أم أحمد",
      phone: "+971500000001",
    });
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^١.*أنا/),
      expect.stringMatching(/^٢.*أم أحمد/),
      expect.stringMatching(/^٣.*خالد/),
    ]);
  });

  it.each([
    ["bad_phone", t.rota.addErrors.bad_phone],
    ["already_added", t.rota.addErrors.already_added],
    ["bad_name", t.rota.addErrors.bad_name],
  ])(
    "keeps the fields and shows the message for %s",
    async (error, message) => {
      m.addParticipant.mockResolvedValue({ error });
      const user = userEvent.setup();
      renderSetup();
      await user.type(screen.getByLabelText(t.rota.personName), "سارة");
      await user.type(screen.getByLabelText(t.rota.personPhone), "123");
      await user.click(screen.getByRole("button", { name: "أضف" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message ?? "");
      expect(screen.getByLabelText(t.rota.personName)).toHaveValue("سارة");
      expect(screen.getByLabelText(t.rota.personPhone)).toHaveValue("123");
    },
  );

  it("maps a thrown error code to its message, and a failed call to the network message", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.type(screen.getByLabelText(t.rota.personName), "سارة");
    await user.type(screen.getByLabelText(t.rota.personPhone), "+971500000009");
    m.addParticipant.mockRejectedValue(new ConvexError({ code: "forbidden" }));
    await user.click(screen.getByRole("button", { name: "أضف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.forbidden ?? "",
    );
    m.addParticipant.mockRejectedValue(
      new ConvexError({ code: "something_new" }),
    );
    await user.click(screen.getByRole("button", { name: "أضف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.generic,
    );
    m.addParticipant.mockRejectedValue(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "أضف" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.network,
    );
  });

  it("maps a thrown error from handing out a juz' the same way", async () => {
    m.giveJuz.mockRejectedValue(new ConvexError({ code: "forbidden" }));
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: /بلا قارئ/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /أنا/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.forbidden ?? "",
    );
  });

  it("with the organizer and one more, 28 ajza' are still without a reader", () => {
    setRoster([
      { id: "p1", name: "علي", isMe: true, juz: [1] },
      { id: "p2", name: "خالد", isMe: false, juz: [2] },
    ]);
    renderSetup();
    expect(
      screen.getByRole("button", { name: /بقي ٢٨ جزءاً بلا قارئ/ }),
    ).toBeInTheDocument();
  });

  it("names the leftover ajza' while they are few", () => {
    setRoster(
      Array.from({ length: 28 }, (_, i) => ({
        id: `p${i + 1}`,
        name: `شخص ${i + 1}`,
        isMe: i === 0,
        juz: [i + 1],
      })),
    );
    renderSetup();
    expect(
      screen.getByRole("button", { name: /بقي جزءان بلا قارئ \(٢٩ و٣٠\)/ }),
    ).toBeInTheDocument();
  });

  it("has no banner when everyone is placed", () => {
    setRoster([
      {
        id: "p1",
        name: "علي",
        isMe: true,
        juz: Array.from({ length: 30 }, (_, i) => i + 1),
      },
    ]);
    renderSetup();
    expect(screen.queryByText(/بلا قارئ/)).toBeNull();
  });

  it("the banner opens a sheet to give the next leftover juz' to someone", async () => {
    m.giveJuz.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: /بلا قارئ/ }));
    const sheet = screen.getByRole("dialog", {
      name: "من يقرأ الجزء ٢ أيضاً؟",
    });
    await user.click(within(sheet).getByRole("button", { name: /أنا/ }));
    expect(m.giveJuz).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      participantId: "p1",
      juz: 2,
    });
  });

  it("the sheet moves on to the next leftover juz' and closes when none is left", async () => {
    m.giveJuz.mockImplementation(
      (args: { participantId: string; juz: number }) => {
        setRoster(
          roster.map((p) =>
            p.id === args.participantId
              ? { ...p, juz: [...p.juz, args.juz] }
              : p,
          ),
        );
        return Promise.resolve({ ok: true });
      },
    );
    setRoster([
      {
        id: "p1",
        name: "علي",
        isMe: true,
        juz: Array.from({ length: 28 }, (_, i) => i + 1),
      },
      { id: "p2", name: "خالد", isMe: false, juz: [] },
    ]);
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: /بلا قارئ/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /خالد/ }),
    );
    expect(
      await screen.findByRole("dialog", { name: "من يقرأ الجزء ٣٠ أيضاً؟" }),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /خالد/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the sheet does not offer someone who already reads the most", async () => {
    setRoster([
      { id: "p1", name: "علي", isMe: true, juz: [1, 2, 3] },
      { id: "p2", name: "خالد", isMe: false, juz: [4] },
    ]);
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: /بلا قارئ/ }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByRole("button", { name: /أنا/ })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: /خالد/ })).toBeEnabled();
  });

  it("shows why a give failed and keeps the sheet open", async () => {
    m.giveJuz.mockResolvedValue({ error: "too_many" });
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: /بلا قارئ/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /أنا/ }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.giveErrors.too_many ?? "",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("«تمّ» finishes setup, then goes to the khatma page", async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.done }));
    expect(m.finishSetup).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(await screen.findByText("landed /j/CODE")).toBeInTheDocument();
  });

  it("stays on the page and says why when setup can't be finished", async () => {
    m.finishSetup.mockRejectedValue(new ConvexError({ code: "archived" }));
    const user = userEvent.setup();
    renderSetup();
    await user.click(screen.getByRole("button", { name: t.rota.done }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.archived ?? "",
    );
    expect(screen.queryByText("landed /j/CODE")).toBeNull();
  });

  it("sends a non-organizer to the khatma page", () => {
    m.people = null;
    renderSetup();
    expect(screen.getByText("landed /j/CODE")).toBeInTheDocument();
  });
});

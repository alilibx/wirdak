import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HoldView, KhatmaView } from "@convex/khatmas";
import type { NoteView } from "@convex/notes";
import { t } from "../i18n/ar";
import { makeTiles, makeView } from "../test/fixtures";
import { KhatmaPage, KhatmaRoute } from "./KhatmaPage";

const m = vi.hoisted(() => ({
  query: vi.fn(),
  notes: [] as unknown[],
  take: vi.fn(),
  finish: vi.fn(),
  undoFinish: vi.fn(),
  release: vi.fn(),
  markCelebrated: vi.fn(),
  signOut: vi.fn(),
  ensureShareToken: vi.fn(),
  stillReading: vi.fn(),
  dismiss: vi.fn(),
  setNotifications: vi.fn(),
  cleared: vi.fn(),
  token: undefined as string | undefined,
}));

vi.mock("../lib/session", async (importOriginal) => ({
  // Real storage helpers: the push prompt after a first take reads its "asked" flag from them.
  ...(await importOriginal<typeof import("../lib/session")>()),
  useSessionToken: () => m.token,
  getSessionToken: () => m.token ?? null,
  clearSessionToken: () => {
    m.cleared();
    m.token = undefined;
  },
}));
vi.mock("../features/verify/VerifySheet", () => ({
  VerifySheet: (props: {
    title: string;
    intent?: unknown;
    onVerified: () => void;
  }) => (
    <div
      role="dialog"
      aria-label={props.title}
      data-intent={JSON.stringify(props.intent)}
    >
      <button onClick={props.onVerified}>verified</button>
    </div>
  ),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useAction: () => m.ensureShareToken,
    useQuery: (ref: never, ...rest: unknown[]) =>
      getFunctionName(ref) === "notes:forKhatma"
        ? m.notes
        : getFunctionName(ref) === "khatmas:mine"
          ? []
          : m.query(ref, ...rest),
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] as
        | "take"
        | "finish"
        | "undoFinish"
        | "release"
        | "markCelebrated"
        | "signOut"
        | "stillReading"
        | "dismiss"
        | "setNotifications";
      return m[name];
    },
  };
});

const tree = (url = "/j/CODE") => (
  <MemoryRouter initialEntries={[url]}>
    <Routes>
      <Route path="/j/:inviteCode" element={<KhatmaPage />} />
    </Routes>
  </MemoryRouter>
);

const signedIn = (over: Partial<KhatmaView["me"]> = {}): KhatmaView["me"] => ({
  signedIn: true,
  displayName: "علي",
  isMember: true,
  notificationsOn: true,
  holding: null,
  hold: null,
  suggestion: 3,
  celebrateRound: null,
  ...over,
});

const NOW = Date.UTC(2026, 9, 28, 12);

function setup(view: KhatmaView | undefined, url?: string) {
  m.query.mockReturnValue(view);
  const raw = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  // A click starts a server call; let its promise and the resulting render settle before asserting.
  const user = {
    click: async (element: Element) => {
      await raw.click(element);
      await act(async () => {});
    },
  };
  const utils = render(tree(url));
  return {
    user,
    ...utils,
    show: (next: KhatmaView | undefined) => {
      m.query.mockReturnValue(next);
      utils.rerender(tree(url));
    },
  };
}

const toast = () => screen.getByRole("status");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // Testing Library only drives fake timers it can see through a `jest` global.
  vi.stubGlobal("jest", {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  });
  vi.setSystemTime(NOW);
  localStorage.clear();
  // The offer after a first take (push or WhatsApp) has its own tests in KhatmaPage.push.
  localStorage.setItem("wirdak.pushAsked", "1");
  m.token = "tok";
  for (const fn of [
    m.query,
    m.take,
    m.finish,
    m.undoFinish,
    m.release,
    m.markCelebrated,
    m.signOut,
    m.stillReading,
    m.dismiss,
    m.setNotifications,
    m.cleared,
  ]) {
    fn.mockReset();
  }
  m.notes = [];
  m.ensureShareToken.mockResolvedValue({ shareToken: "SHARE9" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("take", () => {
  it("opens the take sheet for the suggestion and takes it", async () => {
    m.take.mockResolvedValue({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    const sheet = screen.getByRole("dialog", { name: "الجزء 3" });
    expect(sheet).toHaveTextContent("يبدأ من سورة");
    await user.click(
      within(sheet).getByRole("button", { name: "نعم، هذا جزئي" }),
    );
    expect(m.take).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      juz: 3,
    });
    expect(toast()).toHaveTextContent("الجزء 3 لك الآن. يسّر الله لك");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the sheet for the tile that was tapped, and 'not now' closes it", async () => {
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=pool");
    await user.click(screen.getByRole("button", { name: /^الجزء 9،/ }));
    const sheet = screen.getByRole("dialog", { name: "الجزء 9" });
    await user.click(within(sheet).getByRole("button", { name: "ليس الآن" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(m.take).not.toHaveBeenCalled();
  });

  it("taken shows the race toast, then reopens with the new suggestion once the view updates", async () => {
    m.take.mockResolvedValue({ ok: false, reason: "taken" });
    const { user, show } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(toast()).toHaveTextContent("سبقك أحدهم إليه. اخترنا لك غيره.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    show(
      makeView({
        tiles: makeTiles({ 3: { state: "reading", readerName: "سارة" } }),
        me: signedIn({ suggestion: 4 }),
      }),
    );
    expect(screen.getByRole("dialog", { name: "الجزء 4" })).toBeInTheDocument();
  });

  it("switches to جزئي after a take from الأجزاء", async () => {
    m.take.mockResolvedValue({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=pool");
    await user.click(screen.getByRole("button", { name: /^الجزء 5،/ }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(screen.getByRole("tab", { name: t.nav.tabs.mine })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("puts focus on the جزئي tab after a take from الأجزاء", async () => {
    m.take.mockResolvedValue({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=pool");
    await user.click(screen.getByRole("button", { name: /^الجزء 5،/ }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(screen.getByRole("tab", { name: t.nav.tabs.mine })).toHaveFocus();
  });

  it("stays on the pool tab when the take fails", async () => {
    m.take.mockResolvedValue({ ok: false, reason: "taken" });
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=pool");
    await user.click(screen.getByRole("button", { name: /^الجزء 5،/ }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(screen.getByRole("tab", { name: t.nav.tabs.pool })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("taken with nothing left open closes the sheet and leaves the all-taken card", async () => {
    m.take.mockResolvedValue({ ok: false, reason: "taken" });
    const { user, show } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    show(
      makeView({
        tiles: makeTiles(
          Object.fromEntries(
            Array.from({ length: 30 }, (_, i) => [
              i + 1,
              { state: "reading" as const },
            ]),
          ),
        ),
        me: signedIn({ suggestion: null }),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("كل الأجزاء مأخوذة الآن")).toBeInTheDocument();
  });

  it("khatma_full shows the full-group copy and closes the sheet", async () => {
    m.take.mockResolvedValue({ ok: false, reason: "khatma_full" });
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(toast()).toHaveTextContent("اكتمل عدد المشاركين في هذه الختمة.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["already_holding", t.actions.errors.take.already_holding],
    ["blocked", t.actions.errors.shared.blocked],
    ["maintenance", t.actions.errors.shared.maintenance],
    ["rate_limited", t.actions.errors.shared.rate_limited],
  ])("%s shows its own kind copy", async (reason, copy) => {
    m.take.mockResolvedValue({ ok: false, reason });
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(toast()).toHaveTextContent(copy);
    expect(copy.length).toBeGreaterThan(10);
  });

  it("a thrown take shows the network toast and can be retried", async () => {
    m.take.mockRejectedValueOnce(new Error("offline"));
    m.take.mockResolvedValueOnce({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(toast()).toHaveTextContent(t.errors.network);
    const again = screen.getByRole("button", { name: "نعم، هذا جزئي" });
    expect(again).toBeEnabled();
    await user.click(again);
    expect(m.take).toHaveBeenCalledTimes(2);
    expect(toast()).toHaveTextContent("لك الآن");
  });

  it("disables the confirm button while the take runs, so a double tap sends once", async () => {
    let finish!: (v: { ok: true }) => void;
    m.take.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    const confirm = screen.getByRole("button", { name: "نعم، هذا جزئي" });
    await user.click(confirm);
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(m.take).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true }));
    expect(toast()).toHaveTextContent("لك الآن");
  });

  it("a take that lands after leaving the khatma does not pull the person back", async () => {
    let finish!: (v: { ok: true }) => void;
    m.take.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    m.query.mockReturnValue(makeView({ me: signedIn() }));
    const raw = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    function Where() {
      const { pathname, search } = useLocation();
      return <output data-testid="where">{pathname + search}</output>;
    }
    render(
      <MemoryRouter initialEntries={["/j/CODE?tab=pool"]}>
        <Link to="/j/OTHER">other khatma</Link>
        <Where />
        <Routes>
          <Route path="/j/:inviteCode" element={<KhatmaRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await raw.click(screen.getByRole("button", { name: /^الجزء 9،/ }));
    await raw.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    await raw.click(screen.getByRole("link", { name: "other khatma" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/j/OTHER");
    await act(async () => finish({ ok: true }));
    expect(screen.getByTestId("where")).toHaveTextContent("/j/OTHER");
  });
});

describe("a session revoked elsewhere", () => {
  const signedOutError = () => new ConvexError({ code: "not_signed_in" });
  const holding = () =>
    makeView({ me: signedIn({ holding: 5, suggestion: null }) });

  it("a take forgets the dead token and opens verification for the same juz'", async () => {
    m.take.mockRejectedValue(signedOutError());
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=pool");
    await user.click(screen.getByRole("button", { name: /^الجزء 9،/ }));
    await user.click(screen.getByRole("button", { name: t.take.confirm }));
    expect(m.cleared).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "الجزء 9" })).toBeNull();
    const verify = screen.getByRole("dialog", { name: t.verify.beforeTake });
    expect(JSON.parse(verify.dataset.intent ?? "null")).toEqual({
      kind: "take",
      inviteCode: "CODE",
      juz: 9,
    });
    expect(toast()).not.toHaveTextContent(t.errors.network);
  });

  it("a finish forgets the dead token and asks to sign in again", async () => {
    m.finish.mockRejectedValue(signedOutError());
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(m.cleared).toHaveBeenCalledTimes(1);
    expect(toast()).toHaveTextContent(t.actions.errors.signedOut);
  });

  it("an undo forgets the dead token and asks to sign in again", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    m.undoFinish.mockRejectedValue(signedOutError());
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    await user.click(within(toast()).getByRole("button", { name: "تراجع" }));
    expect(m.cleared).toHaveBeenCalledTimes(1);
    expect(toast()).toHaveTextContent(t.actions.errors.signedOut);
  });

  it("a release forgets the dead token and asks to sign in again", async () => {
    m.release.mockRejectedValue(signedOutError());
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    await user.click(screen.getByRole("button", { name: "أعِده إلى الختمة" }));
    expect(m.cleared).toHaveBeenCalledTimes(1);
    expect(toast()).toHaveTextContent(t.actions.errors.signedOut);
  });

  it("a pool action refused because the khatma got archived says so", async () => {
    m.take.mockRejectedValue(new ConvexError({ code: "archived" }));
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: t.take.confirm }));
    expect(toast()).toHaveTextContent(t.actions.errors.archived);
    expect(m.cleared).not.toHaveBeenCalled();
  });

  it("another server error shows the generic copy, not the network copy", async () => {
    m.take.mockRejectedValue(new ConvexError({ code: "not_found" }));
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: t.take.confirm }));
    expect(toast()).toHaveTextContent(t.errors.generic);
    expect(m.cleared).not.toHaveBeenCalled();
  });
});

describe("whose account takes the juz' (shared phone)", () => {
  const signedOutView = () =>
    makeView({
      me: {
        signedIn: false,
        displayName: null,
        isMember: false,
        notificationsOn: null,
        holding: null,
        hold: null,
        suggestion: 3,
        celebrateRound: null,
      },
    });

  it("the take sheet names the signed-in account", async () => {
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    const sheet = screen.getByRole("dialog", { name: "الجزء 3" });
    expect(sheet).toHaveTextContent(t.take.as("علي"));
    expect(
      within(sheet).getByRole("button", { name: t.take.notYou("علي") }),
    ).toBeInTheDocument();
  });

  it("'not you?' signs out, forgets the token, verifies, then offers the same juz' to the new account", async () => {
    m.signOut.mockResolvedValue(null);
    const { user, show } = setup(
      makeView({ me: signedIn() }),
      "/j/CODE?tab=pool",
    );
    await user.click(screen.getByRole("button", { name: /^الجزء 9،/ }));
    await user.click(
      screen.getByRole("button", { name: t.take.notYou("علي") }),
    );
    expect(m.signOut).toHaveBeenCalledWith({ sessionToken: "tok" });
    expect(m.cleared).toHaveBeenCalledTimes(1);
    expect(m.take).not.toHaveBeenCalled();
    const verify = screen.getByRole("dialog", { name: t.verify.beforeTake });
    expect(JSON.parse(verify.dataset.intent ?? "null")).toEqual({
      kind: "take",
      inviteCode: "CODE",
      juz: 9,
    });
    expect(screen.queryByRole("dialog", { name: "الجزء 9" })).toBeNull();

    show(signedOutView()); // the view reloads without a token
    await user.click(screen.getByRole("button", { name: "verified" }));
    m.token = "sara";
    show(makeView({ me: signedIn({ displayName: "سارة", suggestion: 1 }) }));
    const sheet = screen.getByRole("dialog", { name: "الجزء 9" });
    expect(sheet).toHaveTextContent(t.take.as("سارة"));
    await user.click(
      within(sheet).getByRole("button", { name: t.take.confirm }),
    );
    expect(m.take).toHaveBeenCalledWith({
      sessionToken: "sara",
      inviteCode: "CODE",
      juz: 9,
    });
  });

  it("a failed sign-out keeps the account and the sheet, with the network toast", async () => {
    m.signOut.mockRejectedValue(new Error("offline"));
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(
      screen.getByRole("button", { name: t.take.notYou("علي") }),
    );
    expect(m.cleared).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "الجزء 3" })).toBeInTheDocument();
    expect(toast()).toHaveTextContent(t.errors.network);
  });
});

describe("live region", () => {
  it("is mounted before any toast, polite, and stays the same node when one arrives", async () => {
    m.take.mockResolvedValue({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }));
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("لك الآن");
  });
});

describe("stale state", () => {
  const lostRace = async () => {
    m.take.mockResolvedValue({ ok: false, reason: "taken" });
    const ctx = setup(makeView({ me: signedIn() }));
    await ctx.user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await ctx.user.click(screen.getByRole("button", { name: "نعم، هذا جزئي" }));
    return ctx;
  };
  const later = () =>
    makeView({
      tiles: makeTiles({ 3: { state: "reading", readerName: "سارة" } }),
      me: signedIn({ suggestion: 4 }),
    });

  it("the wait for a new suggestion is bounded: a later unrelated change opens nothing", async () => {
    const { show } = await lostRace();
    act(() => void vi.advanceTimersByTime(6_000));
    show(later());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("any user action ends the wait", async () => {
    const { user, show } = await lostRace();
    await user.click(screen.getByRole("tab", { name: t.nav.tabs.pool }));
    await user.click(screen.getByRole("button", { name: /^الجزء 9،/ }));
    await user.click(screen.getByRole("button", { name: "ليس الآن" }));
    show(later());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a finished attempt does not reopen again on the next change", async () => {
    const { user, show } = await lostRace();
    show(later());
    expect(screen.getByRole("dialog", { name: "الجزء 4" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ليس الآن" }));
    show(
      makeView({
        tiles: makeTiles({ 3: { state: "reading" }, 4: { state: "reading" } }),
        me: signedIn({ suggestion: 5 }),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clears the take sheet when the celebration starts, and it stays gone afterwards", async () => {
    const { user, show } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    show(
      makeView({
        lastCompleted: { roundNumber: 12, participants: 7 },
        me: signedIn({ celebrateRound: 12 }),
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    show(makeView({ me: signedIn() }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the release sheet when the juz' is no longer held", async () => {
    const { user, show } = setup(
      makeView({ me: signedIn({ holding: 5, suggestion: null }) }),
    );
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    show(makeView({ me: signedIn({ holding: null, suggestion: 3 }) }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("take after verification", () => {
  const signedOut = () =>
    makeView({
      me: {
        signedIn: false,
        displayName: null,
        isMember: false,
        notificationsOn: null,
        holding: null,
        hold: null,
        suggestion: 3,
        celebrateRound: null,
      },
    });

  async function verifyWhileSignedOut() {
    m.token = undefined;
    const ctx = setup(signedOut());
    await ctx.user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    ctx.show(undefined); // the view reloads under the new token
    await ctx.user.click(screen.getByRole("button", { name: "verified" }));
    return ctx;
  }

  it("waits for the view to load, then opens the sheet for the pending juz'", async () => {
    const { show } = await verifyWhileSignedOut();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    m.token = "new";
    show(
      makeView({
        tiles: makeTiles(),
        me: signedIn({ suggestion: 5 }),
      }),
    );
    expect(screen.getByRole("dialog", { name: "الجزء 3" })).toBeInTheDocument();
  });

  it("does not open the sheet when the person already holds a juz'", async () => {
    const { show } = await verifyWhileSignedOut();
    m.token = "new";
    show(makeView({ me: signedIn({ holding: 8, suggestion: null }) }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("جزؤك الآن")).toBeInTheDocument();
  });

  it("tells the verify sheet which juz' on which khatma it is for", async () => {
    m.token = undefined;
    const { user } = setup(signedOut());
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    const sheet = screen.getByRole("dialog", { name: t.verify.beforeTake });
    expect(JSON.parse(sheet.dataset.intent ?? "null")).toEqual({
      kind: "take",
      inviteCode: "CODE",
      juz: 3,
    });
  });

  describe("after the tab reloads mid-verification", () => {
    const saveProgress = (inviteCode: string) =>
      localStorage.setItem(
        "wirdak.verify",
        JSON.stringify({
          verificationId: "v1",
          secret: "sec",
          displayName: "علي",
          expiresAt: NOW + 5 * 60_000,
          intent: { kind: "take", inviteCode, juz: 7 },
        }),
      );

    it("reopens the verify sheet for the stored juz', then offers it once verified", async () => {
      saveProgress("CODE");
      m.token = undefined;
      const { user, show } = setup(signedOut());
      const sheet = screen.getByRole("dialog", { name: t.verify.beforeTake });
      expect(JSON.parse(sheet.dataset.intent ?? "null")).toMatchObject({
        juz: 7,
      });
      await user.click(screen.getByRole("button", { name: "verified" }));
      m.token = "new";
      show(makeView({ me: signedIn({ suggestion: 1 }) }));
      expect(
        screen.getByRole("dialog", { name: "الجزء 7" }),
      ).toBeInTheDocument();
    });

    it("stays closed on another khatma's page", () => {
      saveProgress("OTHER");
      m.token = undefined;
      setup(signedOut());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("stays closed when the stored verification has expired", () => {
      saveProgress("CODE");
      vi.setSystemTime(NOW + 10 * 60_000);
      m.token = undefined;
      setup(signedOut());
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("does not open the sheet from the stale signed-out view", async () => {
    m.token = undefined;
    const { user } = setup(signedOut());
    await user.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await user.click(screen.getByRole("button", { name: "verified" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("finish and undo", () => {
  const holding = () =>
    makeView({ me: signedIn({ holding: 5, suggestion: null }) });

  it("switching to another khatma drops the undo toast, so undo never hits the wrong khatma", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    m.query.mockReturnValue(holding());
    const raw = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <MemoryRouter initialEntries={["/j/CODE"]}>
        <Link to="/j/OTHER">other khatma</Link>
        <Routes>
          <Route path="/j/:inviteCode" element={<KhatmaRoute />} />
        </Routes>
      </MemoryRouter>,
    );
    await raw.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    await act(async () => {});
    expect(screen.getByRole("button", { name: "تراجع" })).toBeInTheDocument();
    await raw.click(screen.getByRole("link", { name: "other khatma" }));
    expect(screen.queryByRole("button", { name: "تراجع" })).toBeNull();
  });

  it("finish shows the undo toast, and undo calls undoFinish", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    m.undoFinish.mockResolvedValue({ ok: true });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(m.finish).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    const bar = toast();
    expect(bar).toHaveAttribute("aria-live", "polite");
    expect(bar).toHaveTextContent("تقبّل الله منك 🤍");
    await user.click(within(bar).getByRole("button", { name: "تراجع" }));
    expect(m.undoFinish).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(toast()).toHaveTextContent(t.toast.undone);
    expect(screen.queryByRole("button", { name: "تراجع" })).toBeNull();
  });

  it("the undo bar runs for the time left and the button disappears at zero", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 4_000 });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(screen.getByTestId("undo-bar")).toHaveStyle({
      animationDuration: "4000ms",
    });
    act(() => void vi.advanceTimersByTime(3_900));
    expect(screen.getByRole("button", { name: "تراجع" })).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(200));
    expect(screen.queryByRole("button", { name: "تراجع" })).toBeNull();
    expect(toast()).toHaveTextContent("تقبّل الله منك 🤍");
    act(() => void vi.advanceTimersByTime(10_000));
    expect(toast()).toBeEmptyDOMElement();
  });

  it.each([
    ["ahead of this clock by a minute", NOW + 60_000],
    ["already in the past", NOW - 5],
    ["exactly now", NOW],
  ])(
    "a skewed undoUntil (%s) falls back to the full window from receipt",
    async (_label, undoUntil) => {
      m.finish.mockResolvedValue({ ok: true, undoUntil });
      const { user } = setup(holding());
      await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
      expect(screen.getByTestId("undo-bar")).toHaveStyle({
        animationDuration: "10000ms",
      });
      expect(screen.getByRole("button", { name: "تراجع" })).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(9_900));
      expect(screen.getByRole("button", { name: "تراجع" })).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.queryByRole("button", { name: "تراجع" })).toBeNull();
    },
  );

  it("trusts a deadline inside the window, even when it is the last millisecond", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(screen.getByTestId("undo-bar")).toHaveStyle({
      animationDuration: "10000ms",
    });
  });

  it("only one toast shows at a time, and the newest wins", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    m.undoFinish.mockResolvedValue({
      ok: false,
      reason: "window_closed",
    });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    await user.click(screen.getByRole("button", { name: "تراجع" }));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(toast().children).toHaveLength(1);
    expect(toast()).toHaveTextContent(t.actions.errors.undo.window_closed);
    expect(toast()).not.toHaveTextContent("🤍");
  });

  it.each([
    "holding_another",
    "round_completed",
    "nothing_to_undo",
    "blocked",
    "rate_limited",
    "maintenance",
  ] as const)("undo %s shows kind copy", async (reason) => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    m.undoFinish.mockResolvedValue({ ok: false, reason });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    await user.click(screen.getByRole("button", { name: "تراجع" }));
    const copy =
      reason in t.actions.errors.undo
        ? t.actions.errors.undo[reason as keyof typeof t.actions.errors.undo]
        : t.actions.errors.shared[
            reason as keyof typeof t.actions.errors.shared
          ];
    expect(toast()).toHaveTextContent(copy);
  });

  it("finish failures show kind copy", async () => {
    m.finish.mockResolvedValue({ ok: false, reason: "not_holding" });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(toast()).toHaveTextContent(t.actions.errors.notHolding);
  });

  it("a thrown finish shows the network toast", async () => {
    m.finish.mockRejectedValue(new Error("offline"));
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(toast()).toHaveTextContent(t.errors.network);
    expect(
      screen.getByRole("button", { name: "أتممتُ القراءة" }),
    ).toBeEnabled();
  });

  it("clears its timers when the page unmounts", async () => {
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    const { user, unmount } = setup(holding());
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("release", () => {
  const holding = () =>
    makeView({ me: signedIn({ holding: 5, suggestion: null }) });

  it("asks for confirmation first, then releases", async () => {
    m.release.mockResolvedValue({ ok: true });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    expect(m.release).not.toHaveBeenCalled();
    const sheet = screen.getByRole("dialog", {
      name: "لا بأس، جزاك الله خيراً",
    });
    expect(sheet).toHaveTextContent(
      "سنعيد الجزء 5 ليقرأه غيرك. لن يعرف أحد أنك أعدته.",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "أعِده إلى الختمة" }),
    );
    expect(m.release).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toast()).toHaveTextContent("أعدناه إلى الختمة. جزاك الله خيراً");
  });

  it("keeping the juz' closes the sheet without releasing", async () => {
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    await user.click(
      screen.getByRole("button", { name: "سأكمله إن شاء الله" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(m.release).not.toHaveBeenCalled();
  });

  it("a failed release closes the sheet with kind copy", async () => {
    m.release.mockResolvedValue({ ok: false, reason: "not_holding" });
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    await user.click(screen.getByRole("button", { name: "أعِده إلى الختمة" }));
    expect(toast()).toHaveTextContent(t.actions.errors.notHolding);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a thrown release keeps the sheet open for a retry", async () => {
    m.release.mockRejectedValue(new Error("offline"));
    const { user } = setup(holding());
    await user.click(screen.getByRole("button", { name: "لا أستطيع إكماله" }));
    await user.click(screen.getByRole("button", { name: "أعِده إلى الختمة" }));
    expect(toast()).toHaveTextContent(t.errors.network);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "أعِده إلى الختمة" }),
    ).toBeEnabled();
  });
});

describe("celebration", () => {
  const celebrating = () =>
    makeView({
      lastCompleted: { roundNumber: 12, participants: 7 },
      me: signedIn({ celebrateRound: 12, suggestion: 1 }),
    });

  it("replaces the khatma content and shows both duas with references", () => {
    setup(celebrating());
    expect(
      screen.getByRole("heading", { level: 1, name: "ختمنا القرآن معاً" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("الحمد لله، ختمة العائلة، الختمة 12"),
    ).toBeInTheDocument();
    expect(screen.getByText("شارك فيها 7 من أحبابك")).toBeInTheDocument();
    expect(screen.getByText(/رَبَّنَا تَقَبَّلْ/)).toBeInTheDocument();
    expect(screen.getByText("البقرة 127")).toBeInTheDocument();
    expect(screen.getByText("البقرة 201")).toBeInTheDocument();
    expect(screen.queryByText("الأجزاء الثلاثون")).not.toBeInTheDocument();
  });

  it("marks the round celebrated, and the khatma returns once the view flips", async () => {
    m.markCelebrated.mockResolvedValue({ ok: true });
    const { user, show } = setup(celebrating());
    await user.click(screen.getByRole("button", { name: "تابع إلى الختمة" }));
    expect(m.markCelebrated).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    show(makeView({ me: signedIn() }));
    expect(screen.getByRole("tab", { name: t.nav.tabs.mine })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("a failed or thrown markCelebrated shows a toast and allows a retry", async () => {
    m.markCelebrated.mockResolvedValueOnce({ ok: false });
    m.markCelebrated.mockRejectedValueOnce(new Error("offline"));
    const { user } = setup(celebrating());
    const go = () => screen.getByRole("button", { name: "تابع إلى الختمة" });
    await user.click(go());
    expect(toast()).toHaveTextContent(t.errors.generic);
    expect(go()).toBeEnabled();
    await user.click(go());
    expect(toast()).toHaveTextContent(t.errors.network);
    expect(m.markCelebrated).toHaveBeenCalledTimes(2);
  });

  it("the share link names nobody", () => {
    setup({
      ...celebrating(),
      inviterName: "أحمد",
      tiles: makeTiles({ 2: { state: "reading", readerName: "سارة" } }),
    });
    const href =
      screen
        .getByRole("link", { name: "شارك الفرحة على واتساب" })
        .getAttribute("href") ?? "";
    const text = decodeURIComponent(href.split("text=")[1] ?? "");
    expect(text).not.toMatch(/سارة|أحمد|العائلة/);
    expect(text).toContain("ختمنا القرآن معاً");
  });
});

const note = (over: Partial<NoteView> = {}): NoteView => ({
  noteId: "n1" as NoteView["noteId"],
  kind: "almostUp",
  juz: [5],
  count: null,
  until: null,
  createdAt: 1,
  ...over,
});

describe("notes", () => {
  const holdingView = (hold: Partial<HoldView> = {}) =>
    makeView({
      tiles: makeTiles({ 5: { state: "reading", isMine: true } }),
      me: signedIn({
        holding: 5,
        suggestion: null,
        hold: { openForHelp: false, canExtend: true, paceDays: null, ...hold },
      }),
    });

  it("shows the member's notes above the main card, newest first", () => {
    m.notes = [
      note({ noteId: "n2" as NoteView["noteId"], kind: "thanks", juz: [9] }),
      note(),
    ];
    setup(holdingView());
    const first = screen.getByText(/^أحدهم يُكمل الجزء 9 الآن/);
    const second = screen.getByText(/^مهلة الجزء 5 أوشكت/);
    const card = screen.getByText(t.card.held);
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      second.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows no notes for someone who is not a member", () => {
    m.notes = [note()];
    setup(
      makeView({
        me: signedIn({ isMember: false, holding: null, hold: null }),
      }),
    );
    expect(screen.queryByText(/أوشكت على الانتهاء/)).not.toBeInTheDocument();
  });

  it("almostUp: still reading extends and thanks with a toast", async () => {
    m.notes = [note()];
    m.stillReading.mockResolvedValue({ ok: true });
    const { user } = setup(holdingView({ canExtend: false }));
    await user.click(screen.getByRole("button", { name: "ما زلت أقرأ" }));
    expect(m.stillReading).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    expect(toast()).toHaveTextContent("أعطيناك وقتاً إضافياً. يسّر الله لك.");
  });

  it("the main card's still reading does the same", async () => {
    m.stillReading.mockResolvedValue({ ok: true });
    const { user } = setup(holdingView({ canExtend: true }));
    await user.click(screen.getByRole("button", { name: "ما زلت أقرأ" }));
    expect(m.stillReading).toHaveBeenCalledTimes(1);
    expect(toast()).toHaveTextContent("أعطيناك وقتاً إضافياً. يسّر الله لك.");
  });

  it.each([
    ["not_holding", t.actions.errors.notHolding],
    ["already_extended", t.actions.errors.stillReading.already_extended],
    ["opened", t.actions.errors.stillReading.opened],
    ["blocked", t.actions.errors.shared.blocked],
    ["rate_limited", t.actions.errors.shared.rate_limited],
    ["maintenance", t.actions.errors.shared.maintenance],
  ] as const)(
    "still reading failing with %s has its own copy",
    async (reason, copy) => {
      m.stillReading.mockResolvedValue({ ok: false, reason });
      const { user } = setup(holdingView());
      await user.click(screen.getByRole("button", { name: "ما زلت أقرأ" }));
      expect(toast()).toHaveTextContent(copy);
    },
  );

  it("almostUp: finished and can't finish use the usual flows", async () => {
    m.notes = [note()];
    m.finish.mockResolvedValue({ ok: true, undoUntil: NOW + 10_000 });
    const { user } = setup(holdingView({ canExtend: false }));
    const inNotes = within(
      screen.getByRole("region", { name: t.notes.heading }),
    );
    await user.click(inNotes.getByRole("button", { name: "أتممت القراءة" }));
    expect(m.finish).toHaveBeenCalledTimes(1);
    await user.click(inNotes.getByRole("button", { name: "لا أستطيع إكماله" }));
    expect(
      screen.getByRole("dialog", { name: "لا بأس، جزاك الله خيراً" }),
    ).toBeInTheDocument();
  });

  it("openForHelp card take opens the take sheet for the first still-open juz", async () => {
    m.notes = [note({ kind: "openForHelp", juz: [12, 15, 18] })];
    const { user } = setup(
      makeView({
        tiles: makeTiles({ 12: { state: "reading" }, 15: { state: "done" } }),
        me: signedIn({ suggestion: 3 }),
      }),
    );
    expect(
      screen.getByText(/^الأجزاء 12، 15 و18 متاحة لمن يساعد/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "خذ الجزء" }));
    expect(
      screen.getByRole("dialog", { name: "الجزء 18" }),
    ).toBeInTheDocument();
  });

  it("openForHelp card invite opens the invite sheet", async () => {
    m.notes = [note({ kind: "openForHelp", juz: [12] })];
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "أرسل الدعوة" }));
    expect(
      screen.getByRole("dialog", { name: t.share.inviteTitle }),
    ).toBeInTheDocument();
  });

  it("behind card take opens the take sheet for the suggestion", async () => {
    m.notes = [note({ kind: "behind", juz: [], count: 6 })];
    const { user } = setup(makeView({ me: signedIn({ suggestion: 7 }) }));
    const inNotes = within(
      screen.getByRole("region", { name: t.notes.heading }),
    );
    await user.click(inNotes.getByRole("button", { name: "خذ جزءاً" }));
    expect(screen.getByRole("dialog", { name: "الجزء 7" })).toBeInTheDocument();
  });

  it("ok dismisses the note", async () => {
    m.notes = [note({ kind: "thanks", juz: [9] })];
    m.dismiss.mockResolvedValue({ ok: true });
    const { user } = setup(makeView({ me: signedIn() }));
    await user.click(screen.getByRole("button", { name: "حسناً" }));
    expect(m.dismiss).toHaveBeenCalledWith({
      sessionToken: "tok",
      noteId: "n1",
    });
  });
});

describe("taken over", () => {
  it("finish taken_over shows the thanks toast without undo", async () => {
    m.finish.mockResolvedValue({ ok: false, reason: "taken_over" });
    const { user } = setup(
      makeView({ me: signedIn({ holding: 5, suggestion: null }) }),
    );
    await user.click(screen.getByRole("button", { name: "أتممتُ القراءة" }));
    expect(toast()).toHaveTextContent(
      "أحدهم يُكمل الجزء 5 الآن. جزاكما الله خيراً.",
    );
    expect(
      screen.queryByRole("button", { name: t.toast.undo }),
    ).not.toBeInTheDocument();
  });
});

describe("page switches and links", () => {
  it("members get the notifications switch with a visible state label", async () => {
    m.setNotifications.mockResolvedValue({ ok: true });
    const { user } = setup(
      makeView({ me: signedIn({ notificationsOn: true }) }),
      "/j/CODE?tab=group",
    );
    const sw = screen.getByRole("switch", { name: "إشعارات هذه الختمة" });
    expect(sw).toBeChecked();
    expect(sw).toHaveTextContent("مفعّلة");
    await user.click(sw);
    expect(m.setNotifications).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      on: false,
    });
  });

  it("the switch shows off, and turns on", async () => {
    m.setNotifications.mockResolvedValue({ ok: true });
    const { user } = setup(
      makeView({ me: signedIn({ notificationsOn: false }) }),
      "/j/CODE?tab=group",
    );
    const sw = screen.getByRole("switch", { name: "إشعارات هذه الختمة" });
    expect(sw).not.toBeChecked();
    expect(sw).toHaveTextContent("متوقفة");
    await user.click(sw);
    expect(m.setNotifications).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
      on: true,
    });
  });

  it("a failed switch toasts the generic error", async () => {
    m.setNotifications.mockResolvedValue({ ok: false });
    const { user } = setup(makeView({ me: signedIn() }), "/j/CODE?tab=group");
    await user.click(screen.getByRole("switch"));
    expect(toast()).toHaveTextContent(t.errors.generic);
  });

  it("visitors who are not members get no switch", () => {
    setup(
      makeView({ me: signedIn({ isMember: false, notificationsOn: null }) }),
    );
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("the organizer gets the settings link, others do not", () => {
    const { unmount } = setup(
      makeView({ isOrganizer: true, me: signedIn() }),
      "/j/CODE?tab=group",
    );
    expect(
      screen.getByRole("link", { name: "إعدادات الختمة" }),
    ).toHaveAttribute("href", "/j/CODE/settings");
    unmount();
    setup(
      makeView({ isOrganizer: false, me: signedIn() }),
      "/j/CODE?tab=group",
    );
    expect(
      screen.queryByRole("link", { name: "إعدادات الختمة" }),
    ).not.toBeInTheDocument();
  });
});

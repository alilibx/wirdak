import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { HomePage } from "./HomePage";

const m = vi.hoisted(() => ({
  me: undefined as unknown,
  mine: undefined as unknown,
  token: undefined as string | undefined,
  stored: null as string | null,
  clear: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => m.token,
  getSessionToken: () => m.stored,
  clearSessionToken: () => m.clear(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) => {
      const name = getFunctionName(ref);
      return name === "sessions:me" ? m.me : m.mine;
    },
  };
});

// The reply card has its own tests (features/help).
vi.mock("../features/help/HelpReplyCard", () => ({
  HelpReplyCard: () => null,
}));

vi.mock("../features/verify/VerifySheet", () => ({
  VerifySheet: (props: {
    title: string;
    intent?: unknown;
    onVerified: () => void;
    onClose: () => void;
  }) => (
    <div
      role="dialog"
      aria-label={props.title}
      data-intent={JSON.stringify(props.intent)}
    >
      <button
        onClick={() => {
          m.token = "fresh";
          m.stored = "fresh";
          m.me = { displayName: "أبو علي", maskedPhone: "+971 50 ••• 4567" };
          props.onVerified();
        }}
      >
        verified
      </button>
      <button onClick={props.onClose}>close</button>
    </div>
  ),
}));

const saveSignInProgress = () =>
  localStorage.setItem(
    "wirdak.verify",
    JSON.stringify({
      verificationId: "v1",
      secret: "sec",
      displayName: "أبو علي",
      expiresAt: Date.now() + 5 * 60_000,
      intent: { kind: "signin" },
    }),
  );

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

const card = (over: object = {}) => ({
  inviteCode: "AAA",
  name: "ختمة العائلة",
  createdAt: Date.UTC(2026, 9, 20, 12),
  schedule: "weekly",
  done: 12,
  holding: null,
  hasNote: false,
  peopleCount: null,
  ...over,
});

describe("HomePage", () => {
  beforeEach(() => {
    m.token = "tok";
    m.stored = "tok";
    m.clear.mockReset();
    m.me = { displayName: "أبو علي", maskedPhone: "x" };
    m.mine = [];
    localStorage.clear();
  });

  it("is not blank while loading", () => {
    m.me = undefined;
    m.mine = undefined;
    renderHome();
    expect(screen.getByText("جارٍ التحميل")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("greets the person and shows a card per khatma", () => {
    m.mine = [
      card({ holding: 14 }),
      card({ inviteCode: "BBB", name: null, done: 0, schedule: "none" }),
    ];
    renderHome();
    expect(screen.getByText("السلام عليكم، أبو علي")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /ختمة/ });
    const first = links.find((l) => l.getAttribute("href") === "/j/AAA")!;
    expect(first).toHaveTextContent("ختمة العائلة");
    expect(first).toHaveTextContent("١٢ من ٣٠ تمّت");
    expect(first).toHaveTextContent("أسبوعية");
    expect(first).toHaveTextContent("جزؤك: الجزء ١٤ «ربما»");
    expect(first).not.toHaveTextContent("·");
    const bar = within(first).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "12");
    expect(bar).toHaveAttribute("aria-valuemax", "30");
    expect(bar).toHaveAccessibleName("تمّ ١٢ من ٣٠ جزءاً");
    const second = links.find((l) => l.getAttribute("href") === "/j/BBB")!;
    expect(second).not.toHaveTextContent("جزؤك");
    expect(second).toHaveTextContent(/^ختمة .*أكتوبر/);
  });

  it("a rotating khatma's card says so, with today's count and no schedule", () => {
    m.mine = [card({ kind: "rota", done: 26, schedule: "none" })];
    renderHome();
    const link = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/j/AAA")!;
    expect(link).toHaveTextContent("ختمة بالتناوب، ٢٦ من ٣٠ اليوم");
    expect(link).not.toHaveTextContent("تمّت");
    expect(link).not.toHaveTextContent("جزؤك");
    expect(within(link).getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "26",
    );
  });

  it("an organizer's card shows how many people are in it; a member's shows none", () => {
    m.mine = [
      card({ peopleCount: 3 }),
      card({ inviteCode: "BBB", peopleCount: null }),
      card({ inviteCode: "CCC", peopleCount: 1 }),
      card({ inviteCode: "DDD", peopleCount: 2 }),
      card({ inviteCode: "EEE", peopleCount: 11 }),
    ];
    renderHome();
    const cardOf = (code: string) =>
      screen
        .getAllByRole("link")
        .find((l) => l.getAttribute("href") === `/j/${code}`)!;
    expect(cardOf("AAA")).toHaveTextContent(t.home.peopleCount(3));
    expect(t.home.peopleCount(3)).toBe("٣ أشخاص");
    expect(t.home.peopleCount(1)).toBe("شخص واحد");
    expect(t.home.peopleCount(2)).toBe("شخصان");
    expect(t.home.peopleCount(11)).toBe("١١ شخصاً");
    expect(cardOf("BBB")).not.toHaveTextContent(/شخص|أشخاص/);
    expect(cardOf("CCC")).toHaveTextContent("شخص واحد");
    expect(cardOf("EEE")).toHaveTextContent("١١ شخصاً");
  });

  it("home shows the new-message label", () => {
    m.mine = [
      card({ hasNote: true }),
      card({ inviteCode: "BBB", name: "ختمة الأصدقاء" }),
    ];
    renderHome();
    const withNote = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/j/AAA")!;
    const without = screen
      .getAllByRole("link")
      .find((l) => l.getAttribute("href") === "/j/BBB")!;
    expect(withNote).toHaveTextContent("رسالة جديدة");
    expect(without).not.toHaveTextContent("رسالة جديدة");
  });

  describe("archived khatmas", () => {
    const archivedSection = () =>
      screen.getByText(t.home.archived).closest("details") as HTMLElement;

    it("lists them below the active ones in a collapsed «المؤرشفة» section", () => {
      m.mine = [
        card({ archived: true, inviteCode: "OLD", name: "ختمة قديمة" }),
        card(),
      ];
      renderHome();
      const section = archivedSection();
      expect(section).not.toHaveAttribute("open");
      const old = within(section)
        .getAllByRole("link", { hidden: true })
        .find((l) => l.getAttribute("href") === "/j/OLD");
      expect(old).toHaveTextContent("ختمة قديمة");
      // The active khatma is outside it, and comes first.
      const active = screen
        .getAllByRole("link")
        .find((l) => l.getAttribute("href") === "/j/AAA")!;
      expect(section).not.toContainElement(active);
      expect(
        active.compareDocumentPosition(section) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("an archived card shows no note dot and no held juz'", () => {
      m.mine = [
        card({ archived: true, inviteCode: "OLD", hasNote: true, holding: 4 }),
      ];
      renderHome();
      const old = within(archivedSection())
        .getAllByRole("link", { hidden: true })
        .find((l) => l.getAttribute("href") === "/j/OLD")!;
      expect(old).not.toHaveTextContent("رسالة جديدة");
      expect(old).not.toHaveTextContent("جزؤك");
    });

    it("has no section when nothing is archived", () => {
      m.mine = [card()];
      renderHome();
      expect(screen.queryByText(t.home.archived)).toBeNull();
    });

    it("only archived khatmas: still the empty state and the plain create button", () => {
      m.mine = [card({ archived: true })];
      renderHome();
      expect(screen.getByText(/لا توجد ختمات بعد/)).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "ابدأ ختمة جديدة" }),
      ).toBeInTheDocument();
      expect(archivedSection()).toBeInTheDocument();
    });
  });

  it("links to create, and leaves settings to the bottom bar", () => {
    m.mine = [card()];
    renderHome();
    expect(
      screen.getByRole("link", { name: "＋ ابدأ ختمة جديدة" }),
    ).toHaveAttribute("href", "/new");
    expect(screen.queryByRole("link", { name: "إعداداتي" })).toBeNull();
  });

  it("signed in with no khatmas: a kind empty state plus the create button", () => {
    renderHome();
    expect(screen.getByText(/لا توجد ختمات بعد/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ابدأ ختمة جديدة" }),
    ).toHaveAttribute("href", "/new");
  });

  it("signed out: a short explanation and the create button, no settings", () => {
    m.token = undefined;
    m.me = null;
    m.mine = [];
    renderHome();
    expect(screen.getByText(/وِردك يجمع أحبابك/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "ابدأ ختمة جديدة" }),
    ).toHaveAttribute("href", "/new");
    expect(screen.queryByRole("link", { name: "إعداداتي" })).toBeNull();
    expect(screen.queryByText(/السلام عليكم، /)).toBeNull();
  });

  it("clears a stored token the server no longer knows, and shows signed out", () => {
    m.me = null;
    renderHome();
    expect(m.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/وِردك يجمع أحبابك/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "إعداداتي" })).toBeNull();
  });

  it("does not clear a token that was replaced meanwhile", () => {
    m.me = null;
    m.stored = "newer";
    renderHome();
    expect(m.clear).not.toHaveBeenCalled();
  });

  it("does not clear anything while loading or when signed in", () => {
    m.me = undefined;
    m.mine = undefined;
    renderHome();
    expect(m.clear).not.toHaveBeenCalled();
  });

  describe("signing in on a new phone", () => {
    beforeEach(() => {
      m.token = undefined;
      m.stored = null;
      m.me = null;
      m.mine = [];
    });

    it("offers a secondary sign-in button that opens verification, and stays here after", async () => {
      const user = userEvent.setup();
      const view = renderHome();
      expect(screen.queryByRole("dialog")).toBeNull();
      await user.click(screen.getByRole("button", { name: t.signIn.button }));
      const sheet = screen.getByRole("dialog", { name: t.signIn.title });
      expect(JSON.parse(sheet.dataset.intent ?? "null")).toEqual({
        kind: "signin",
      });
      m.mine = [card()];
      await user.click(screen.getByRole("button", { name: "verified" }));
      view.rerender(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByText("السلام عليكم، أبو علي")).toBeInTheDocument();
      expect(screen.getByText("ختمة العائلة")).toBeInTheDocument();
    });

    it("keeps the sheet open while the page reloads for the new session", async () => {
      const user = userEvent.setup();
      const view = renderHome();
      await user.click(screen.getByRole("button", { name: t.signIn.button }));
      m.token = "fresh";
      m.me = undefined;
      m.mine = undefined;
      view.rerender(
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>,
      );
      expect(
        screen.getByRole("dialog", { name: t.signIn.title }),
      ).toBeInTheDocument();
    });

    it("reopens the sign-in sheet after the tab reloads mid-verification", () => {
      saveSignInProgress();
      renderHome();
      expect(
        screen.getByRole("dialog", { name: t.signIn.title }),
      ).toBeInTheDocument();
    });

    it("sends an unfinished take or create back to its own page", () => {
      const landedOn = (intent: unknown, entries = ["/"]) => {
        localStorage.setItem(
          "wirdak.verify",
          JSON.stringify({
            verificationId: "v1",
            secret: "sec",
            displayName: "أبو علي",
            expiresAt: Date.now() + 5 * 60_000,
            intent,
          }),
        );
        const view = render(
          <MemoryRouter
            initialEntries={entries}
            initialIndex={entries.length - 1}
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="*" element={<Where />} />
            </Routes>
          </MemoryRouter>,
        );
        const path =
          screen.queryByTestId("where")?.textContent ?? "stayed home";
        view.unmount();
        return path;
      };
      const take = { kind: "take", inviteCode: "Ab-1_z", juz: 3 };
      // Choosing home inside the app (not its first page) stays home.
      expect(landedOn(take, ["/j/Ab-1_z", "/"])).toBe("stayed home");
      expect(landedOn(take)).toBe("/j/Ab-1_z");
      expect(
        landedOn({ kind: "create", name: "ختمة", schedule: "daily" }),
      ).toBe("/new");
    });

    it("is not offered when signed in", () => {
      m.token = "tok";
      m.me = { displayName: "أبو علي", maskedPhone: "x" };
      renderHome();
      expect(
        screen.queryByRole("button", { name: t.signIn.button }),
      ).toBeNull();
    });
  });
});

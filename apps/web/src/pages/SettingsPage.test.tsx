import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { SettingsPage } from "./SettingsPage";

const m = vi.hoisted(() => ({
  me: undefined as unknown,
  list: undefined as unknown,
  token: undefined as string | undefined,
  clear: vi.fn(),
  stored: null as string | null,
  stats: null as unknown,
  savedPeople: [] as unknown,
  thisDevice: false,
  support: "ready" as "ready" | "ios_install" | "unsupported",
  blocked: false,
  endpoint: null as string | null,
  enablePush: vi.fn(),
  dropSubscription: vi.fn(),
  fns: {
    updateDisplayName: vi.fn(),
    signOut: vi.fn(),
    signOutOne: vi.fn(),
    signOutOthers: vi.fn(),
    unsubscribe: vi.fn(),
    setWhatsappNotes: vi.fn(),
    removeSaved: vi.fn(),
  },
}));

vi.mock("../lib/push", () => ({
  pushSupport: () => m.support,
  pushBlocked: () => m.blocked,
  currentEndpoint: () => Promise.resolve(m.endpoint),
  enablePush: (token: string) => m.enablePush(token),
  dropSubscription: () => m.dropSubscription(),
}));
vi.mock("../components/InstallStepsSheet", () => ({
  InstallStepsSheet: (props: { onClose: () => void }) => (
    <div role="dialog" aria-label="install-steps">
      <button onClick={props.onClose}>close-install</button>
    </div>
  ),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => m.token,
  getSessionToken: () => m.stored,
  clearSessionToken: () => m.clear(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      const name = getFunctionName(ref);
      if (name === "sessions:me") return m.me;
      if (name === "people:myStats") return m.stats;
      if (name === "people:savedPeople") return m.savedPeople;
      if (name === "push:mine")
        return args === "skip" ? undefined : { thisDevice: m.thisDevice };
      return m.list;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] as
        | "updateDisplayName"
        | "signOut"
        | "signOutOne"
        | "signOutOthers"
        | "unsubscribe"
        | "setWhatsappNotes"
        | "removeSaved";
      return m.fns[name];
    },
  };
});

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

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route path="/" element={<p>home-page</p>} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("SettingsPage", () => {
  beforeEach(() => {
    Object.values(m.fns).forEach((f) => f.mockReset().mockResolvedValue(null));
    m.clear.mockReset();
    m.enablePush.mockReset().mockResolvedValue("granted");
    m.dropSubscription.mockReset().mockResolvedValue("https://push/e1");
    m.stats = { paceDays: null, juzRead: 0, weekStreak: null };
    m.savedPeople = [];
    m.thisDevice = false;
    m.support = "ready";
    m.blocked = false;
    m.endpoint = null;
    m.token = "tok";
    m.stored = "tok";
    m.me = {
      displayName: "أبو علي",
      maskedPhone: "+971 •• ••• 4567",
      whatsappNotes: false,
    };
    localStorage.clear();
    m.list = [
      {
        sessionId: "s1",
        deviceLabel: "iPhone · Safari",
        lastUsedAt: Date.UTC(2026, 9, 27, 12),
        isCurrent: true,
      },
      {
        sessionId: "s2",
        deviceLabel: "Windows · Chrome",
        lastUsedAt: Date.UTC(2026, 9, 20, 12),
        isCurrent: false,
      },
    ];
  });

  it("signed in: no top link home, the bottom bar has it", () => {
    renderPage();
    expect(screen.queryByRole("link", { name: "الصفحة الرئيسية" })).toBeNull();
  });

  it("turns WhatsApp messages on from their own switch, with what they'll get", async () => {
    renderPage();
    expect(screen.getByText(t.whatsappNotes.explain)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: t.whatsappNotes.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(m.fns.setWhatsappNotes).toHaveBeenCalledWith({
      sessionToken: "tok",
      on: true,
    });
  });

  it("shows WhatsApp messages on, and turns them off", async () => {
    m.me = { ...(m.me as object), whatsappNotes: true };
    renderPage();
    const toggle = screen.getByRole("switch", { name: t.whatsappNotes.label });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(m.fns.setWhatsappNotes).toHaveBeenCalledWith({
      sessionToken: "tok",
      on: false,
    });
  });

  it("shows the masked number left-to-right", () => {
    renderPage();
    const number = screen.getByText("+971 •• ••• 4567");
    expect(number).toHaveAttribute("dir", "ltr");
  });

  it("signed out: a sign-in prompt with a link home", () => {
    m.token = undefined;
    m.me = null;
    m.list = [];
    renderPage();
    expect(screen.getByText(/لا يوجد حساب مسجّل/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "الصفحة الرئيسية" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("saves the display name", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("اسمك");
    expect(input).toHaveValue("أبو علي");
    await user.clear(input);
    await user.type(input, "  أم سلمى ");
    await user.click(screen.getByRole("button", { name: "احفظ الاسم" }));
    expect(m.fns.updateDisplayName).toHaveBeenCalledWith({
      sessionToken: "tok",
      displayName: "أم سلمى",
    });
    expect(await screen.findByText("تمّ حفظ الاسم")).toBeInTheDocument();
  });

  it("shows invalid_name kindly", async () => {
    m.fns.updateDisplayName.mockRejectedValue(
      new ConvexError({ code: "invalid_name" }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "احفظ الاسم" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "لم نستطع قبول هذا الاسم",
    );
  });

  it.each(["maintenance", "rate_limited"] as const)(
    "shows %s kindly, not as a network failure",
    async (code) => {
      m.fns.updateDisplayName.mockRejectedValue(new ConvexError({ code }));
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("button", { name: "احفظ الاسم" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(t.settings.errors[code]);
      expect(alert).not.toHaveTextContent(t.errors.network);
      expect(alert).not.toHaveTextContent(t.errors.generic);
    },
  );

  it("lists devices, marking this one", () => {
    renderPage();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("iPhone · Safari");
    expect(items[0]).toHaveTextContent("هذا الجهاز");
    expect(items[0]).toHaveTextContent(/آخر استخدام: /);
    expect(items[1]).toHaveTextContent("Windows · Chrome");
    expect(items[1]).not.toHaveTextContent("هذا الجهاز");
    expect(screen.getAllByRole("button", { name: /^تسجيل خروج/ })).toHaveLength(
      2,
    );
  });

  it("signs out another device by its id", async () => {
    const user = userEvent.setup();
    renderPage();
    const other = screen.getAllByRole("listitem")[1]!;
    await user.click(within(other).getByRole("button", { name: /تسجيل خروج/ }));
    expect(m.fns.signOutOne).toHaveBeenCalledWith({
      sessionToken: "tok",
      sessionId: "s2",
    });
    expect(m.clear).not.toHaveBeenCalled();
  });

  it("signing out this device clears the token and goes home", async () => {
    const user = userEvent.setup();
    renderPage();
    const current = screen.getAllByRole("listitem")[0]!;
    await user.click(
      within(current).getByRole("button", { name: /تسجيل خروج/ }),
    );
    expect(m.fns.signOut).toHaveBeenCalledWith({ sessionToken: "tok" });
    expect(m.fns.signOutOne).not.toHaveBeenCalled();
    expect(m.clear).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("home-page")).toBeInTheDocument();
  });

  it("settings lists devices and signs out others", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole("button", {
        name: "تسجيل الخروج من كل الأجهزة الأخرى",
      }),
    );
    expect(m.fns.signOutOthers).toHaveBeenCalledWith({ sessionToken: "tok" });
    expect(
      await screen.findByText("سجّلنا خروج الأجهزة الأخرى."),
    ).toBeInTheDocument();
  });

  it("does not clear the token when signing out this device fails", async () => {
    m.fns.signOut.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPage();
    await user.click(
      within(screen.getAllByRole("listitem")[0]!).getByRole("button", {
        name: /تسجيل خروج/,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال");
    expect(m.clear).not.toHaveBeenCalled();
  });

  it("clears a stored token the server no longer knows, and shows signed out", () => {
    m.me = null;
    m.list = [];
    renderPage();
    expect(m.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/لا يوجد حساب مسجّل/)).toBeInTheDocument();
  });

  it("shows the trimmed name after saving", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("اسمك");
    await user.clear(input);
    await user.type(input, "  أم سلمى  ");
    await user.click(screen.getByRole("button", { name: "احفظ الاسم" }));
    await screen.findByText("تمّ حفظ الاسم");
    expect(input).toHaveValue("أم سلمى");
  });

  describe("my numbers", () => {
    it("numbers block hides pace and streak when null", () => {
      m.stats = { paceDays: null, juzRead: 4, weekStreak: null };
      renderPage();
      const block = screen.getByRole("region", { name: t.settings.numbers });
      expect(block).toHaveTextContent("قرأتَ 4 أجزاء");
      expect(block).not.toHaveTextContent("عادةً تُتمّ الجزء");
      expect(block).not.toHaveTextContent("متتالية");
    });

    it("shows pace and streak when known", () => {
      m.stats = { paceDays: 3, juzRead: 12, weekStreak: 5 };
      renderPage();
      const block = screen.getByRole("region", { name: t.settings.numbers });
      expect(block).toHaveTextContent("قرأتَ 12 جزءاً");
      expect(block).toHaveTextContent(t.card.pace(3));
      expect(block).toHaveTextContent("5 أسابيع متتالية تقرأ فيها");
    });

    it.each([
      [1, "قرأتَ جزءاً واحداً"],
      [2, "قرأتَ جزأين"],
      [10, "قرأتَ 10 أجزاء"],
      [11, "قرأتَ 11 جزءاً"],
    ])("agrees the juz' count for %s", (juzRead, text) => {
      m.stats = { paceDays: null, juzRead, weekStreak: null };
      renderPage();
      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it.each([
      [2, "أسبوعين متتاليين تقرأ فيهما"],
      [3, "3 أسابيع متتالية تقرأ فيها"],
      [11, "11 أسبوعاً متتالياً تقرأ فيه"],
    ])("agrees the streak for %s weeks", (weekStreak, text) => {
      m.stats = { paceDays: null, juzRead: 5, weekStreak };
      renderPage();
      expect(screen.getByText(text)).toBeInTheDocument();
    });

    it("says nothing is finished yet at zero", () => {
      renderPage();
      expect(screen.getByText("لم تُتمّ جزءاً بعد")).toBeInTheDocument();
      expect(screen.queryByText(/قرأتَ/)).toBeNull();
    });

    it("shows no numbers block while loading or signed out", () => {
      m.stats = undefined;
      renderPage();
      expect(
        screen.queryByRole("region", { name: t.settings.numbers }),
      ).toBeNull();
    });
  });

  describe("my participants", () => {
    beforeEach(() => {
      m.savedPeople = [
        { id: "c1", name: "أم خالد", phone: "+971501234567" },
        { id: "c2", name: "سعد", phone: null },
      ];
    });

    it("lists each saved person with their number, or that it is hidden", () => {
      renderPage();
      const section = screen.getByRole("region", {
        name: t.settings.savedHeading,
      });
      const items = within(section).getAllByRole("listitem");
      expect(items).toHaveLength(2);
      expect(
        within(items[0] as HTMLElement).getByText("أم خالد"),
      ).toBeInTheDocument();
      expect(
        within(items[0] as HTMLElement).getByText("+971501234567"),
      ).toHaveAttribute("dir", "ltr");
      expect(
        within(items[1] as HTMLElement).getByText(t.settings.savedHidden),
      ).toBeInTheDocument();
      expect(within(items[1] as HTMLElement).queryByText(/\+971/)).toBeNull();
    });

    it("has no section while the list is empty or loading", () => {
      m.savedPeople = [];
      const { unmount } = renderPage();
      expect(screen.queryByText(t.settings.savedHeading)).toBeNull();
      unmount();
      m.savedPeople = undefined;
      renderPage();
      expect(screen.queryByText(t.settings.savedHeading)).toBeNull();
    });

    it("asks before deleting, and deletes nothing if the answer is no", async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(
        screen.getByRole("button", {
          name: t.settings.savedRemoveLabel("أم خالد"),
        }),
      );
      const confirm = screen.getByRole("dialog", {
        name: t.settings.savedRemoveTitle("أم خالد"),
      });
      expect(
        within(confirm).getByText(t.settings.savedRemoveBody),
      ).toBeInTheDocument();
      expect(m.fns.removeSaved).not.toHaveBeenCalled();
      await user.click(
        within(confirm).getByRole("button", {
          name: t.settings.savedRemoveCancel,
        }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(m.fns.removeSaved).not.toHaveBeenCalled();
    });

    it("deletes the one confirmed", async () => {
      const user = userEvent.setup();
      m.fns.removeSaved?.mockResolvedValue({ ok: true });
      renderPage();
      await user.click(
        screen.getByRole("button", {
          name: t.settings.savedRemoveLabel("سعد"),
        }),
      );
      await user.click(
        screen.getByRole("button", { name: t.settings.savedRemoveConfirm }),
      );
      expect(m.fns.removeSaved).toHaveBeenCalledWith({
        sessionToken: "tok",
        contactId: "c2",
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("a refusal stays in the sheet in plain words", async () => {
      const user = userEvent.setup();
      m.fns.removeSaved?.mockResolvedValue({ error: "not_found" });
      renderPage();
      await user.click(
        screen.getByRole("button", {
          name: t.settings.savedRemoveLabel("سعد"),
        }),
      );
      await user.click(
        screen.getByRole("button", { name: t.settings.savedRemoveConfirm }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.settings.savedErrors.not_found ?? "",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("notifications on this device", () => {
    const section = () =>
      screen.getByRole("region", { name: t.settings.pushHeading });

    it("push section per support state", async () => {
      m.support = "unsupported";
      const view = renderPage();
      expect(section()).toHaveTextContent("هذا المتصفح لا يدعم الإشعارات.");
      expect(within(section()).queryByRole("button")).toBeNull();
      view.unmount();

      m.support = "ios_install";
      const user = userEvent.setup();
      renderPage();
      expect(screen.queryByRole("dialog")).toBeNull();
      await user.click(
        within(section()).getByRole("button", { name: t.settings.pushInstall }),
      );
      expect(
        screen.getByRole("dialog", { name: "install-steps" }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "close-install" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("ready and off: a switch that turns notifications on", async () => {
      const user = userEvent.setup();
      renderPage();
      const sw = await within(section()).findByRole("switch");
      expect(sw).toHaveAttribute("aria-checked", "false");
      expect(sw).toHaveTextContent(t.khatmaSettings.off);
      await user.click(sw);
      expect(m.enablePush).toHaveBeenCalledWith("tok");
    });

    it("on: a switch that unsubscribes this browser and the server", async () => {
      m.endpoint = "https://push/e1";
      m.thisDevice = true;
      const user = userEvent.setup();
      renderPage();
      const sw = await within(section()).findByRole("switch");
      await vi.waitFor(() =>
        expect(sw).toHaveAttribute("aria-checked", "true"),
      );
      expect(sw).toHaveTextContent(t.khatmaSettings.on);
      await user.click(sw);
      expect(m.dropSubscription).toHaveBeenCalledTimes(1);
      expect(m.fns.unsubscribe).toHaveBeenCalledWith({
        sessionToken: "tok",
        endpoint: "https://push/e1",
      });
      await vi.waitFor(() =>
        expect(sw).toHaveAttribute("aria-checked", "false"),
      );
    });

    it("a browser subscription the server does not know reads as off", async () => {
      m.endpoint = "https://push/e1";
      m.thisDevice = false;
      renderPage();
      const sw = await within(section()).findByRole("switch");
      expect(sw).toHaveAttribute("aria-checked", "false");
    });

    it("blocked in the browser: a plain line and no switch", async () => {
      m.blocked = true;
      renderPage();
      expect(section()).toHaveTextContent(t.settings.pushBlocked);
      expect(within(section()).queryByRole("switch")).toBeNull();
      expect(within(section()).queryByRole("button")).toBeNull();
    });

    it("denying the permission shows the blocked line", async () => {
      m.enablePush.mockResolvedValue("denied");
      const user = userEvent.setup();
      renderPage();
      await user.click(await within(section()).findByRole("switch"));
      expect(
        await within(section()).findByText(t.settings.pushBlocked),
      ).toBeInTheDocument();
    });

    it("a failed switch shows a network line and keeps the state", async () => {
      m.enablePush.mockRejectedValue(new Error("offline"));
      const user = userEvent.setup();
      renderPage();
      const sw = await within(section()).findByRole("switch");
      await user.click(sw);
      expect(await within(section()).findByRole("alert")).toHaveTextContent(
        t.errors.network,
      );
      expect(sw).toHaveAttribute("aria-checked", "false");
    });
  });

  describe("signing in on a new phone", () => {
    beforeEach(() => {
      m.token = undefined;
      m.stored = null;
      m.me = null;
      m.list = [];
    });

    it("offers a secondary sign-in button that opens verification, and stays here after", async () => {
      const user = userEvent.setup();
      const view = renderPage();
      await user.click(screen.getByRole("button", { name: t.signIn.button }));
      const sheet = screen.getByRole("dialog", { name: t.signIn.title });
      expect(JSON.parse(sheet.dataset.intent ?? "null")).toEqual({
        kind: "signin",
      });
      await user.click(screen.getByRole("button", { name: "verified" }));
      view.rerender(
        <MemoryRouter initialEntries={["/settings"]}>
          <Routes>
            <Route path="/" element={<p>home-page</p>} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByRole("textbox")).toHaveValue("أبو علي");
      expect(screen.queryByText("home-page")).toBeNull();
    });

    it("reopens the sign-in sheet after the tab reloads mid-verification", () => {
      saveSignInProgress();
      renderPage();
      expect(
        screen.getByRole("dialog", { name: t.signIn.title }),
      ).toBeInTheDocument();
    });
  });
});

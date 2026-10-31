import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminErrorBoundary, App } from "./App";
import { t } from "./i18n/ar";

const m = vi.hoisted(() => ({
  me: undefined as unknown,
  token: "admin-token" as string | null,
  clear: vi.fn(),
  signOut: vi.fn(),
  alertSignOut: vi.fn(),
}));

vi.mock("./lib/adminSession", () => ({
  useAdminToken: () => m.token,
  clearAdminToken: () => m.clear(),
  setAdminToken: vi.fn(),
  getAdminToken: () => m.token,
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) =>
      getFunctionName(ref) === "adminAuth:me" ? m.me : undefined,
    useMutation: (ref: never) =>
      getFunctionName(ref) === "adminAuth:signOut" ? m.signOut : m.alertSignOut,
    useAction: () => vi.fn(),
  };
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.me = undefined;
  m.token = "admin-token";
  m.clear.mockReset();
  m.signOut.mockReset().mockResolvedValue(null);
  m.alertSignOut.mockReset().mockResolvedValue({ ok: true });
});

describe("App", () => {
  it("shows sign-in on every route when there's no admin", () => {
    m.me = null;
    renderAt("/settings");
    expect(
      screen.getByRole("heading", { name: t.signIn.title }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: t.nav.settings }),
    ).not.toBeInTheDocument();
  });

  it("shows the four sections to a signed-in admin", () => {
    m.me = { adminId: "a1", phone: "+971500000001", expiresAt: 0 };
    renderAt("/");
    for (const name of [
      t.nav.home,
      t.nav.people,
      t.nav.khatmas,
      t.nav.settings,
      t.nav.audit,
      t.nav.admins,
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByText(t.badge)).toBeInTheDocument();
  });

  it("renders nothing while it checks the session", () => {
    const { container } = renderAt("/");
    expect(container).toBeEmptyDOMElement();
  });

  it("serves the alert sign-out link even when signed out", async () => {
    m.me = null;
    renderAt("/signout?t=abc");
    expect(await screen.findByText(t.signOut.done)).toBeInTheDocument();
    expect(m.alertSignOut).toHaveBeenCalledWith({ alertToken: "abc" });
  });

  it("signs out from the header", async () => {
    m.me = {
      adminId: "a1",
      phone: "+971500000001",
      expiresAt: Date.now() + 60_000,
    };
    renderAt("/");
    await userEvent.click(
      screen.getByRole("button", { name: t.signOut.button }),
    );
    expect(m.signOut).toHaveBeenCalledWith({ adminToken: "admin-token" });
    expect(m.clear).toHaveBeenCalled();
  });

  it("drops the token when the 12 hours run out", () => {
    vi.useFakeTimers();
    try {
      m.me = {
        adminId: "a1",
        phone: "+971500000001",
        expiresAt: Date.now() + 5_000,
      };
      renderAt("/");
      expect(m.clear).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(5_000));
      expect(m.clear).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops the token when a page says the session is gone", () => {
    m.me = {
      adminId: "a1",
      phone: "+971500000001",
      expiresAt: Date.now() + 60_000,
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Boom(): never {
      throw new ConvexError({ code: "not_admin" });
    }
    render(
      <MemoryRouter>
        <AdminErrorBoundary>
          <Boom />
        </AdminErrorBoundary>
      </MemoryRouter>,
    );
    expect(m.clear).toHaveBeenCalled();
  });
});

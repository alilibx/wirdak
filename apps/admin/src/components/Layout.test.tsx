import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { Layout } from "./Layout";

const m = vi.hoisted(() => ({ open: 0 }));

vi.mock("convex/react", () => ({
  useQuery: () => ({ open: m.open }),
}));
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "token" }));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout actions={<button>خروج</button>} />}>
          <Route path="*" element={<p>الصفحة</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function setPhone() {
  vi.stubGlobal("innerWidth", 375);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe("Layout", () => {
  beforeEach(() => {
    m.open = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links to every page", () => {
    renderAt("/");
    for (const label of Object.values(t.nav)) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("renders the page and the actions", () => {
    renderAt("/");
    expect(screen.getByText("الصفحة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "خروج" })).toBeInTheDocument();
  });

  it("marks the current page", () => {
    renderAt("/audit");
    expect(screen.getByRole("link", { name: t.nav.audit })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks help on a help request's own page", () => {
    renderAt("/help/abc");
    expect(screen.getByRole("link", { name: t.nav.help })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("shows the open help count", () => {
    m.open = 7;
    renderAt("/");
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("caps a large help count", () => {
    m.open = 100;
    renderAt("/");
    expect(screen.getByText(t.help.manyOpen)).toBeInTheDocument();
  });

  it("hides the count when nothing is open", () => {
    renderAt("/");
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  describe("on a phone", () => {
    beforeEach(setPhone);

    it("shows four tabs and more", () => {
      renderAt("/");
      const bar = screen.getByRole("navigation", { name: t.shell.navLabel });
      expect(within(bar).getAllByRole("link")).toHaveLength(4);
      expect(
        within(bar).getByRole("button", { name: t.shell.more }),
      ).toBeInTheDocument();
    });

    it("stays under the sheets the rota pages open", () => {
      renderAt("/");
      // The website's Sheet is z-20 and keeps its bottom edge over this bar.
      expect(
        screen.getByRole("navigation", { name: t.shell.navLabel }),
      ).toHaveClass("z-10");
    });

    it("marks more as active for a page behind it", () => {
      renderAt("/audit");
      expect(
        screen.getByRole("button", { name: t.shell.more }),
      ).toHaveAttribute("data-active", "true");
    });

    it("doesn't mark more on a page with its own tab", () => {
      renderAt("/help");
      expect(
        screen.getByRole("button", { name: t.shell.more }),
      ).toHaveAttribute("data-active", "false");
    });

    it("caps a large help count in the bar", () => {
      m.open = 100;
      renderAt("/");
      const bar = screen.getByRole("navigation", { name: t.shell.navLabel });
      expect(within(bar).getByText(t.help.manyOpen)).toBeInTheDocument();
    });
  });
});

describe("Layout landmarks", () => {
  it("has one main region", () => {
    renderAt("/");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { HomePage } from "./HomePage";

const m = vi.hoisted(() => ({
  overview: undefined as unknown,
  trendArgs: [] as unknown[],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never, args: unknown) => {
      const name = getFunctionName(ref);
      if (name === "adminStats:overview") return m.overview;
      if (name === "adminStats:trend") {
        m.trendArgs.push(args);
        return [{ day: 1, value: 4 }];
      }
      return undefined;
    },
    useMutation: () => vi.fn(),
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));
vi.mock("../components/AdminPushCard", () => ({ AdminPushCard: () => null }));

const base = {
  activeKhatmas: 104,
  activeKhatmasWeekAgo: 92,
  members: 1038,
  membersNewThisWeek: 140,
  ajzaToday: 214,
  ajzaAvg7: 190,
  completedThisWeek: 3,
  rotaDaysCompletedThisWeek: 17,
  stalledKhatmas: 5,
  stalledCapped: false,
  daysPerRoundMedian: 4,
  signInSuccess7: 0.92,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.overview = base;
  m.trendArgs = [];
});

describe("dashboard", () => {
  it("links setting a rotating khatma up for someone", () => {
    renderPage();
    expect(screen.getByRole("link", { name: t.rota.create })).toHaveAttribute(
      "href",
      "/rota/new",
    );
  });

  it("shows the six tiles in Western digits", () => {
    renderPage();
    for (const text of ["104", "1,038", "214", "3", "5", "4 أيام", "92٪"]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(t.stats.newThisWeek("140"))).toBeInTheDocument();
  });

  it("counts the rotating khatma days completed this week", () => {
    renderPage();
    const tile = screen.getByText(t.stats.rotaDaysCompleted).parentElement!;
    expect(within(tile).getByText("17")).toBeInTheDocument();
    expect(within(tile).getByText(t.stats.thisWeek)).toBeInTheDocument();
  });

  it("warns when sign-in success drops below 80%", () => {
    m.overview = { ...base, signInSuccess7: 0.7 };
    renderPage();
    expect(screen.getByTestId("signin-card")).toHaveAttribute(
      "data-tone",
      "warn",
    );
  });

  it("shows a dash without any completed round", () => {
    m.overview = { ...base, daysPerRoundMedian: null };
    renderPage();
    expect(screen.getAllByText(t.stats.none).length).toBeGreaterThan(0);
  });

  it("switches the chart's period and metric", async () => {
    renderPage();
    expect(m.trendArgs.at(-1)).toEqual({
      adminToken: "tok",
      metric: "ajzaFinished",
      days: 30,
    });
    await userEvent.click(
      screen.getByRole("radio", { name: t.stats.periods[365] }),
    );
    await userEvent.selectOptions(
      screen.getByLabelText(t.stats.metric),
      "newMembers",
    );
    expect(m.trendArgs.at(-1)).toEqual({
      adminToken: "tok",
      metric: "newMembers",
      days: 365,
    });
  });
});

describe("days per round", () => {
  it("shows days with one decimal, never hours", () => {
    m.overview = { ...base, daysPerRoundMedian: 29.4 };
    renderPage();
    expect(screen.getByText("29.4 يوم")).toBeInTheDocument();
    expect(screen.queryByText(/ساعة/)).not.toBeInTheDocument();
  });
});

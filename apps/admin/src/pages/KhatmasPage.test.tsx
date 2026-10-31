import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { KhatmasPage } from "./KhatmasPage";

type Call = { name: string; args: Record<string, unknown> };

const m = vi.hoisted(() => ({
  rows: [] as unknown[],
  status: "Exhausted" as string,
  loadMore: vi.fn(),
  calls: [] as unknown[],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    usePaginatedQuery: (ref: never, args: unknown) => {
      m.calls.push({ name: getFunctionName(ref), args });
      return { results: m.rows, status: m.status, loadMore: m.loadMore };
    },
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

const pool = {
  khatmaId: "k1",
  name: "ختمة العائلة",
  kind: "pool",
  status: "active",
  organizer: { personId: "p1", displayName: "سارة" },
  memberCount: 7,
  today: null,
  completed: 4,
  createdAt: Date.UTC(2026, 9, 1),
};
const rota = {
  ...pool,
  khatmaId: "k2",
  name: null,
  kind: "rota",
  status: "paused",
  organizer: null,
  memberCount: 30,
  today: { done: 12, total: 30 },
  completed: 9,
};

const last = () => m.calls.at(-1) as Call;

function renderPage(url = "/khatmas") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <KhatmasPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.rows = [pool, rota];
  m.status = "Exhausted";
  m.loadMore.mockReset();
  m.calls = [];
});

describe("KhatmasPage", () => {
  it("lists khatmas, newest first", () => {
    renderPage();
    expect(last()).toMatchObject({
      name: "adminLists:khatmas",
      args: { adminToken: "tok", sort: "created", order: "desc" },
    });
    expect(last().args).not.toHaveProperty("kind");
    expect(last().args).not.toHaveProperty("status");
  });

  it("shows kind, status, organizer, members and completions", () => {
    renderPage();
    const row = screen
      .getByRole("link", { name: "ختمة العائلة" })
      .closest("tr")!;
    expect(
      within(row).getByRole("link", { name: "ختمة العائلة" }),
    ).toHaveAttribute("href", "/khatmas/k1");
    expect(within(row).getByText(t.khatmas.kinds.pool)).toBeInTheDocument();
    expect(
      within(row).getByText(t.khatmas.statuses.active),
    ).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "سارة" })).toHaveAttribute(
      "href",
      "/people/p1",
    );
    expect(within(row).getByText("٧")).toBeInTheDocument();
    expect(within(row).getByText("٤")).toBeInTheDocument();
  });

  it("shows today's progress for a rota khatma, and a name for an unnamed one", () => {
    renderPage();
    const row = screen
      .getByRole("link", { name: t.lookup.unnamed })
      .closest("tr")!;
    expect(within(row).getByText("١٢ / ٣٠")).toBeInTheDocument();
    expect(
      within(row).getByText(t.khatmas.statuses.paused),
    ).toBeInTheDocument();
  });

  it("filters by kind and by status", async () => {
    renderPage();
    await userEvent.selectOptions(
      screen.getByLabelText(t.khatmas.kind),
      "rota",
    );
    expect(last().args).toMatchObject({ kind: "rota" });
    await userEvent.selectOptions(
      screen.getByLabelText(t.khatmas.status),
      "pendingJoin",
    );
    expect(last().args).toMatchObject({ kind: "rota", status: "pendingJoin" });
  });

  it("reads its filters from the URL", () => {
    renderPage("/khatmas?kind=pool&status=archived&sort=name");
    expect(last().args).toMatchObject({
      kind: "pool",
      status: "archived",
      sort: "name",
      order: "asc",
    });
  });

  it("ignores a filter value it doesn't know", () => {
    renderPage("/khatmas?kind=nope&status=nope");
    expect(last().args).not.toHaveProperty("kind");
    expect(last().args).not.toHaveProperty("status");
  });

  it("sorts by name and created only", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.lists.name }));
    expect(last().args).toMatchObject({ sort: "name", order: "asc" });
    const headers = screen.getAllByRole("columnheader");
    for (const name of [
      t.khatmas.members,
      t.khatmas.completed,
      t.khatmas.today,
    ]) {
      const header = headers.find((h) => h.textContent === name)!;
      expect(within(header).queryByRole("button")).not.toBeInTheDocument();
    }
  });

  it("searches names a moment after typing", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(t.lists.searchLabel), "الأحبة");
    await waitFor(() =>
      expect(last().args).toMatchObject({ search: "الأحبة" }),
    );
  });

  it("loads more", async () => {
    m.status = "CanLoadMore";
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.lists.more }));
    expect(m.loadMore).toHaveBeenCalledWith(50);
  });
});

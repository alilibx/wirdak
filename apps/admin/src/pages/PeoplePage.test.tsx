import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { PeoplePage } from "./PeoplePage";

type Call = { name: string; args: Record<string, unknown> };

const m = vi.hoisted(() => ({
  rows: {} as Record<string, unknown[]>,
  status: "Exhausted" as string,
  loadMore: vi.fn(),
  calls: [] as unknown[],
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    usePaginatedQuery: (ref: never, args: unknown, opts: unknown) => {
      const name = getFunctionName(ref);
      m.calls.push({ name, args, opts });
      return {
        results: m.rows[name] ?? [],
        status: m.status,
        loadMore: m.loadMore,
      };
    },
    useQuery: () => undefined,
    useConvex: () => ({ query: vi.fn() }),
    useMutation: () => vi.fn(),
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

const person = {
  personId: "p1",
  displayName: "سارة",
  phoneMasked: "+971 50 ••• 4567",
  status: "active",
  rotaAllowed: false,
  organizesCount: 2,
  memberOfCount: 3,
  lastSeenAt: Date.UTC(2026, 9, 1),
  verifiedAt: Date.UTC(2026, 8, 1),
  createdAt: Date.UTC(2026, 8, 1),
};

const last = () => m.calls.at(-1) as Call;

function renderPage(url = "/people") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <PeoplePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.rows = { "adminLists:people": [person] };
  m.status = "Exhausted";
  m.loadMore.mockReset();
  m.calls = [];
});

describe("PeoplePage", () => {
  it("lists everyone, newest first, with a link and a masked number", () => {
    renderPage();
    expect(last()).toMatchObject({
      name: "adminLists:people",
      args: { adminToken: "tok", sort: "created", order: "desc" },
    });
    expect(last().args).not.toHaveProperty("tab");
    expect(screen.getByRole("link", { name: "سارة" })).toHaveAttribute(
      "href",
      "/people/p1",
    );
    expect(screen.getByText("+971 50 ••• 4567")).toBeInTheDocument();
    expect(screen.getByText("٢")).toBeInTheDocument();
    expect(screen.getByText("٣")).toBeInTheDocument();
  });

  it("names a status, and someone who never signed in", () => {
    m.rows["adminLists:people"] = [
      {
        ...person,
        status: "notJoined",
        lastSeenAt: 0,
        verifiedAt: 0,
      },
    ];
    renderPage();
    expect(screen.getByText(t.people.statuses.notJoined)).toBeInTheDocument();
    expect(screen.getByText(t.lookup.neverSeen)).toBeInTheDocument();
  });

  it("pages through a tab of people", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("tab", { name: t.people.tabs.members }),
    );
    expect(last()).toMatchObject({
      name: "adminLists:people",
      args: { tab: "members" },
    });
    await userEvent.click(
      screen.getByRole("tab", { name: t.people.tabs.noKhatma }),
    );
    expect(last().args).toMatchObject({ tab: "noKhatma" });
  });

  it("opens the tab in the URL", () => {
    renderPage("/people?tab=readers");
    expect(last().name).toBe("adminLists:readers");
    expect(
      screen.getByRole("tab", { name: t.people.tabs.readers }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("falls back to everyone for a tab it doesn't know", () => {
    renderPage("/people?tab=nope");
    expect(last().name).toBe("adminLists:people");
  });

  it("sorts by name, last seen, joined and created, and turns round", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.lists.name }));
    expect(last().args).toMatchObject({ sort: "name", order: "asc" });
    await userEvent.click(screen.getByRole("button", { name: t.lists.name }));
    expect(last().args).toMatchObject({ sort: "name", order: "desc" });
    await userEvent.click(
      screen.getByRole("button", { name: t.lookup.lastSeen }),
    );
    expect(last().args).toMatchObject({ sort: "lastSeen", order: "desc" });
    await userEvent.click(
      screen.getByRole("button", { name: t.lookup.joined }),
    );
    expect(last().args).toMatchObject({ sort: "joined", order: "desc" });
    expect(
      screen.getByRole("columnheader", { name: t.lookup.joined }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("offers no way to sort by a count", () => {
    renderPage();
    const headers = screen.getAllByRole("columnheader");
    for (const name of [t.people.organizes, t.people.memberOf]) {
      const header = headers.find((h) => h.textContent === name)!;
      expect(within(header).queryByRole("button")).not.toBeInTheDocument();
    }
  });

  it("has no sort controls during a search, which comes back by relevance", () => {
    renderPage("/people?q=سارة");
    expect(
      screen.queryByRole("button", { name: t.lists.name }),
    ).not.toBeInTheDocument();
  });

  it("searches names a moment after typing", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(t.lists.searchLabel), "فايزة");
    await waitFor(() => expect(last().args).toMatchObject({ search: "فايزة" }));
  });

  it("clears the box when the sidebar link clears the search", async () => {
    render(
      <MemoryRouter initialEntries={["/people?q=سارة"]}>
        <Link to="/people">nav</Link>
        <PeoplePage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("link", { name: "nav" }));
    expect(screen.getByLabelText(t.lists.searchLabel)).toHaveValue("");
    await new Promise((done) => setTimeout(done, 350));
    expect(last().args).not.toHaveProperty("search");
  });

  it("loads more, and says when nothing matches", async () => {
    m.status = "CanLoadMore";
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.lists.more }));
    expect(m.loadMore).toHaveBeenCalledWith(50);
    unmount();

    m.rows = {};
    m.status = "Exhausted";
    renderPage();
    expect(screen.getByText(t.lists.empty)).toBeInTheDocument();
  });

  it("switches to the blocked list, which says who has no account", async () => {
    m.rows["adminLists:blocked"] = [
      {
        blockedId: "b1",
        phoneMasked: "+971 50 ••• 8877",
        at: Date.UTC(2026, 9, 1),
        note: "إزعاج",
        person: null,
      },
      {
        blockedId: "b2",
        phoneMasked: "+971 50 ••• 1111",
        at: Date.UTC(2026, 9, 2),
        note: null,
        person: { personId: "p2", displayName: "ليلى" },
      },
    ];
    renderPage();
    await userEvent.click(
      screen.getByRole("checkbox", { name: t.people.blockedOnly }),
    );
    expect(last().name).toBe("adminLists:blocked");
    expect(screen.getByText(t.people.noAccount)).toBeInTheDocument();
    expect(screen.getByText("إزعاج")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ليلى" })).toHaveAttribute(
      "href",
      "/people/p2",
    );
  });

  it("has no blocked filter on the other tabs", () => {
    renderPage("/people?tab=members");
    expect(
      screen.queryByRole("checkbox", { name: t.people.blockedOnly }),
    ).not.toBeInTheDocument();
  });

  it("lists readers with their khatmas, and no number where it's hidden", () => {
    m.rows["adminLists:readers"] = [
      {
        readerId: "r1",
        name: "زهرة",
        phoneMasked: "+971 50 ••• 0002",
        khatmaCount: 1,
        khatmas: [{ khatmaId: "k1", name: "الأولى" }],
        lastReplyAt: null,
        createdAt: 0,
        blocked: false,
      },
      {
        readerId: "r2",
        name: "مخفي",
        phoneMasked: null,
        khatmaCount: 1,
        khatmas: [{ khatmaId: "k1", name: null }],
        lastReplyAt: Date.UTC(2026, 9, 1),
        createdAt: 0,
        blocked: true,
      },
    ];
    renderPage("/people?tab=readers");
    expect(screen.getByRole("link", { name: "الأولى" })).toHaveAttribute(
      "href",
      "/khatmas/k1",
    );
    expect(screen.getByText(t.people.noReply)).toBeInTheDocument();
    expect(screen.getByText(t.people.numberHidden)).toBeInTheDocument();
    expect(screen.getByText(t.people.statuses.blocked)).toBeInTheDocument();
  });

  it("sorts readers by name, last reply and created", async () => {
    m.rows["adminLists:readers"] = [
      {
        readerId: "r1",
        name: "زهرة",
        phoneMasked: "+971 50 ••• 0002",
        khatmaCount: 1,
        khatmas: [],
        lastReplyAt: null,
        createdAt: 0,
        blocked: false,
      },
    ];
    renderPage("/people?tab=readers");
    expect(last().args).toMatchObject({ sort: "created", order: "desc" });
    await userEvent.click(
      screen.getByRole("button", { name: t.people.lastReply }),
    );
    expect(last().args).toMatchObject({ sort: "lastReply", order: "desc" });
  });
});

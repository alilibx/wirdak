import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { OrganizersTab } from "./OrganizersTab";

const m = vi.hoisted(() => ({
  results: [] as unknown[],
  status: "Exhausted" as string,
  loadMore: vi.fn(),
  paginatedArgs: [] as unknown[],
  person: undefined as unknown,
  personArgs: [] as unknown[],
  find: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    usePaginatedQuery: (_ref: unknown, args: unknown, opts: unknown) => {
      m.paginatedArgs.push([args, opts]);
      return {
        results: m.results,
        status: m.status,
        loadMore: m.loadMore,
      };
    },
    useQuery: (_ref: never, args: unknown) => {
      m.personArgs.push(args);
      return args === "skip" ? undefined : m.person;
    },
    useConvex: () => ({
      query: (ref: never, args: unknown) => m.find(getFunctionName(ref), args),
    }),
    useMutation: (ref: never) => (args: unknown) =>
      m.mutation(getFunctionName(ref), args),
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

const organizer = (id: string, name: string, rotaAllowed: boolean) => ({
  personId: id,
  displayName: name,
  phoneMasked: "+971 50 ••• 4567",
  rotaAllowed,
  status: "active",
  away: false,
  totalMembers: 4,
  khatmas: [
    { khatmaId: `${id}-k1`, name: "ختمة العائلة", memberCount: 3 },
    { khatmaId: `${id}-k2`, name: null, memberCount: 1 },
  ],
});

function renderPage(search = "") {
  return render(
    <MemoryRouter>
      <OrganizersTab search={search} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  m.results = [organizer("p1", "سارة", false), organizer("p2", "علي", true)];
  m.status = "Exhausted";
  m.loadMore.mockReset();
  m.paginatedArgs = [];
  m.person = undefined;
  m.personArgs = [];
  m.find.mockReset();
  m.mutation.mockReset().mockResolvedValue({ ok: true });
});

describe("OrganizersTab", () => {
  it("shows the total members, and flags who is away or never signed in", () => {
    m.results = [
      { ...organizer("p1", "سارة", false), away: true },
      { ...organizer("p2", "علي", false), status: "notJoined" },
    ];
    renderPage();
    const row = screen.getByRole("link", { name: "سارة" }).closest("li")!;
    expect(within(row).getByText(t.organizers.away)).toBeInTheDocument();
    expect(
      within(row).getByText(t.organizers.totalMembers("٤")),
    ).toBeInTheDocument();
    const other = screen.getByRole("link", { name: "علي" }).closest("li")!;
    expect(
      within(other).queryByText(t.organizers.away),
    ).not.toBeInTheDocument();
    expect(
      within(other).getByText(t.people.statuses.notJoined),
    ).toBeInTheDocument();
  });

  it("sorts on the server, and passes the search on", async () => {
    renderPage("سارة");
    await userEvent.selectOptions(
      screen.getByLabelText(t.lists.sortBy),
      "lastSeen",
    );
    expect(m.paginatedArgs.at(-1)).toEqual([
      { adminToken: "tok", sort: "lastSeen", order: "desc", search: "سارة" },
      { initialNumItems: 50 },
    ]);
  });

  it("lists a page of 50 organizers, with a masked phone, their khatmas and the switch", () => {
    renderPage();
    expect(m.paginatedArgs[0]).toEqual([
      { adminToken: "tok", sort: "created", order: "desc" },
      { initialNumItems: 50 },
    ]);
    const row = screen.getByRole("link", { name: "سارة" }).closest("li")!;
    expect(within(row).getByText("+971 50 ••• 4567")).toBeInTheDocument();
    expect(
      within(row).getByRole("link", { name: "ختمة العائلة" }),
    ).toHaveAttribute("href", "/khatmas/p1-k1");
    expect(
      within(row).getByRole("link", { name: t.lookup.unnamed }),
    ).toBeInTheDocument();
    expect(within(row).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    const other = screen.getByRole("link", { name: "علي" }).closest("li")!;
    expect(within(other).getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("links setting a khatma up for an organizer", () => {
    renderPage();
    expect(
      screen.getByRole("link", { name: t.organizers.createFor }),
    ).toHaveAttribute("href", "/rota/new");
    expect(t.organizers.createFor).toBe("أنشئ ختمة بالتناوب نيابةً عن منظّم");
  });

  it("turns rotating khatmas on for a row after a confirmation", async () => {
    renderPage();
    const row = screen.getByRole("link", { name: "سارة" }).closest("li")!;
    await userEvent.click(within(row).getByRole("switch"));
    expect(m.mutation).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOn }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:setRotaAllowed", {
      adminToken: "tok",
      personId: "p1",
      allowed: true,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(t.ops.done);
  });

  it("turns it off for a row that has it, with the note the admin wrote", async () => {
    renderPage();
    const row = screen.getByRole("link", { name: "علي" }).closest("li")!;
    await userEvent.click(within(row).getByRole("switch"));
    await userEvent.type(screen.getByLabelText(t.ops.noteLabel), "طلب منه ذلك");
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOff }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:setRotaAllowed", {
      adminToken: "tok",
      personId: "p2",
      allowed: false,
      note: "طلب منه ذلك",
    });
  });

  it("says why a change was refused", async () => {
    m.mutation.mockResolvedValue({ error: "not_found" });
    renderPage();
    const row = screen.getByRole("link", { name: "سارة" }).closest("li")!;
    await userEvent.click(within(row).getByRole("switch"));
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOn }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.ops.errors.not_found,
    );
  });

  it("loads more, and says so when there are none", async () => {
    m.status = "CanLoadMore";
    const { unmount } = renderPage();
    await userEvent.click(screen.getByRole("button", { name: t.lists.more }));
    expect(m.loadMore).toHaveBeenCalledWith(50);
    unmount();

    m.results = [];
    m.status = "Exhausted";
    renderPage();
    expect(screen.getByText(t.organizers.empty)).toBeInTheDocument();
  });

  it("finds a person by phone and gives them the switch too", async () => {
    m.find.mockResolvedValue({
      personId: "p9",
      displayName: "ليلى",
      phone: "+971509998877",
      blocked: false,
    });
    m.person = {
      displayName: "ليلى",
      phone: "+971509998877",
      rotaAllowed: false,
    };
    renderPage();
    await userEvent.type(
      screen.getByLabelText(t.organizers.searchLabel),
      "+971509998877",
    );
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    expect(m.find).toHaveBeenCalledWith("adminLookup:findPerson", {
      adminToken: "tok",
      phone: "+971509998877",
    });
    const hit = (await screen.findByRole("link", { name: "ليلى" })).closest(
      "li",
    )!;
    await userEvent.click(within(hit).getByRole("switch"));
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOn }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:setRotaAllowed", {
      adminToken: "tok",
      personId: "p9",
      allowed: true,
    });
  });

  it("says so when the search fails", async () => {
    m.find.mockRejectedValue(new Error("offline"));
    renderPage();
    await userEvent.type(
      screen.getByLabelText(t.organizers.searchLabel),
      "+971509998877",
    );
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.ops.errors.generic,
    );
  });

  it("clears the old result as soon as a new search starts", async () => {
    m.find.mockResolvedValueOnce({ personId: null, blocked: false });
    renderPage();
    const box = screen.getByLabelText(t.organizers.searchLabel);
    await userEvent.type(box, "+971500000000");
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    expect(await screen.findByText(t.lookup.noAccount)).toBeInTheDocument();

    m.find.mockReturnValueOnce(new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    expect(screen.queryByText(t.lookup.noAccount)).not.toBeInTheDocument();
  });

  it("doesn't call an empty page with more to come the end of the list", () => {
    m.results = [];
    m.status = "CanLoadMore";
    renderPage();
    expect(screen.queryByText(t.organizers.empty)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t.lists.more }),
    ).toBeInTheDocument();
  });

  it("tells when a number has no account or is not valid", async () => {
    m.find.mockResolvedValueOnce({ personId: null, blocked: false });
    renderPage();
    const box = screen.getByLabelText(t.organizers.searchLabel);
    await userEvent.type(box, "+971500000000");
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    expect(await screen.findByText(t.lookup.noAccount)).toBeInTheDocument();

    m.find.mockResolvedValueOnce({ error: "invalid_phone" });
    await userEvent.clear(box);
    await userEvent.type(box, "12");
    await userEvent.click(screen.getByRole("button", { name: t.lookup.find }));
    await waitFor(() =>
      expect(screen.getByText(t.lookup.invalidPhone)).toBeInTheDocument(),
    );
  });
});

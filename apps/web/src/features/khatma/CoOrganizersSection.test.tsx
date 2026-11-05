import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { CoOrganizersSection } from "./CoOrganizersSection";

const m = vi.hoisted(() => ({
  list: undefined as unknown,
  fns: {
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "coOrganizers:list") return m.list;
      throw new Error(`unexpected query ${name}`);
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      if (name === "coOrganizers:set") return m.fns.set;
      if (name === "coOrganizers:remove") return m.fns.remove;
      throw new Error(`unexpected mutation ${name}`);
    },
  };
});

const args = { sessionToken: "tok", inviteCode: "CODE" };

function listView(overrides: Record<string, unknown> = {}) {
  return {
    max: 5,
    enabled: true,
    defaults: { readings: true, people: false, settings: true },
    coOrganizers: [
      {
        coOrganizerId: "c1",
        name: "مريم",
        readings: true,
        people: true,
        settings: false,
        pending: false,
      },
      {
        coOrganizerId: "c2",
        name: "خالد",
        readings: false,
        people: false,
        settings: false,
        pending: true,
      },
    ],
    candidates: [
      { candidateId: "m:a", name: "سارة" },
      { candidateId: "m:b", name: "عمر" },
    ],
    ...overrides,
  };
}

const section = () =>
  screen.getByRole("region", { name: t.coOrganizers.heading });
const switchNamed = (scope: HTMLElement, name: string) =>
  within(scope).getByRole("switch", { name });

beforeEach(() => {
  m.list = listView();
  m.fns.set.mockReset().mockResolvedValue({ ok: true });
  m.fns.remove.mockReset().mockResolvedValue({ ok: true });
});

describe("CoOrganizersSection", () => {
  it("lists each co-organizer with their permissions in words, and who hasn't signed in", () => {
    render(<CoOrganizersSection inviteCode="CODE" />);
    const rows = within(section()).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("مريم");
    expect(rows[0]).toHaveTextContent("القراءة والمشاركون");
    expect(rows[0]).not.toHaveTextContent(t.coOrganizers.pending);
    expect(rows[1]).toHaveTextContent("خالد");
    expect(rows[1]).toHaveTextContent("بلا صلاحيات");
    expect(rows[1]).toHaveTextContent("لم يسجّل الدخول بعد");
  });

  it("the owner adds a co-organizer with preset switches and saves", async () => {
    const user = userEvent.setup();
    render(<CoOrganizersSection inviteCode="CODE" />);
    await user.click(
      within(section()).getByRole("button", { name: "أضف منظّماً مساعداً" }),
    );
    const sheet = screen.getByRole("dialog", { name: "أضف منظّماً مساعداً" });
    const save = within(sheet).getByRole("button", { name: "حفظ" });
    // Nobody picked yet: nothing to save.
    expect(save).toBeDisabled();
    // The switches start at the admin's defaults.
    expect(switchNamed(sheet, "القراءة")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchNamed(sheet, "المشاركون")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(switchNamed(sheet, "الإعدادات")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(sheet).getByRole("radio", { name: "عمر" }));
    await user.click(switchNamed(sheet, "المشاركون"));
    await user.click(save);
    expect(m.fns.set).toHaveBeenCalledWith({
      ...args,
      candidateId: "m:b",
      readings: true,
      people: true,
      settings: true,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why naming was refused, and keeps the sheet open", async () => {
    m.fns.set.mockResolvedValue({ error: "full" });
    const user = userEvent.setup();
    render(<CoOrganizersSection inviteCode="CODE" />);
    await user.click(
      within(section()).getByRole("button", { name: t.coOrganizers.add }),
    );
    const sheet = screen.getByRole("dialog", { name: t.coOrganizers.add });
    await user.click(within(sheet).getByRole("radio", { name: "سارة" }));
    await user.click(within(sheet).getByRole("button", { name: "حفظ" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      t.coOrganizers.errors.full!,
    );
  });

  it("tapping a co-organizer opens their switches, which save", async () => {
    const user = userEvent.setup();
    render(<CoOrganizersSection inviteCode="CODE" />);
    await user.click(within(section()).getByRole("button", { name: /مريم/ }));
    const sheet = screen.getByRole("dialog", { name: "مريم" });
    expect(switchNamed(sheet, "القراءة")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchNamed(sheet, "المشاركون")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const save = within(sheet).getByRole("button", { name: "حفظ" });
    expect(save).toBeDisabled();
    await user.click(switchNamed(sheet, "القراءة"));
    await user.click(save);
    expect(m.fns.set).toHaveBeenCalledWith({
      ...args,
      coOrganizerId: "c1",
      readings: false,
      people: true,
      settings: false,
    });
  });

  it("removes a co-organizer from their sheet", async () => {
    const user = userEvent.setup();
    render(<CoOrganizersSection inviteCode="CODE" />);
    await user.click(within(section()).getByRole("button", { name: /خالد/ }));
    const sheet = screen.getByRole("dialog", { name: "خالد" });
    expect(sheet).toHaveTextContent(t.coOrganizers.pending);
    await user.click(
      within(sheet).getByRole("button", {
        name: "أزل من المنظّمين المساعدين",
      }),
    );
    expect(m.fns.remove).toHaveBeenCalledWith({
      ...args,
      coOrganizerId: "c2",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no add while the feature is off, but the list still opens", async () => {
    m.list = listView({ enabled: false });
    const user = userEvent.setup();
    render(<CoOrganizersSection inviteCode="CODE" />);
    expect(
      within(section()).queryByRole("button", { name: t.coOrganizers.add }),
    ).toBeNull();
    await user.click(within(section()).getByRole("button", { name: /مريم/ }));
    expect(screen.getByRole("dialog", { name: "مريم" })).toBeInTheDocument();
  });

  it("offers no add once the khatma has the most co-organizers it can", () => {
    m.list = listView({ max: 2 });
    render(<CoOrganizersSection inviteCode="CODE" />);
    expect(
      within(section()).queryByRole("button", { name: t.coOrganizers.add }),
    ).toBeNull();
    expect(section()).toHaveTextContent(t.coOrganizers.full);
  });

  it("shows nothing to anyone the list refuses", () => {
    m.list = { forbidden: true };
    const { container } = render(<CoOrganizersSection inviteCode="CODE" />);
    expect(container).toBeEmptyDOMElement();
  });
});

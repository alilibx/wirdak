import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { PersonAdminPage } from "./PersonAdminPage";

const m = vi.hoisted(() => ({
  person: undefined as unknown,
  mutation: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => m.person,
    useMutation: (ref: never) => (args: unknown) =>
      m.mutation(getFunctionName(ref), args),
  };
});
vi.mock("../lib/adminSession", () => ({ useAdminToken: () => "tok" }));

const person = (blocked: boolean, rotaAllowed = false) => ({
  displayName: "سارة",
  phone: "+971500000002",
  timeZone: "Asia/Dubai",
  verifiedAt: 0,
  lastSeenAt: 0,
  khatmas: [
    {
      khatmaId: "k1",
      name: "ختمة العائلة",
      inviteCode: "x",
      isOrganizer: true,
      status: "active",
    },
  ],
  sessions: [{ deviceLabel: "iPhone · Safari", lastUsedAt: 0 }],
  helpRequests: [],
  rotaAllowed,
  whatsappNotes: false,
  blocked,
});

beforeEach(() => {
  m.person = person(false);
  m.mutation.mockReset().mockResolvedValue({ ok: true, ended: 1 });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/people/p2"]}>
      <Routes>
        <Route path="/people/:personId" element={<PersonAdminPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PersonAdminPage", () => {
  it("says someone has never come in, and when they last did", () => {
    const { unmount } = renderPage();
    expect(
      screen.getByText(new RegExp(t.lookup.neverSeen)),
    ).toBeInTheDocument();
    unmount();
    m.person = { ...person(false), lastSeenAt: 1_800_000_000_000 };
    renderPage();
    expect(screen.queryByText(new RegExp(t.lookup.neverSeen))).toBeNull();
  });

  it("says a khatma is waiting for them", () => {
    const base = person(false);
    m.person = {
      ...base,
      khatmas: [{ ...base.khatmas[0], pending: true }],
    };
    renderPage();
    expect(screen.getByText(t.rota.pending)).toBeInTheDocument();
    expect(screen.queryByText(t.lookup.organizerBadge)).toBeNull();
  });

  it("signs out everywhere after a confirmation", async () => {
    renderPage();
    expect(screen.getByText(t.lookup.organizerBadge)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.signOutAll }),
    );
    await userEvent.click(
      screen.getAllByRole("button", { name: t.ops.signOutAll }).at(-1)!,
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:signOutEverywhere", {
      adminToken: "tok",
      personId: "p2",
    });
  });

  it("offers unblock for a blocked number", () => {
    m.person = person(true);
    renderPage();
    expect(
      screen.getByRole("button", { name: t.ops.unblock }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t.ops.block }),
    ).not.toBeInTheDocument();
  });

  it("turns rotating khatmas on after a confirmation", async () => {
    renderPage();
    const toggle = screen.getByRole("switch", { name: t.ops.rotaAllowed });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(m.mutation).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOn }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:setRotaAllowed", {
      adminToken: "tok",
      personId: "p2",
      allowed: true,
    });
  });

  it("turns it off for someone who has it", async () => {
    m.person = person(false, true);
    renderPage();
    const toggle = screen.getByRole("switch", { name: t.ops.rotaAllowed });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.rotaAllowOff }),
    );
    expect(m.mutation).toHaveBeenCalledWith("adminOps:setRotaAllowed", {
      adminToken: "tok",
      personId: "p2",
      allowed: false,
    });
  });
});

describe("editing a person", () => {
  it("saves their name and WhatsApp notes, with the note", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.editPerson }),
    );
    const name = screen.getByLabelText(t.ops.personName);
    expect(name).toHaveValue("سارة");
    await userEvent.clear(name);
    await userEvent.type(name, "نورة");
    await userEvent.click(
      screen.getByRole("switch", { name: t.ops.whatsappNotes }),
    );
    await userEvent.type(screen.getByLabelText(t.ops.noteLabel), "طلبت");
    await userEvent.click(screen.getByRole("button", { name: t.ops.save }));
    expect(m.mutation).toHaveBeenCalledWith("adminPeople:update", {
      adminToken: "tok",
      personId: "p2",
      displayName: "نورة",
      whatsappNotes: true,
      note: "طلبت",
    });
  });

  it("can't save an empty name", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.editPerson }),
    );
    await userEvent.clear(screen.getByLabelText(t.ops.personName));
    expect(screen.getByRole("button", { name: t.ops.save })).toBeDisabled();
  });

  it("says when the name is refused", async () => {
    m.mutation.mockResolvedValue({ error: "invalid_name" });
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: t.ops.editPerson }),
    );
    await userEvent.click(screen.getByRole("button", { name: t.ops.save }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      t.ops.errors.invalid_name,
    );
  });
});

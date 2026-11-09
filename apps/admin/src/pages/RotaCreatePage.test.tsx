import { t as webT } from "@web/i18n/ar";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { RotaCreatePage, RotaSetupPage } from "./RotaCreatePage";

const m = vi.hoisted(() => ({
  create: vi.fn(),
  people: undefined as unknown,
  saved: [] as unknown,
  read: [] as string[],
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) => {
      const name = getFunctionName(ref);
      m.read.push(name);
      if (name === "adminRota:people") return m.people;
      if (name === "adminRota:saved") return m.saved;
      return undefined;
    },
    useMutation: (ref: never) => {
      const name = getFunctionName(ref);
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
    useAction: () => m.create,
  };
});
vi.mock("../lib/adminSession", () => ({
  useAdminToken: () => "tok",
  getAdminToken: () => "tok",
}));

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/rota/new" element={<RotaCreatePage />} />
        <Route
          path="/khatmas/:khatmaId/rota/setup"
          element={<RotaSetupPage />}
        />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const organizer = {
  id: "p1",
  name: "أم خالد",
  isMe: false,
  phone: "+971500009000",
  juz: [1],
  heldSlots: 1,
  shared: [],
  joined: false,
  stopped: false,
  silenced: false,
};
const people = {
  title: "ختمة العائلة",
  daysKind: "daily",
  joinLink: "https://wa.me/971500000000?text=join",
  requests: [],
  target: { number: 1, date: "2027-01-16", isFirst: true },
  rows: [],
  participants: [organizer],
  freeJuz: [],
  unsharedJuz: [],
  maxSlots: 3,
};

beforeEach(() => {
  m.create
    .mockReset()
    .mockResolvedValue({ khatmaId: "k1", inviteCode: "code" });
  m.people = people;
  m.saved = [];
  m.read = [];
  m.fns = {};
});

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(t.rota.organizerName), "أم خالد");
  await user.type(
    screen.getByLabelText(t.rota.organizerPhone),
    "+971500009000",
  );
  await user.type(
    screen.getByLabelText(webT.rota.nameQuestion),
    "ختمة العائلة",
  );
}

describe("RotaCreatePage", () => {
  it("asks whose khatma it is, creates it for them, and goes on to its people", async () => {
    const user = userEvent.setup();
    renderAt("/rota/new");
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: webT.rota.next }));

    expect(m.create).toHaveBeenCalledWith({
      adminToken: "tok",
      organizerName: "أم خالد",
      organizerPhone: "+971500009000",
      name: "ختمة العائلة",
      days: { kind: "daily" },
      firstDate: expect.any(String) as string,
      endDate: null,
    });
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/khatmas/k1/rota/setup",
      ),
    );
  });

  it("says a refusal in the admin's words", async () => {
    const user = userEvent.setup();
    m.create.mockRejectedValue(new ConvexError({ code: "rota_cap" }));
    renderAt("/rota/new");
    await fillIn(user);
    await user.click(screen.getByRole("button", { name: webT.rota.next }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.rota_cap,
    );
    expect(screen.getByTestId("where")).toHaveTextContent("/rota/new");

    m.create.mockRejectedValue(new ConvexError({ code: "bad_phone" }));
    await user.click(screen.getByRole("button", { name: webT.rota.next }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.bad_phone,
    );
  });
});

describe("RotaSetupPage", () => {
  it("adds people through the admin's functions, with no pool shortcut", async () => {
    const user = userEvent.setup();
    renderAt("/khatmas/k1/rota/setup");
    expect(m.read).toContain("adminRota:people");
    expect(m.read).toContain("adminRota:saved");
    expect(m.read.filter((name) => !name.startsWith("adminRota:"))).toEqual([]);
    expect(screen.queryByText(webT.rota.importHint)).toBeNull();

    await user.type(screen.getByLabelText(webT.rota.personName), "سعد");
    await user.type(
      screen.getByLabelText(webT.rota.personPhone),
      "+971500009001",
    );
    await user.click(screen.getByRole("button", { name: webT.rota.add }));
    expect(m.fns["adminRota:addParticipant"]).toHaveBeenCalledWith({
      adminToken: "tok",
      khatmaId: "k1",
      name: "سعد",
      phone: "+971500009001",
    });
  });

  it("offers the organizer's saved people", () => {
    m.saved = [{ id: "c1", name: "سعد", phone: null, inKhatma: false }];
    renderAt("/khatmas/k1/rota/setup");
    expect(
      screen.getByRole("button", { name: webT.rota.savedFrom }),
    ).toBeInTheDocument();
  });

  it("«تمّ» finishes setup and goes to the help page", async () => {
    const user = userEvent.setup();
    renderAt("/khatmas/k1/rota/setup");
    await user.click(screen.getByRole("button", { name: webT.rota.done }));
    expect(m.fns["adminRota:finishSetup"]).toHaveBeenCalledWith({
      adminToken: "tok",
      khatmaId: "k1",
    });
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/khatmas/k1/rota"),
    );
  });

  it("a pool khatma goes on to the help page, which says it isn't found", async () => {
    m.people = null;
    renderAt("/khatmas/k1/rota/setup");
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/khatmas/k1/rota"),
    );
  });
});

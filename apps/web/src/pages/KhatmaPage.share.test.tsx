import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KhatmaView } from "@convex/khatmas";
import { makeTiles, makeView } from "../test/fixtures";
import { KhatmaPage } from "./KhatmaPage";

const m = vi.hoisted(() => ({
  view: undefined as unknown,
  ensure: vi.fn(),
}));

vi.mock("../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("../features/verify/VerifySheet", () => ({ VerifySheet: () => null }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (ref: never) =>
      ["notes:forKhatma", "khatmas:mine"].includes(getFunctionName(ref))
        ? []
        : m.view,
    useMutation: () => vi.fn(),
    useAction: () => m.ensure,
  };
});

function StateProbe() {
  const location = useLocation();
  return <output data-testid="state">{JSON.stringify(location.state)}</output>;
}

function renderAt(entry: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <StateProbe />
      <Routes>
        <Route path="/j/:inviteCode" element={<KhatmaPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const member = (over: Partial<KhatmaView> = {}) =>
  makeView({
    tiles: makeTiles({
      3: { state: "done" },
      14: { state: "reading", readerName: "سارة" },
    }),
    targetEndAt: null,
    ...over,
  });

describe("KhatmaPage invite and remind", () => {
  beforeEach(() => {
    m.ensure.mockReset();
    m.ensure.mockResolvedValue({ shareToken: "SHARE9" });
    m.view = member();
  });

  it("shows the two buttons to members only", () => {
    renderAt("/j/CODE?tab=group");
    expect(screen.getByRole("button", { name: "ادعُ أحبابك" })).toBeVisible();
    expect(screen.getByRole("button", { name: "ذكّر المجموعة" })).toBeVisible();
  });

  it("hides them from visitors", () => {
    m.view = member({
      me: {
        signedIn: false,
        displayName: null,
        isMember: false,
        notificationsOn: null,
        holding: null,
        hold: null,
        suggestion: null,
        celebrateRound: null,
      },
    });
    renderAt("/j/CODE");
    expect(screen.queryByRole("button", { name: "ادعُ أحبابك" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ذكّر المجموعة" })).toBeNull();
  });

  it("the invite sheet fetches the share token and links to WhatsApp with the member link", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=group");
    await user.click(screen.getByRole("button", { name: "ادعُ أحبابك" }));
    const link = await screen.findByRole("link", { name: "أرسل على واتساب" });
    expect(m.ensure).toHaveBeenCalledWith({
      sessionToken: "tok",
      inviteCode: "CODE",
    });
    const url = `${location.origin}/j/CODE?from=SHARE9`;
    const text = `السلام عليكم 🤍\nانضم إلينا في «ختمة العائلة». نختم القرآن معاً، وكل واحد يأخذ جزءاً واحداً في كل مرة.\nاضغط هنا: ${url}`;
    expect(link).toHaveAttribute(
      "href",
      `https://wa.me/?text=${encodeURIComponent(text)}`,
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(screen.getByText(/انضم إلينا في «ختمة العائلة»/)).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "ادعُ أحبابك" }),
    ).toBeInTheDocument();
  });

  it("arriving after an invite reset opens the plain invite sheet once", async () => {
    renderAt({ pathname: "/j/CODE", state: { openInvite: true } });
    expect(
      await screen.findByRole("dialog", { name: "ادعُ أحبابك" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("null");
  });

  it("uses a dated name when the khatma has none", async () => {
    m.view = member({ name: null });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=group");
    await user.click(screen.getByRole("button", { name: "ادعُ أحبابك" }));
    expect(
      await screen.findByText(/انضم إلينا في «ختمة .*أكتوبر»/),
    ).toBeVisible();
  });

  it("shows the network copy when the share token cannot be fetched, and no link", async () => {
    m.ensure.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=group");
    await user.click(screen.getByRole("button", { name: "ادعُ أحبابك" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال");
    expect(screen.queryByRole("link", { name: "أرسل على واتساب" })).toBeNull();
  });

  it("the remind sheet lists open ajza', adds the note, and never names anyone", async () => {
    m.view = member({ targetEndAt: Date.UTC(2026, 9, 30, 12) });
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=group");
    await user.click(screen.getByRole("button", { name: "ذكّر المجموعة" }));
    const link = await screen.findByRole("link", { name: "أرسل على واتساب" });
    expect(screen.getByText("الرسالة لا تذكر أسماء أحد")).toBeVisible();
    const href = decodeURIComponent(link.getAttribute("href") ?? "");
    // 30 ajza', one done and one being read: 28 open, listed without 3 or 14.
    expect(href).toContain("بقي 28 جزءاً");
    expect(href).toContain("1، 2، 4، 5");
    expect(href).not.toContain("14،");
    expect(href).toContain("حتى ");
    expect(href).toContain(`${location.origin}/j/CODE?from=SHARE9`);
    expect(href).not.toContain("سارة");
  });

  it("hides the remind button when nothing is open", () => {
    m.view = member({
      tiles: makeTiles(
        Object.fromEntries(
          Array.from({ length: 30 }, (_, i) => [
            i + 1,
            { state: "done" as const },
          ]),
        ),
      ),
    });
    renderAt("/j/CODE?tab=group");
    expect(screen.queryByRole("button", { name: "ذكّر المجموعة" })).toBeNull();
    expect(screen.getByRole("button", { name: "ادعُ أحبابك" })).toBeVisible();
  });

  it("opens the invite sheet after creation and clears the state so a reload does not", async () => {
    renderAt({ pathname: "/j/CODE", state: { justCreated: true } });
    expect(
      await screen.findByRole("dialog", {
        name: "تمّ إنشاء الختمة. ادعُ أحبابك",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("null");
  });

  it("closes with its labelled button", async () => {
    const user = userEvent.setup();
    renderAt("/j/CODE?tab=group");
    await user.click(screen.getByRole("button", { name: "ادعُ أحبابك" }));
    await user.click(await screen.findByRole("button", { name: "تمّ" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fetches the share token once per sheet open, even under StrictMode", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/j/CODE?tab=group"]}>
          <Routes>
            <Route path="/j/:inviteCode" element={<KhatmaPage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    await user.click(screen.getByRole("button", { name: "ادعُ أحبابك" }));
    await screen.findByRole("link", { name: "أرسل على واتساب" });
    expect(m.ensure).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "تمّ" }));
    await user.click(screen.getByRole("button", { name: "ذكّر المجموعة" }));
    await screen.findByRole("link", { name: "أرسل على واتساب" });
    expect(m.ensure).toHaveBeenCalledTimes(2);
  });
});

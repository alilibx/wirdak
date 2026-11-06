import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { TransferSection } from "./TransferSection";

const m = vi.hoisted(() => ({
  view: null as unknown,
  fns: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
}));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => m.view,
    useMutation: (ref: never) => {
      const name = getFunctionName(ref).split(":")[1] ?? "";
      m.fns[name] ??= vi.fn().mockResolvedValue({ ok: true });
      return m.fns[name];
    },
  };
});

const person = (id: string, name: string, hasAccount: boolean) => ({
  id,
  name,
  isOrganizer: false,
  hasAccount,
});

beforeEach(() => {
  m.fns = {};
  m.view = {
    participants: [
      { ...person("p1", "المنظم", true), isOrganizer: true },
      person("p2", "خالد", true),
      person("p3", "ياسر", false),
    ],
  };
});

function renderSection() {
  render(
    <MemoryRouter>
      <TransferSection inviteCode="CODE" />
    </MemoryRouter>,
  );
}

describe("TransferSection", () => {
  it("lists a participant who has not signed in as pending, and cannot be picked", async () => {
    const user = userEvent.setup();
    renderSection();
    const pending = screen.getByRole("button", { name: /ياسر/ });
    expect(pending).toBeDisabled();
    expect(pending).toHaveTextContent(t.coOrganizers.pending);
    await user.click(pending);
    expect(screen.queryByText(t.organizer.transferBody)).toBeNull();

    const ready = screen.getByRole("button", { name: "خالد" });
    expect(ready).toBeEnabled();
    await user.click(ready);
    expect(screen.getByText(t.organizer.transferBody)).toBeInTheDocument();
  });
});

import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/ar";
import { ArchiveSection, ArchivedSection } from "./ArchivedActions";
import { resetDeleting, startDelete, useDeleteFailure } from "./deleting";

const m = vi.hoisted(() => ({
  archive: vi.fn(),
  remove: vi.fn(),
  startAgain: vi.fn(),
}));

vi.mock("../../lib/session", () => ({
  useSessionToken: () => "tok",
  getSessionToken: () => "tok",
  clearSessionToken: () => {},
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: never) =>
      getFunctionName(ref) === "khatmaLifecycle:archive" ? m.archive : m.remove,
    useAction: () => m.startAgain,
    useQuery: () => undefined,
  };
});

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderIn(element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/j/CODE/settings"]}>
      <Routes>
        <Route path="/j/:inviteCode/settings" element={element} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const args = { sessionToken: "tok", inviteCode: "CODE" };
const sheet = (name: string) => screen.getByRole("dialog", { name });
const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  // Thursday 29 October 2026 in the khatma's zone, whatever zone the machine is in.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T08:00:00Z"));
  m.archive.mockReset().mockResolvedValue({ ok: true });
  m.remove.mockReset().mockResolvedValue({ ok: true });
  m.startAgain.mockReset().mockResolvedValue({ inviteCode: "NEWCODE" });
});
afterEach(() => {
  vi.useRealTimers();
  resetDeleting();
});

describe("ArchiveSection", () => {
  it("asks first: messages stop and nothing is lost", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchiveSection inviteCode="CODE" />);
    await user.click(screen.getByRole("button", { name: t.archive.button }));
    const confirm = sheet(t.archive.title);
    expect(within(confirm).getByText(t.archive.body)).toBeInTheDocument();
    expect(t.archive.body).toContain("تتوقف الرسائل");
    expect(t.archive.body).toContain("ولا يضيع شيء");
    expect(m.archive).not.toHaveBeenCalled();
  });

  it("archives only after the confirmation, then closes the sheet", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchiveSection inviteCode="CODE" />);
    await user.click(screen.getByRole("button", { name: t.archive.button }));
    await user.click(
      within(sheet(t.archive.title)).getByRole("button", {
        name: t.archive.confirm,
      }),
    );
    expect(m.archive).toHaveBeenCalledWith(args);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backing out archives nothing", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchiveSection inviteCode="CODE" />);
    await user.click(screen.getByRole("button", { name: t.archive.button }));
    await user.click(
      within(sheet(t.archive.title)).getByRole("button", {
        name: t.archive.cancel,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(m.archive).not.toHaveBeenCalled();
  });

  it("keeps the sheet open and says why when the call fails", async () => {
    m.archive.mockRejectedValue(new ConvexError({ code: "forbidden" }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchiveSection inviteCode="CODE" />);
    await user.click(screen.getByRole("button", { name: t.archive.button }));
    await user.click(
      within(sheet(t.archive.title)).getByRole("button", {
        name: t.archive.confirm,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.forbidden ?? "",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ArchivedSection", () => {
  const restart = { days: { kind: "daily" as const }, timeZone: "UTC" };

  it("a pool khatma has delete and no restart", () => {
    renderIn(<ArchivedSection inviteCode="CODE" restart={null} />);
    expect(
      screen.getByRole("button", { name: t.archive.delete }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t.archive.restart }),
    ).toBeNull();
  });

  it("start again opens with tomorrow as the first day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchivedSection inviteCode="CODE" restart={restart} />);
    await user.click(screen.getByRole("button", { name: t.archive.restart }));
    const again = sheet(t.archive.restartTitle);
    expect(within(again).getByText(t.archive.restartBody)).toBeInTheDocument();
    expect(again).toHaveTextContent("غداً، الجمعة ٣٠ أكتوبر");
  });

  it("calls startAgain with tomorrow in the khatma's own zone and goes to the setup", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // 22:00 UTC on the 29th is already the 30th in Dubai, so tomorrow there is the 31st.
    vi.setSystemTime(new Date("2026-10-29T22:00:00Z"));
    renderIn(
      <ArchivedSection
        inviteCode="CODE"
        restart={{ days: { kind: "daily" }, timeZone: "Asia/Dubai" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: t.archive.restart }));
    await user.click(
      within(sheet(t.archive.restartTitle)).getByRole("button", {
        name: t.archive.restartConfirm,
      }),
    );
    expect(m.startAgain).toHaveBeenCalledWith({
      ...args,
      firstDate: "2026-10-31",
    });
    expect(where()).toBe("/j/NEWCODE/setup");
  });

  it("moves a weekly khatma's first day on to its next reading day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // Tomorrow is Friday the 30th; readings are on Mondays (day 1).
    renderIn(
      <ArchivedSection
        inviteCode="CODE"
        restart={{
          days: { kind: "weekly", weekdays: [1], everyWeeks: 1 },
          timeZone: "UTC",
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: t.archive.restart }));
    await user.click(
      within(sheet(t.archive.restartTitle)).getByRole("button", {
        name: t.archive.restartConfirm,
      }),
    );
    expect(m.startAgain).toHaveBeenCalledWith({
      ...args,
      firstDate: "2026-11-02",
    });
  });

  it("sends the date the organizer picked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchivedSection inviteCode="CODE" restart={restart} />);
    await user.click(screen.getByRole("button", { name: t.archive.restart }));
    const again = sheet(t.archive.restartTitle);
    await user.click(
      within(again).getByRole("button", {
        name: `${t.archive.restartDate}: ${t.rota.change}`,
      }),
    );
    const input = within(again).getByLabelText(t.rota.startDateInput);
    expect(input).toHaveAttribute("min", "2026-10-30");
    fireEvent.change(input, { target: { value: "2026-11-05" } });
    await user.click(
      within(again).getByRole("button", { name: t.archive.restartConfirm }),
    );
    expect(m.startAgain).toHaveBeenCalledWith({
      ...args,
      firstDate: "2026-11-05",
    });
  });

  it.each(["rota_cap", "invalid_dates", "rate_limited"])(
    "says %s in plain words and stays on the sheet",
    async (code) => {
      m.startAgain.mockRejectedValue(new ConvexError({ code }));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderIn(<ArchivedSection inviteCode="CODE" restart={restart} />);
      await user.click(screen.getByRole("button", { name: t.archive.restart }));
      await user.click(
        within(sheet(t.archive.restartTitle)).getByRole("button", {
          name: t.archive.restartConfirm,
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        t.rota.errors[code] ?? "",
      );
      expect(where()).toBe("/j/CODE/settings");
    },
  );

  it("delete says it can't be undone and that saved participants stay", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchivedSection inviteCode="CODE" restart={null} />);
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    const confirm = sheet(t.archive.deleteTitle);
    expect(within(confirm).getByText(t.archive.deleteBody)).toBeInTheDocument();
    expect(t.archive.deleteBody).toContain("لا يمكن التراجع");
    expect(t.archive.deleteBody).toContain("المشاركون المحفوظون");
    expect(m.remove).not.toHaveBeenCalled();
  });

  it("deletes after the confirmation and goes home", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchivedSection inviteCode="CODE" restart={null} />);
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    await user.click(
      within(sheet(t.archive.deleteTitle)).getByRole("button", {
        name: t.archive.deleteConfirm,
      }),
    );
    expect(m.remove).toHaveBeenCalledWith(args);
    expect(where()).toBe("/");
  });

  it("a khatma that is not archived is not deleted, and says so", async () => {
    m.remove.mockResolvedValue({ error: "not_archived" });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderIn(<ArchivedSection inviteCode="CODE" restart={null} />);
    await user.click(screen.getByRole("button", { name: t.archive.delete }));
    await user.click(
      within(sheet(t.archive.deleteTitle)).getByRole("button", {
        name: t.archive.deleteConfirm,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.rota.errors.not_archived ?? "",
    );
    expect(where()).toBe("/j/CODE/settings");
  });

  it("a second delete while the first still lingers says so and deletes nothing", async () => {
    const failure = renderHook(() => useDeleteFailure("OTHER"));
    await act(async () => {
      await startDelete("CODE", m.remove, () => {});
    });
    const other = vi.fn();

    let deleted: boolean | undefined;
    await act(async () => {
      deleted = await startDelete("OTHER", other, () => {});
    });

    expect(deleted).toBe(false);
    expect(other).not.toHaveBeenCalled();
    expect(failure.result.current).toBe(t.archive.deleteBusy);
  });

  it("the delete button is red", () => {
    renderIn(<ArchivedSection inviteCode="CODE" restart={null} />);
    expect(screen.getByRole("button", { name: t.archive.delete })).toHaveClass(
      "text-[#8A2B1E]",
    );
  });
});

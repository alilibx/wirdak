import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { HoldView } from "@convex/khatmas";
import { makeTiles, makeView } from "../test/fixtures";
import { MainCard } from "./MainCard";

const handlers = () => ({
  onTake: vi.fn(),
  onFinish: vi.fn(),
  onRelease: vi.fn(),
  onStillReading: vi.fn(),
});

describe("MainCard", () => {
  it("shows the suggestion", () => {
    const view = makeView({
      me: {
        signedIn: true,
        displayName: "علي",
        isMember: true,
        notificationsOn: true,
        holding: null,
        hold: null,
        suggestion: 19,
        celebrateRound: null,
      },
    });
    render(<MainCard view={view} {...handlers()} />);
    expect(
      screen.getByText("نقترح عليك الجزء 19 «وقال الذين»"),
    ).toBeInTheDocument();
  });

  it("take button passes the suggested juz", async () => {
    const h = handlers();
    const view = makeView({
      me: {
        signedIn: true,
        displayName: "علي",
        isMember: true,
        notificationsOn: true,
        holding: null,
        hold: null,
        suggestion: 19,
        celebrateRound: null,
      },
    });
    render(<MainCard view={view} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    expect(h.onTake).toHaveBeenCalledWith(19);
  });

  it("shows the held juz with finish and release actions", async () => {
    const h = handlers();
    const view = makeView({
      tiles: makeTiles({ 14: { state: "reading", isMine: true } }),
      me: {
        signedIn: true,
        displayName: "علي",
        isMember: true,
        notificationsOn: true,
        holding: 14,
        hold: { openForHelp: false, canExtend: false, paceDays: null },
        suggestion: null,
        celebrateRound: null,
      },
    });
    render(<MainCard view={view} {...h} />);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.getByText("ربما")).toBeInTheDocument();
    expect(screen.getByText("يبدأ من سورة الحجر")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "أتممتُ القراءة" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "لا أستطيع إكماله" }),
    );
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.onRelease).toHaveBeenCalledTimes(1);
  });

  it("says all parts are taken when nothing is open", () => {
    const all = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        i + 1,
        { state: "reading" as const },
      ]),
    );
    render(
      <MainCard view={makeView({ tiles: makeTiles(all) })} {...handlers()} />,
    );
    expect(screen.getByText("كل الأجزاء مأخوذة الآن")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders no card for a blocked member (open tiles but no suggestion)", () => {
    const { container } = render(
      <MainCard view={makeView()} {...handlers()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  const holdView = (hold: HoldView) =>
    makeView({
      tiles: makeTiles({ 14: { state: "reading", isMine: true } }),
      me: {
        signedIn: true,
        displayName: "علي",
        isMember: true,
        notificationsOn: true,
        holding: 14,
        hold,
        suggestion: null,
        celebrateRound: null,
      },
    });

  it("main card never shows time left", () => {
    for (const openForHelp of [false, true]) {
      for (const canExtend of [false, true]) {
        for (const paceDays of [null, 1, 2, 3, 7]) {
          const { container, unmount } = render(
            <MainCard
              view={holdView({ openForHelp, canExtend, paceDays })}
              {...handlers()}
            />,
          );
          expect(container.textContent).not.toMatch(/ساعة|دقيقة|متبقٍ|تأخر/);
          unmount();
        }
      }
    }
  });

  it("main card shows the open-for-help line and the extend button only when allowed", async () => {
    const h = handlers();
    const line = "يمكن لغيرك أن يساعد فيه الآن، ويمكنك إتمامه إن شئت.";
    const { rerender } = render(
      <MainCard
        view={holdView({
          openForHelp: false,
          canExtend: false,
          paceDays: null,
        })}
        {...h}
      />,
    );
    expect(screen.queryByText(line)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ما زلت أقرأ" }),
    ).not.toBeInTheDocument();

    rerender(
      <MainCard
        view={holdView({ openForHelp: false, canExtend: true, paceDays: null })}
        {...h}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "ما زلت أقرأ" }));
    expect(h.onStillReading).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(line)).not.toBeInTheDocument();

    rerender(
      <MainCard
        view={holdView({ openForHelp: true, canExtend: false, paceDays: null })}
        {...h}
      />,
    );
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ما زلت أقرأ" }),
    ).not.toBeInTheDocument();
    // finishing and releasing stay available after it opened
    expect(
      screen.getByRole("button", { name: "أتممتُ القراءة" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "لا أستطيع إكماله" }),
    ).toBeInTheDocument();
  });

  it.each([
    [1, "عادةً تُتمّ الجزء في نحو يوم"],
    [2, "عادةً تُتمّ الجزء في نحو يومين"],
    [3, "عادةً تُتمّ الجزء في نحو 3 أيام"],
    [7, "عادةً تُتمّ الجزء في نحو 7 أيام"],
    // the server decides the number; the client never clamps or rounds it
    [12, "عادةً تُتمّ الجزء في نحو 12 يوماً"],
  ])("pace of %s days shows its line", (paceDays, text) => {
    render(
      <MainCard
        view={holdView({ openForHelp: false, canExtend: false, paceDays })}
        {...handlers()}
      />,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("shows no pace line without a pace", () => {
    render(
      <MainCard
        view={holdView({
          openForHelp: false,
          canExtend: false,
          paceDays: null,
        })}
        {...handlers()}
      />,
    );
    expect(screen.queryByText(/عادةً/)).not.toBeInTheDocument();
  });
});

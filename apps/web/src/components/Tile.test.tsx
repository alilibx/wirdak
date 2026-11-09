import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tile } from "./Tile";

describe("Tile", () => {
  it("reading tile shows the reader name and is disabled", () => {
    render(
      <Tile
        tile={{
          juz: 15,
          name: "سبحان",
          state: "reading",
          readerName: "فاطمة",
          isMine: false,
        }}
        onTake={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /الجزء 15/ })).toBeDisabled();
    expect(screen.getByText("فاطمة")).toBeInTheDocument();
  });

  it("reading tile for a non-member shows the state word without a name", () => {
    render(
      <Tile
        tile={{
          juz: 3,
          name: "تلك الرسل",
          state: "reading",
          readerName: null,
          isMine: false,
        }}
        onTake={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /الجزء 3.*يُقرأ/ }),
    ).toBeDisabled();
  });

  it("my own reading tile says so", () => {
    render(
      <Tile
        tile={{
          juz: 8,
          name: "ولو أننا",
          state: "reading",
          readerName: "أنا",
          isMine: true,
        }}
        onTake={vi.fn()}
      />,
    );
    expect(screen.getByText("أنت تقرؤه")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "الجزء 8، ولو أننا، أنت تقرؤه" }),
    ).toBeDisabled();
  });

  it("done tile never shows a name", () => {
    render(
      <Tile
        tile={{
          juz: 2,
          name: "سيقول",
          state: "done",
          readerName: "خالد",
          isMine: false,
        }}
        onTake={vi.fn()}
      />,
    );
    expect(screen.queryByText("خالد")).not.toBeInTheDocument();
    expect(screen.getByText("تمّ ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /الجزء 2.*تمّ/ })).toBeDisabled();
  });

  it("open tile calls onTake with its juz", async () => {
    const onTake = vi.fn();
    render(
      <Tile
        tile={{
          juz: 14,
          name: "ربما",
          state: "open",
          readerName: null,
          isMine: false,
        }}
        onTake={onTake}
      />,
    );
    const button = screen.getByRole("button", { name: /الجزء 14.*متاح/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onTake).toHaveBeenCalledWith(14);
  });

  // At 390px a tile has about 90px inside; "أنت تقرؤه" is about 81px wide at 18px in Readex Pro.
  it("state word and reader name use the base text size and are never cut off mid-word", () => {
    render(
      <>
        <Tile
          tile={{
            juz: 2,
            name: "سيقول",
            state: "reading",
            readerName: null,
            isMine: true,
          }}
          onTake={vi.fn()}
        />
        <Tile
          tile={{
            juz: 15,
            name: "سبحان",
            state: "reading",
            readerName: "عبد الرحمن",
            isMine: false,
          }}
          onTake={vi.fn()}
        />
      </>,
    );
    const chip = screen.getAllByText("أنت تقرؤه").at(-1)!;
    expect(chip).toHaveClass("text-base");
    expect(chip).not.toHaveClass("truncate");
    const reader = screen.getByText("عبد الرحمن");
    expect(reader).toHaveClass("text-base");
    expect(reader).not.toHaveClass("truncate");
  });

  it("an open tile is pressable and invites it, until the khatma is archived", () => {
    const open = {
      juz: 4,
      name: "والمحصنات",
      state: "open" as const,
      readerName: null,
      isMine: false,
    };
    const { rerender } = render(<Tile tile={open} onTake={vi.fn()} />);
    const tile = () => screen.getByRole("button", { name: /الجزء 4/ });
    expect(tile()).toBeEnabled();
    expect(tile().className).toMatch(/hover:border-green/);
    rerender(<Tile tile={open} onTake={vi.fn()} readOnly />);
    expect(tile()).toBeDisabled();
    expect(tile().className).not.toMatch(/hover:|focus-visible:/);
  });
});

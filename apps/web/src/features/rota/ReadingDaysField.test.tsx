import type { ReadingDays } from "@convex/lib/rota";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ReadingDaysField } from "./ReadingDaysField";

function Harness({ onValue }: { onValue: (value: ReadingDays) => void }) {
  const [value, setValue] = useState<ReadingDays>({ kind: "daily" });
  onValue(value);
  return <ReadingDaysField value={value} onChange={setValue} />;
}

function renderField() {
  let latest: ReadingDays = { kind: "daily" };
  render(<Harness onValue={(value) => (latest = value)} />);
  return () => latest;
}

describe("ReadingDaysField", () => {
  it("offers three choices, every day chosen, and no chips", () => {
    renderField();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "كل يوم" })).toBeChecked();
    expect(screen.queryByRole("button", { name: "الجمعة" })).toBeNull();
  });

  it("every week opens the weekdays Saturday first, with Friday chosen", async () => {
    const user = userEvent.setup();
    const value = renderField();
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    expect(value()).toEqual({ kind: "weekly", weekdays: [5], everyWeeks: 1 });
    const names = [
      "السبت",
      "الأحد",
      "الاثنين",
      "الثلاثاء",
      "الأربعاء",
      "الخميس",
      "الجمعة",
    ];
    const chips = screen
      .getAllByRole("button")
      .filter((b) => names.includes(b.textContent ?? ""));
    expect(chips.map((b) => b.textContent)).toEqual(names);
    expect(screen.getByRole("button", { name: "الجمعة" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "السبت" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("adds and removes weekdays but never leaves none", async () => {
    const user = userEvent.setup();
    const value = renderField();
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(screen.getByRole("button", { name: "السبت" }));
    expect(value()).toEqual({
      kind: "weekly",
      weekdays: [5, 6],
      everyWeeks: 1,
    });
    await user.click(screen.getByRole("button", { name: "الجمعة" }));
    await user.click(screen.getByRole("button", { name: "السبت" }));
    expect(value()).toEqual({
      kind: "weekly",
      weekdays: [6],
      everyWeeks: 1,
    });
  });

  it("switches between every week and every two weeks", async () => {
    const user = userEvent.setup();
    const value = renderField();
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(screen.getByRole("button", { name: "كل أسبوعين" }));
    expect(value()).toEqual({ kind: "weekly", weekdays: [5], everyWeeks: 2 });
    await user.click(screen.getByRole("button", { name: "كل أسبوع" }));
    expect(value()).toEqual({ kind: "weekly", weekdays: [5], everyWeeks: 1 });
  });

  it("every month opens the days 1 to 31, day 1 chosen", async () => {
    const user = userEvent.setup();
    const value = renderField();
    await user.click(screen.getByRole("radio", { name: "كل شهر" }));
    expect(value()).toEqual({ kind: "monthly", days: [1] });
    const group = screen.getByRole("group", { name: "في أيام الشهر:" });
    expect(within(group).getAllByRole("button")).toHaveLength(31);
    await user.click(within(group).getByRole("button", { name: "15" }));
    expect(value()).toEqual({ kind: "monthly", days: [1, 15] });
  });

  it("going back to every day closes the chips", async () => {
    const user = userEvent.setup();
    const value = renderField();
    await user.click(screen.getByRole("radio", { name: "كل أسبوع" }));
    await user.click(screen.getByRole("radio", { name: "كل يوم" }));
    expect(value()).toEqual({ kind: "daily" });
    expect(screen.queryByRole("button", { name: "الجمعة" })).toBeNull();
  });
});

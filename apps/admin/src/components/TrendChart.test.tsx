import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TrendChart } from "./TrendChart";

const points = [
  { day: 20000, value: 3 },
  { day: 20001, value: null },
  { day: 20002, value: 7 },
];

describe("TrendChart", () => {
  it("draws a bar per day with data and leaves a gap for missing days", () => {
    const { container } = render(
      <TrendChart
        points={points}
        format={String}
        label="أجزاء"
        period="7 أيام"
      />,
    );
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-gap]")).toHaveLength(1);
  });

  it("sums itself up for screen readers with the latest value", () => {
    render(
      <TrendChart
        points={points}
        format={(v) => `${v} جزء`}
        label="أجزاء"
        period="7 أيام"
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(/7 جزء/);
  });

  it("shows a day's value on hover", async () => {
    const { container } = render(
      <TrendChart
        points={points}
        format={(v) => `${v} جزء`}
        label="أجزاء"
        period="7 أيام"
      />,
    );
    const target = container.querySelectorAll("[data-hit]")[2] as Element;
    await userEvent.hover(target);
    expect(screen.getByRole("status")).toHaveTextContent("7 جزء");
  });

  it("says when there's nothing yet", () => {
    render(
      <TrendChart
        points={[{ day: 1, value: null }]}
        format={String}
        label="x"
        period="y"
      />,
    );
    expect(screen.getByText("لا بيانات بعد")).toBeInTheDocument();
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  BottomBarProvider,
  useBottomBarHidden,
} from "../features/nav/bottomBarUi";
import { makeTiles } from "../test/fixtures";
import { CelebrationPage } from "./CelebrationPage";

function setup(over: Partial<Parameters<typeof CelebrationPage>[0]> = {}) {
  const onContinue = vi.fn();
  render(
    <CelebrationPage
      title="ختمة العائلة"
      round={12}
      participants={7}
      tiles={makeTiles({ 4: { state: "reading", readerName: "سارة" } })}
      busy={false}
      onContinue={onContinue}
      {...over}
    />,
  );
  return { onContinue };
}

function BarProbe() {
  return <p>{useBottomBarHidden() ? "bar hidden" : "bar shown"}</p>;
}

describe("CelebrationPage", () => {
  it("hides the bottom bar while it shows", () => {
    render(
      <BottomBarProvider>
        <BarProbe />
        <CelebrationPage
          title="ختمة العائلة"
          round={12}
          participants={7}
          tiles={makeTiles()}
          busy={false}
          onContinue={vi.fn()}
        />
      </BottomBarProvider>,
    );
    expect(screen.getByText("bar hidden")).toBeInTheDocument();
  });

  it("shows the heading, the subtitle and the participant count in Western digits", () => {
    setup();
    expect(
      screen.getByRole("heading", { level: 1, name: "ختمنا القرآن معاً" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("الحمد لله، ختمة العائلة، الختمة 12"),
    ).toBeInTheDocument();
    expect(screen.getByText("شارك فيها 7 من أحبابك")).toBeInTheDocument();
  });

  it("omits the participant line when there is no count", () => {
    setup({ participants: null });
    expect(screen.queryByText(/شارك فيها/)).not.toBeInTheDocument();
  });

  it("shows a gold ring with every bead done, whatever the tiles say", () => {
    setup();
    expect(screen.getByRole("img")).toHaveAttribute(
      "aria-label",
      "تمّ 30 من 30 جزءاً",
    );
  });

  it("shows both duas in the Quran font with their references", () => {
    setup();
    const first = screen.getByText(/رَبَّنَا تَقَبَّلْ/);
    const second = screen.getByText(/ءَاتِنَا/);
    for (const dua of [first, second]) {
      expect(dua).toHaveClass("font-quran");
      expect(dua).toHaveAttribute("lang", "ar");
    }
    expect(screen.getByText("البقرة 127")).toBeInTheDocument();
    expect(screen.getByText("البقرة 201")).toBeInTheDocument();
  });

  it("shares on WhatsApp with a message that names nobody", () => {
    setup();
    const link = screen.getByRole("link", { name: "شارك الفرحة على واتساب" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = decodeURIComponent(href.split("text=")[1] ?? "");
    expect(text).toContain("ختمنا القرآن معاً");
    expect(text).toContain("12");
    expect(text).not.toContain("سارة");
    expect(text).not.toContain("ختمة العائلة");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("continues through the labelled button, and disables it while busy", async () => {
    const { onContinue } = setup();
    await userEvent.click(
      screen.getByRole("button", { name: "تابع إلى الختمة" }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("disables continue while busy", () => {
    setup({ busy: true });
    expect(
      within(document.body).getByRole("button", { name: "تابع إلى الختمة" }),
    ).toBeDisabled();
  });
});

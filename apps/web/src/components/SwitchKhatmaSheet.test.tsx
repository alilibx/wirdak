import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { SwitchKhatmaSheet } from "./SwitchKhatmaSheet";

const card = (over: object = {}) => ({
  kind: "pool" as const,
  inviteCode: "A",
  name: "ختمة العائلة",
  createdAt: Date.UTC(2026, 9, 20, 12),
  schedule: "weekly" as const,
  done: 18,
  holding: null as number | null,
  hasNote: false,
  archived: false,
  peopleCount: null,
  ...over,
});

const khatmas = [
  card({ holding: 12 }),
  card({ inviteCode: "B", name: "ختمة الزملاء", done: 7, hasNote: true }),
  card({ inviteCode: "C", name: null, done: 27 }),
];

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function setup(currentCode = "A", list = khatmas) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={[`/j/${currentCode}`]}>
      <Routes>
        <Route
          path="*"
          element={
            <SwitchKhatmaSheet
              khatmas={list}
              currentCode={currentCode}
              onClose={onClose}
            />
          }
        />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
  return { onClose };
}

const current = () =>
  screen.getAllByRole("link").filter((l) => l.hasAttribute("aria-current"));

describe("SwitchKhatmaSheet", () => {
  it("is a dialog titled اختر ختمة", () => {
    setup();
    expect(
      screen.getByRole("dialog", { name: t.nav.switchTitle }),
    ).toBeInTheDocument();
  });

  it("lists every khatma with progress, the held juz' and the note dot", () => {
    setup();
    const family = screen.getByRole("link", { name: /ختمة العائلة/ });
    expect(family).toHaveTextContent(t.home.doneOf("١٨", "٣٠"));
    expect(family).toHaveTextContent(/جزؤك: الجزء ١٢/);
    const work = screen.getByRole("link", { name: /ختمة الزملاء/ });
    expect(work).toHaveTextContent(t.notes.newMessage);
    expect(family).not.toHaveTextContent(t.notes.newMessage);
    // No name: the same dated fallback as home.
    expect(
      screen.getByRole("link", { name: /^ختمة .*أكتوبر/ }),
    ).toHaveAttribute("href", "/j/C");
  });

  it("marks the current khatma", () => {
    setup("A");
    expect(current()).toHaveLength(1);
    expect(current()[0]).toHaveAttribute("href", "/j/A");
    expect(current()[0]).toHaveAttribute("aria-current", "page");
  });

  it("marks nothing when the current khatma is missing", () => {
    setup("GONE", khatmas);
    expect(current()).toHaveLength(0);
  });

  it("links other khatmas to their page and closes", async () => {
    const { onClose } = setup("A");
    const work = screen.getByRole("link", { name: /ختمة الزملاء/ });
    expect(work).toHaveAttribute("href", "/j/B");
    await userEvent.click(work);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/j/B");
  });

  it("tapping the current khatma only closes", async () => {
    const { onClose } = setup("A");
    await userEvent.click(current()[0]!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/j/A");
  });

  it("offers to start a new khatma", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("link", { name: t.home.startNewPlain }),
    ).toHaveAttribute("href", "/new");
  });

  it("closes with its labelled button", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: t.sheet.close }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a rotating khatma's row reads «ختمة بالتناوب» with today's count", () => {
    setup("A", [card(), card({ kind: "rota", inviteCode: "R", done: 26 })]);
    const row = screen.getByRole("link", {
      name: /ختمة العائلة/,
      current: false,
    });
    expect(row).toHaveTextContent("ختمة بالتناوب، ٢٦ من ٣٠ اليوم");
  });

  it("leaves archived khatmas out", () => {
    setup("A", [
      card(),
      card({ inviteCode: "B", name: "ختمة قديمة", archived: true }),
    ]);
    expect(screen.queryByText("ختمة قديمة")).toBeNull();
    expect(screen.getByText("ختمة العائلة")).toBeInTheDocument();
  });

  it("on an archived khatma, offers the active ones and marks none current", () => {
    setup("B", [
      card(),
      card({ inviteCode: "B", name: "ختمة قديمة", archived: true }),
    ]);
    expect(screen.queryByText("ختمة قديمة")).toBeNull();
    expect(current()).toHaveLength(0);
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NoteKind, NoteView } from "@convex/notes";
import { describe, expect, it, vi } from "vitest";
import { t } from "../i18n/ar";
import { makeTiles } from "../test/fixtures";
import { NoteCard, takeTarget } from "./NoteCard";

const note = (over: Partial<NoteView> = {}): NoteView => ({
  noteId: "n1" as NoteView["noteId"],
  kind: "almostUp",
  juz: [12],
  count: null,
  until: null,
  createdAt: 1,
  ...over,
});

const handlers = () => ({
  onStillReading: vi.fn(),
  onFinish: vi.fn(),
  onRelease: vi.fn(),
  onTake: vi.fn(),
  onInvite: vi.fn(),
  onDismiss: vi.fn(),
});

const names = () => screen.getAllByRole("button").map((b) => b.textContent);

describe("NoteCard", () => {
  it("almostUp card offers still reading, finished, and can't finish", async () => {
    const h = handlers();
    render(<NoteCard note={note()} takeJuz={null} {...h} />);
    expect(
      screen.getByText(
        "مهلة الجزء 12 أوشكت على الانتهاء. هل تحتاج وقتاً أطول؟",
      ),
    ).toBeInTheDocument();
    expect(names()).toEqual([
      "ما زلت أقرأ",
      "أتممت القراءة",
      "لا أستطيع إكماله",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "ما زلت أقرأ" }));
    await userEvent.click(
      screen.getByRole("button", { name: "أتممت القراءة" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "لا أستطيع إكماله" }),
    );
    expect(h.onStillReading).toHaveBeenCalledTimes(1);
    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.onRelease).toHaveBeenCalledTimes(1);
  });

  it("the can't-finish button is the smaller one, never as tall as the others", () => {
    render(<NoteCard note={note()} takeJuz={null} {...handlers()} />);
    const small = screen.getByRole("button", { name: "لا أستطيع إكماله" });
    const main = screen.getByRole("button", { name: "أتممت القراءة" });
    expect(small.className).not.toBe(main.className);
    // still a 56px target
    expect(small.className).toMatch(/min-h-14/);
  });

  it("openForHelp card offers take, invite, and ok", async () => {
    const h = handlers();
    render(
      <NoteCard
        note={note({ kind: "openForHelp", juz: [12, 15] })}
        takeJuz={12}
        {...h}
      />,
    );
    expect(names()).toEqual(["خذ الجزء", "أرسل الدعوة", "حسناً"]);
    await userEvent.click(screen.getByRole("button", { name: "خذ الجزء" }));
    await userEvent.click(screen.getByRole("button", { name: "أرسل الدعوة" }));
    await userEvent.click(screen.getByRole("button", { name: "حسناً" }));
    expect(h.onTake).toHaveBeenCalledWith(12);
    expect(h.onInvite).toHaveBeenCalledTimes(1);
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("openForHelp card has no take button when nothing can be taken", () => {
    render(
      <NoteCard
        note={note({ kind: "openForHelp" })}
        takeJuz={null}
        {...handlers()}
      />,
    );
    expect(names()).toEqual(["أرسل الدعوة", "حسناً"]);
  });

  it("behind card offers take and ok", async () => {
    const h = handlers();
    render(
      <NoteCard
        note={note({ kind: "behind", juz: [], count: 6 })}
        takeJuz={4}
        {...h}
      />,
    );
    expect(names()).toEqual(["خذ جزءاً", "حسناً"]);
    await userEvent.click(screen.getByRole("button", { name: "خذ جزءاً" }));
    await userEvent.click(screen.getByRole("button", { name: "حسناً" }));
    expect(h.onTake).toHaveBeenCalledWith(4);
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
  });

  it.each<NoteKind>([
    "thanks",
    "reminder",
    "completed",
    "nowOrganizer",
    "organizerMoved",
  ])("%s card only offers ok", async (kind) => {
    const h = handlers();
    render(<NoteCard note={note({ kind })} takeJuz={null} {...h} />);
    expect(names()).toEqual(["حسناً"]);
    await userEvent.click(screen.getByRole("button", { name: "حسناً" }));
    expect(h.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders the note text from the shared copy", () => {
    const n = note({ kind: "thanks", juz: [12] });
    render(<NoteCard note={n} takeJuz={null} {...handlers()} />);
    expect(screen.getByText(t.notes.text(n))).toBeInTheDocument();
  });
});

describe("takeTarget", () => {
  const tiles = makeTiles({ 12: { state: "reading" }, 15: { state: "done" } });

  it("openForHelp: the lowest listed juz' that is still open", () => {
    const n = note({ kind: "openForHelp", juz: [20, 15, 12, 18] });
    expect(takeTarget(n, tiles, null, null)).toBe(18);
  });

  it("openForHelp: nothing when none of them is open any more", () => {
    const n = note({ kind: "openForHelp", juz: [12, 15] });
    expect(takeTarget(n, tiles, null, null)).toBeNull();
  });

  it("behind: the suggestion, else the first open juz'", () => {
    const n = note({ kind: "behind", juz: [] });
    expect(takeTarget(n, tiles, null, 7)).toBe(7);
    expect(takeTarget(n, tiles, null, null)).toBe(1);
  });

  it("nothing can be taken while holding a juz'", () => {
    const n = note({ kind: "behind", juz: [] });
    expect(takeTarget(n, tiles, 5, 7)).toBeNull();
    expect(
      takeTarget(note({ kind: "openForHelp", juz: [18] }), tiles, 5, null),
    ).toBeNull();
  });
});

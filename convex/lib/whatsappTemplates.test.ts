import { expect, test } from "vitest";
import type { NoteKind } from "./noteText";
import {
  buttonSuffix,
  khatmaTitle,
  noteTemplate,
  OPEN_FOR_HELP_MANY,
} from "./whatsappTemplates";

// Thursday 2026-10-29 08:00 in Dubai
const NOW = Date.UTC(2026, 9, 29, 4, 0);
const DAY = 86_400_000;
const khatma = { name: "ختمة رمضان", createdAt: NOW, inviteCode: "AB12CD" };
const note = (kind: NoteKind, juz = [12]) => ({
  kind,
  juz,
  count: null,
  until: null,
});
const rotaNote = (
  kind: NoteKind,
  fields: { juz?: number[]; count?: number; name?: string },
) => ({
  kind,
  juz: fields.juz ?? [],
  count: fields.count ?? null,
  until: null,
  name: fields.name ?? null,
});

test("every note kind maps to its template and body values", () => {
  const cases: [NoteKind, string, string[]][] = [
    ["almostUp", "wirdak_almost_up", ["١٢"]],
    ["openForHelp", "wirdak_open_for_help_v3", ["١٢"]],
    ["thanks", "wirdak_juz_helped", ["١٢"]],
    ["reminder", "wirdak_reminder_v2", ["١٢"]],
    ["completed", "wirdak_completed_v2", []],
    ["nowOrganizer", "wirdak_now_organizer_v2", []],
    ["organizerMoved", "wirdak_organizer_moved_v2", []],
  ];
  for (const [kind, name, body] of cases) {
    expect(noteTemplate(note(kind), khatma, "https://wirdak.app", NOW)).toEqual(
      {
        name,
        header: "ختمة رمضان",
        body,
        buttonParam: "j/AB12CD",
      },
    );
  }
});

test("the organizer's rota notes go out as templates with the open button", () => {
  const send = (n: ReturnType<typeof rotaNote>) =>
    noteTemplate(n, khatma, "https://wirdak.app", NOW);
  expect(send(rotaNote("rotaUnread", { juz: [5, 6] }))).toEqual({
    name: "wirdak_rota_unread",
    header: "ختمة رمضان",
    body: ["الجزأين ٥ و٦"],
    buttonParam: "j/AB12CD",
  });
  expect(send(rotaNote("rotaUnread", { juz: [26] }))?.body).toEqual([
    "الجزء ٢٦",
  ]);
  expect(send(rotaNote("rotaUnread", { juz: [3, 5, 6] }))?.body).toEqual([
    "الأجزاء ٣، ٥ و٦",
  ]);
  expect(send(rotaNote("rotaSummary", { count: 24 }))).toEqual({
    name: "wirdak_rota_summary",
    header: "ختمة رمضان",
    body: ["٢٤"],
    buttonParam: "j/AB12CD",
  });
  expect(send(rotaNote("rotaJoinRequest", { name: "أحمد" }))).toEqual({
    name: "wirdak_rota_join_request",
    header: "ختمة رمضان",
    body: ["أحمد"],
    buttonParam: "j/AB12CD",
  });
});

test("notes about a participant's own messages stay off WhatsApp", () => {
  for (const kind of [
    "rotaSilent",
    "rotaSilenced",
    "rotaStopped",
    "rotaEnabled",
    "coOrganizerNow",
  ] as const) {
    expect(
      noteTemplate(
        rotaNote(kind, { name: "أحمد", count: 3 }),
        khatma,
        "https://wirdak.app",
        NOW,
      ),
    ).toBeNull();
  }
});

test("open for help with several ajza' uses the plural template", () => {
  const t = noteTemplate(
    note("openForHelp", [3, 12, 15]),
    khatma,
    "https://wirdak.app",
    NOW,
  );
  expect(t?.name).toBe(OPEN_FOR_HELP_MANY);
  expect(t?.body).toEqual(["٣، ١٢ و١٥"]);
});

test("behind never goes to WhatsApp", () => {
  expect(
    noteTemplate(
      { kind: "behind", juz: [], count: 3, until: NOW + 2 * DAY },
      khatma,
      "https://wirdak.app",
      NOW,
    ),
  ).toBeNull();
});

test("khatmaTitle: the name as one clean line, or the untitled date", () => {
  expect(khatmaTitle({ name: "ختمة\n  الوالدة\t", createdAt: NOW })).toBe(
    "ختمة الوالدة",
  );
  expect(khatmaTitle({ name: null, createdAt: NOW })).toBe(
    "ختمة الخميس، ٢٩ أكتوبر",
  );
  expect(khatmaTitle({ name: "ا".repeat(80), createdAt: NOW })).toHaveLength(
    60,
  );
});

test("buttonSuffix routes staging links through the /stg/ redirect", () => {
  expect(buttonSuffix("AB12", "https://stg.wirdak.app")).toBe("stg/j/AB12");
  expect(buttonSuffix("AB12", "https://wirdak.app")).toBe("j/AB12");
  expect(buttonSuffix("AB12", "http://localhost:5173")).toBe("j/AB12");
});

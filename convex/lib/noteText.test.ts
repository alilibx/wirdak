import { expect, test } from "vitest";
import { juzPhrase, juzPhraseGenitive, noteText } from "./noteText";

const NOW = 1_800_000_000_000; // Friday 2027-01-15, midday in Asia/Dubai
const DAY = 86_400_000;

const base = { juz: [], count: null, until: null };

test("noteText covers every kind in Western digits", () => {
  expect(noteText({ ...base, kind: "almostUp", juz: [12] })).toBe(
    "مهلة الجزء 12 أوشكت على الانتهاء. هل تحتاج وقتاً أطول؟",
  );
  expect(noteText({ ...base, kind: "openForHelp", juz: [12] })).toBe(
    "الجزء 12 متاح لمن يساعد. هل تأخذه أو ترسل الدعوة؟",
  );
  expect(noteText({ ...base, kind: "openForHelp", juz: [12, 15] })).toBe(
    "الأجزاء 12 و15 متاحة لمن يساعد. هل تأخذ أحدها أو ترسل الدعوة؟",
  );
  expect(
    noteText({ ...base, kind: "openForHelp", juz: [3, 12, 15] }),
  ).toContain("3، 12 و15");
  expect(noteText({ ...base, kind: "thanks", juz: [7] })).toBe(
    "أحدهم يُكمل الجزء 7 الآن. جزاكما الله خيراً.",
  );
  expect(noteText({ ...base, kind: "reminder", juz: [30] })).toBe(
    "الجزء 30 في انتظارك، يسّر الله لك.",
  );
  expect(noteText({ ...base, kind: "completed" })).toBe(
    "ختمنا القرآن معاً، الحمد لله",
  );
  expect(noteText({ ...base, kind: "nowOrganizer" })).toBe(
    "أصبحتَ منظّم هذه الختمة. جزاك الله خيراً.",
  );
  expect(noteText({ ...base, kind: "organizerMoved" })).toBe(
    "مرّ وقت منذ زيارتك، فنقلنا تنظيم الختمة إلى أحد أعضائها ليستمر الخير. ما زلت عضواً فيها.",
  );
});

test("behind agrees the count with the noun", () => {
  const text = (count: number) =>
    noteText({ ...base, kind: "behind", count }, NOW);
  expect(text(1)).toBe("الختمة تحتاج جزءاً واحداً. هل تأخذ جزءاً؟");
  expect(text(2)).toContain("جزأين");
  expect(text(3)).toContain("3 أجزاء");
  expect(text(10)).toContain("10 أجزاء");
  expect(text(11)).toContain("11 جزءاً");
  expect(text(12)).toContain("12 جزءاً");
});

test("behind names the weekday within 6 days, the date beyond, and nothing once passed", () => {
  const text = (until: number) =>
    noteText({ ...base, kind: "behind", count: 2, until }, NOW);
  expect(text(NOW + 2 * DAY)).toBe(
    "الختمة تحتاج جزأين قبل الأحد. هل تأخذ جزءاً؟",
  );
  expect(text(NOW + 6 * DAY)).toContain("قبل الخميس");
  expect(text(NOW + 10 * DAY)).toBe(
    "الختمة تحتاج جزأين قبل 25 يناير. هل تأخذ جزءاً؟",
  );
  expect(text(NOW - DAY)).toBe("الختمة تحتاج جزأين. هل تأخذ جزءاً؟");
  expect(text(NOW)).toBe("الختمة تحتاج جزأين. هل تأخذ جزءاً؟");
});

test("the rota participant notes name them and count days in Western digits", () => {
  const input = { ...base, name: "أحمد" };
  expect(noteText({ ...input, kind: "rotaJoinRequest" })).toBe(
    "طلب انضمام من أحمد.",
  );
  expect(noteText({ ...input, kind: "rotaSilent", count: 3 })).toBe(
    "لم يردّ أحمد منذ 3 أيام.",
  );
  expect(noteText({ ...input, kind: "rotaSilent", count: 12 })).toBe(
    "لم يردّ أحمد منذ 12 يوماً.",
  );
  expect(noteText({ ...input, kind: "rotaSilenced" })).toBe(
    "أوقفنا رسائل الختمة إلى أحمد لأنه لم يردّ منذ مدة.",
  );
  expect(noteText({ ...input, kind: "rotaStopped" })).toBe(
    "أوقف أحمد رسائل الختمة.",
  );
});

test("the coOrganizerNow note tells a named person their new role", () => {
  expect(noteText({ ...base, kind: "coOrganizerNow" })).toBe(
    "أصبحت منظّماً مساعداً في هذه الختمة",
  );
});

test("the rotaEnabled note tells the organizer what they can now do", () => {
  expect(noteText({ ...base, kind: "rotaEnabled" })).toBe(
    "جديد لك: يمكنك الآن إنشاء ختمة بالتناوب: لكل شخص جزء ثابت يتقدّم مع كل ختمة، ويصله على واتساب.",
  );
});

test("the juz' phrase agrees with one, two and three or more ajza'", () => {
  expect(juzPhrase([26])).toBe("الجزء 26");
  expect(juzPhrase([5, 6])).toBe("الجزآن 5 و6");
  expect(juzPhrase([3, 5, 6])).toBe("الأجزاء 3، 5 و6");
});

test("the genitive phrase differs only in the dual", () => {
  expect(juzPhraseGenitive([26])).toBe("الجزء 26");
  expect(juzPhraseGenitive([5, 6])).toBe("الجزأين 5 و6");
  expect(juzPhraseGenitive([3, 5, 6])).toBe("الأجزاء 3، 5 و6");
});

test("both phrases are empty, with no stray space, for no ajza'", () => {
  expect(juzPhrase([])).toBe("");
  expect(juzPhraseGenitive([])).toBe("");
});

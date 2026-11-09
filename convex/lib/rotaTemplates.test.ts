import { expect, test } from "vitest";
import { DUAS } from "./duas";
import {
  alreadyText,
  assignedTemplate,
  assignedText,
  clockText,
  closedText,
  completeTemplate,
  coveredTemplate,
  cycleTemplate,
  duaText,
  helpText,
  juzTemplate,
  juzText,
  notOnListText,
  notYetText,
  reminderTemplate,
  reminderText,
  ROTA_BUTTONS,
  stopText,
  thanksText,
  unknownJoinText,
  weekdayText,
  welcomeText,
  whichKhatmaText,
} from "./rotaTemplates";

const khatma = { name: "ختمة العائلة", createdAt: 0 };
const payloads = { done: "r1|p|done|d|x", notYet: "r1|p|notYet|d|x" };

// One, two and three ajza': the subject of the sentence is always «قراءة» or
// «قراءتك», so the juz' phrase never has to agree with a verb.
const one = [26];
const two = [5, 6];
const three = [3, 5, 6];

test("the juz' template: title header, khatma number and juz' (nominative), two reply payloads in order", () => {
  const body = (juz: number[]) => juzTemplate(khatma, juz, 12, payloads).body;
  expect(juzTemplate(khatma, two, 12, payloads)).toEqual({
    name: "wirdak_rota_juz_v2",
    header: "ختمة العائلة",
    body: ["12", "الجزآن 5 و6"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(one)).toEqual(["12", "الجزء 26"]);
  expect(body(three)).toEqual(["12", "الأجزاء 3، 5 و6"]);
});

test("the reminder template: the juz' phrase is genitive, after «قراءة»", () => {
  const body = (juz: number[]) => reminderTemplate(khatma, juz, payloads).body;
  expect(reminderTemplate(khatma, one, payloads)).toEqual({
    name: "wirdak_rota_reminder",
    header: "ختمة العائلة",
    body: ["الجزء 26"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(two)).toEqual(["الجزأين 5 و6"]);
  expect(body(three)).toEqual(["الأجزاء 3، 5 و6"]);
});

test("the assigned template puts the genitive juz' before the khatma number", () => {
  const body = (juz: number[]) =>
    assignedTemplate(khatma, juz, 7, payloads).body;
  expect(assignedTemplate(khatma, three, 7, payloads)).toEqual({
    name: "wirdak_rota_assigned_v2",
    header: "ختمة العائلة",
    body: ["الأجزاء 3، 5 و6", "7"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(one)).toEqual(["الجزء 26", "7"]);
  expect(body(two)).toEqual(["الجزأين 5 و6", "7"]);
});

test("the covered template has no buttons", () => {
  const body = (juz: number[]) => coveredTemplate(khatma, juz).body;
  expect(coveredTemplate(khatma, one)).toEqual({
    name: "wirdak_rota_covered_v2",
    header: "ختمة العائلة",
    body: ["الجزء 26"],
  });
  expect(body(two)).toEqual(["الجزأين 5 و6"]);
  expect(body(three)).toEqual(["الأجزاء 3، 5 و6"]);
});

test("the complete template carries the dua payload as its one button", () => {
  expect(completeTemplate(khatma, 30, "r1|p|dua|d|x")).toEqual({
    name: "wirdak_rota_complete",
    header: "ختمة العائلة",
    body: ["30"],
    quickReplies: ["r1|p|dua|d|x"],
  });
});

test("the cycle template has a header and no parameters or buttons", () => {
  expect(cycleTemplate(khatma)).toEqual({
    name: "wirdak_rota_cycle",
    header: "ختمة العائلة",
    body: [],
  });
});

test("the juz', reminder and assigned messages name each juz' partner", () => {
  const partners = new Map([[5, "سارة"]]);
  expect(juzTemplate(khatma, two, 12, payloads, partners).body).toEqual([
    "12",
    "الجزآن 5 (مشترك مع سارة) و6",
  ]);
  expect(reminderTemplate(khatma, two, payloads, partners).body).toEqual([
    "الجزأين 5 (مشترك مع سارة) و6",
  ]);
  expect(assignedTemplate(khatma, two, 7, payloads, partners).body).toEqual([
    "الجزأين 5 (مشترك مع سارة) و6",
    "7",
  ]);
  expect(juzText(one, true, new Map([[26, "سارة"]]))).toBe(
    "السلام عليكم، جزؤكم اليوم هو 26 (مشترك مع سارة). انقروا «أتممت» بعد القراءة.",
  );
  expect(juzText(two, false, partners)).toBe(
    "أجزاؤكم اليوم هي 5 (مشترك مع سارة) و6. انقروا «أتممت» بعد القراءة.",
  );
  expect(juzText(three, true, new Map([[6, "سارة"]]))).toBe(
    "السلام عليكم، أجزاؤكم اليوم هي 3، 5 و6 (مشترك مع سارة). انقروا «أتممت» بعد القراءة.",
  );
  expect(reminderText(one, new Map([[26, "سارة"]]))).toBe(
    "تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة الجزء 26 (مشترك مع سارة) في هذه الختمة.",
  );
  expect(assignedText(two, 7, partners)).toBe(
    "تحديث على قراءتك: سُجِّلت لك قراءة الجزأين 5 (مشترك مع سارة) و6 في الختمة 7 لهذا اليوم.",
  );
});

test("the longest juz' phrase with partners fits a template parameter", () => {
  const name = "ن".repeat(60);
  const partners = new Map(three.map((j) => [j, name]));
  const params = [
    ...juzTemplate(khatma, three, 30, payloads, partners).body!,
    ...reminderTemplate(khatma, three, payloads, partners).body!,
    ...assignedTemplate(khatma, three, 30, payloads, partners).body!,
  ];
  for (const param of params) {
    expect(param.length).toBeLessThan(1024);
    expect(param).not.toMatch(/\n/);
  }
  expect(params[1]).toContain(name);
});

test("an unnamed khatma gets the untitled-date header", () => {
  expect(cycleTemplate({ name: null, createdAt: 0 }).header).toMatch(/^ختمة /);
});

test("welcome text names the day and time of the next message, if any", () => {
  expect(
    welcomeText("أحمد", "ختمة العائلة", { weekday: "الخميس", time: "8:00 ص" }),
  ).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة. تصلك رسالة جزئك يوم الخميس الساعة 8:00 ص.",
  );
  expect(welcomeText("أحمد", "ختمة العائلة", null)).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة.",
  );
  // before the organizer finished setting the khatma up, no day is promised
  expect(welcomeText("أحمد", "ختمة العائلة", "notStarted")).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة. تصلك رسالة جزئك حين يبدأ المنظّم الختمة.",
  );
});

test("the free texts use Western digits", () => {
  expect(juzText(one)).toBe(
    "السلام عليكم، جزؤكم اليوم هو 26. انقروا «أتممت» بعد القراءة.",
  );
  expect(juzText(two)).toBe(
    "السلام عليكم، أجزاؤكم اليوم هي 5 و6. انقروا «أتممت» بعد القراءة.",
  );
  expect(juzText(three)).toBe(
    "السلام عليكم، أجزاؤكم اليوم هي 3، 5 و6. انقروا «أتممت» بعد القراءة.",
  );
  expect(juzText(one, false)).toBe(
    "جزؤكم اليوم هو 26. انقروا «أتممت» بعد القراءة.",
  );
  expect(reminderText(two)).toBe(
    "تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة الجزأين 5 و6 في هذه الختمة.",
  );
  expect(assignedText(three, 7)).toBe(
    "تحديث على قراءتك: سُجِّلت لك قراءة الأجزاء 3، 5 و6 في الختمة 7 لهذا اليوم.",
  );
  expect(thanksText(12)).toBe("تقبّل الله منك. 12 من 30 جزءاً تمّت اليوم.");
  expect(notYetText("4:00 م")).toBe("لا بأس، نذكّرك الساعة 4:00 م.");
  expect(notYetText(null)).toBe("لا بأس.");
});

test("the fixed texts", () => {
  expect(alreadyText).toBe("سجّلنا قراءتك من قبل.");
  expect(closedText).toBe("انتهى يوم هذه الختمة.");
  expect(notOnListText).toBe("أرسلنا طلبك إلى منظّم الختمة، ونخبرك حين يضيفك.");
  expect(stopText).toBe(
    "أوقفنا رسائل الختمة لك. لتعود إليها أرسل رسالة الانضمام مرة أخرى.",
  );
  expect(helpText).toBe("اضغط «أتممت» أو «ليس بعد» في رسالة جزئك.");
  expect(whichKhatmaText).toBe("لأي ختمة؟");
  expect(unknownJoinText).toBe(
    "لم نجد هذه الختمة. تأكّد من الرابط مع منظّم الختمة.",
  );
  expect(ROTA_BUTTONS).toEqual({
    done: "أتممت",
    notYet: "ليس بعد",
    dua: "دعاء الختم",
  });
});

test("the dua text holds both duas verbatim, with references", () => {
  const text = duaText();
  for (const dua of DUAS) {
    expect(text).toContain(dua.text);
    expect(text).toContain(dua.ref);
  }
  expect(text.indexOf(DUAS[0].text)).toBeLessThan(text.indexOf(DUAS[1].text));
});

test("clockText reads a time of day in 12 hours with its part of the day", () => {
  expect(clockText(480)).toBe("8 صباحاً");
  expect(clockText(510)).toBe("8:30 صباحاً");
  expect(clockText(0)).toBe("12 صباحاً");
  expect(clockText(720)).toBe("12 ظهراً");
  expect(clockText(960)).toBe("4 عصراً");
  expect(clockText(1245)).toBe("8:45 مساءً");
});

test("weekdayText names the weekday of a date", () => {
  expect(weekdayText("2027-01-16")).toBe("السبت");
  expect(weekdayText("2027-01-17")).toBe("الأحد");
  expect(weekdayText("2027-01-22")).toBe("الجمعة");
});

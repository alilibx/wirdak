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
    body: ["١٢", "الجزآن ٥ و٦"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(one)).toEqual(["١٢", "الجزء ٢٦"]);
  expect(body(three)).toEqual(["١٢", "الأجزاء ٣، ٥ و٦"]);
});

test("the reminder template: the juz' phrase is genitive, after «قراءة»", () => {
  const body = (juz: number[]) => reminderTemplate(khatma, juz, payloads).body;
  expect(reminderTemplate(khatma, one, payloads)).toEqual({
    name: "wirdak_rota_reminder",
    header: "ختمة العائلة",
    body: ["الجزء ٢٦"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(two)).toEqual(["الجزأين ٥ و٦"]);
  expect(body(three)).toEqual(["الأجزاء ٣، ٥ و٦"]);
});

test("the assigned template puts the genitive juz' before the khatma number", () => {
  const body = (juz: number[]) =>
    assignedTemplate(khatma, juz, 7, payloads).body;
  expect(assignedTemplate(khatma, three, 7, payloads)).toEqual({
    name: "wirdak_rota_assigned_v2",
    header: "ختمة العائلة",
    body: ["الأجزاء ٣، ٥ و٦", "٧"],
    quickReplies: [payloads.done, payloads.notYet],
  });
  expect(body(one)).toEqual(["الجزء ٢٦", "٧"]);
  expect(body(two)).toEqual(["الجزأين ٥ و٦", "٧"]);
});

test("the covered template has no buttons", () => {
  const body = (juz: number[]) => coveredTemplate(khatma, juz).body;
  expect(coveredTemplate(khatma, one)).toEqual({
    name: "wirdak_rota_covered_v2",
    header: "ختمة العائلة",
    body: ["الجزء ٢٦"],
  });
  expect(body(two)).toEqual(["الجزأين ٥ و٦"]);
  expect(body(three)).toEqual(["الأجزاء ٣، ٥ و٦"]);
});

test("the complete template carries the dua payload as its one button", () => {
  expect(completeTemplate(khatma, 30, "r1|p|dua|d|x")).toEqual({
    name: "wirdak_rota_complete",
    header: "ختمة العائلة",
    body: ["٣٠"],
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
    "١٢",
    "الجزآن ٥ (مشترك مع سارة) و٦",
  ]);
  expect(reminderTemplate(khatma, two, payloads, partners).body).toEqual([
    "الجزأين ٥ (مشترك مع سارة) و٦",
  ]);
  expect(assignedTemplate(khatma, two, 7, payloads, partners).body).toEqual([
    "الجزأين ٥ (مشترك مع سارة) و٦",
    "٧",
  ]);
  expect(juzText(3, one, new Map([[26, "سارة"]]))).toBe(
    "تحديث على قراءتك اليوم في الختمة ٣: المسجَّل لك الجزء ٢٦ (مشترك مع سارة) من هذه الختمة.",
  );
  expect(reminderText(one, new Map([[26, "سارة"]]))).toBe(
    "تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة الجزء ٢٦ (مشترك مع سارة) في هذه الختمة.",
  );
  expect(assignedText(two, 7, partners)).toBe(
    "تحديث على قراءتك: سُجِّلت لك قراءة الجزأين ٥ (مشترك مع سارة) و٦ في الختمة ٧ لهذا اليوم.",
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
    welcomeText("أحمد", "ختمة العائلة", { weekday: "الخميس", time: "٨:٠٠ ص" }),
  ).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة. تصلك رسالة جزئك يوم الخميس الساعة ٨:٠٠ ص.",
  );
  expect(welcomeText("أحمد", "ختمة العائلة", null)).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة.",
  );
  // before the organizer finished setting the khatma up, no day is promised
  expect(welcomeText("أحمد", "ختمة العائلة", "notStarted")).toBe(
    "أهلاً أحمد، انضممت إلى ختمة العائلة. تصلك رسالة جزئك حين يبدأ المنظّم الختمة.",
  );
});

test("the free texts use Arabic digits", () => {
  expect(juzText(3, one)).toBe(
    "تحديث على قراءتك اليوم في الختمة ٣: المسجَّل لك الجزء ٢٦ من هذه الختمة.",
  );
  expect(juzText(3, two)).toBe(
    "تحديث على قراءتك اليوم في الختمة ٣: المسجَّل لك الجزآن ٥ و٦ من هذه الختمة.",
  );
  expect(juzText(3, three)).toBe(
    "تحديث على قراءتك اليوم في الختمة ٣: المسجَّل لك الأجزاء ٣، ٥ و٦ من هذه الختمة.",
  );
  expect(reminderText(two)).toBe(
    "تذكير بقراءتك اليوم: لم تُسجَّل بعد قراءة الجزأين ٥ و٦ في هذه الختمة.",
  );
  expect(assignedText(three, 7)).toBe(
    "تحديث على قراءتك: سُجِّلت لك قراءة الأجزاء ٣، ٥ و٦ في الختمة ٧ لهذا اليوم.",
  );
  expect(thanksText(12)).toBe("تقبّل الله منك. ١٢ من ٣٠ جزءاً تمّت اليوم.");
  expect(notYetText("٤:٠٠ م")).toBe("لا بأس، نذكّرك الساعة ٤:٠٠ م.");
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
  expect(clockText(480)).toBe("٨ صباحاً");
  expect(clockText(510)).toBe("٨:٣٠ صباحاً");
  expect(clockText(0)).toBe("١٢ صباحاً");
  expect(clockText(720)).toBe("١٢ ظهراً");
  expect(clockText(960)).toBe("٤ عصراً");
  expect(clockText(1245)).toBe("٨:٤٥ مساءً");
});

test("weekdayText names the weekday of a date", () => {
  expect(weekdayText("2027-01-16")).toBe("السبت");
  expect(weekdayText("2027-01-17")).toBe("الأحد");
  expect(weekdayText("2027-01-22")).toBe("الجمعة");
});

import { toArabicDigits } from "@convex/lib/digits";
import { DUAS } from "@convex/lib/duas";
import { noteText } from "@convex/lib/noteText";
import type { ReadingDaysKind } from "@convex/lib/rota";
import type { Schedule } from "@convex/lib/schedule";

/** Copy every feature shares for failures it cannot explain more precisely. */
const commonErrors = {
  maintenance: "وِردك في صيانة قصيرة الآن. حاول بعد قليل بإذن الله.",
  network: "تعذّر الاتصال. تأكد من الإنترنت ثم حاول مرة أخرى.",
  generic: "حدث خطأ غير متوقع. حاول مرة أخرى.",
} as const;

/**
 * A count with its noun, agreeing in Arabic: 1 and 2 use the singular and the dual with no digit,
 * 3 to 10 use the plural, 11 and up use the singular again (in the accusative, `many`).
 */
function counted(
  n: number,
  forms: { one: string; two: string; few: string; many: string },
): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const digits = toArabicDigits(n);
  return n >= 3 && n <= 10
    ? `${digits} ${forms.few}`
    : `${digits} ${forms.many}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How often a cheer reaches one person, for a gap in milliseconds. */
function cheerGap(gapMs: number): string {
  if (gapMs === 0) return "مع كل جزء يتمّ";
  if (gapMs === DAY_MS) return "مرة في اليوم";
  if (gapMs === 7 * DAY_MS) return "مرة في الأسبوع";
  if (gapMs % DAY_MS === 0) {
    const forms = { one: "يوم", two: "يومين", few: "أيام", many: "يوماً" };
    return `مرة كل ${counted(gapMs / DAY_MS, forms)}`;
  }
  if (gapMs % HOUR_MS === 0) {
    const forms = { one: "ساعة", two: "ساعتين", few: "ساعات", many: "ساعة" };
    return `مرة كل ${counted(gapMs / HOUR_MS, forms)}`;
  }
  const forms = { one: "دقيقة", two: "دقيقتين", few: "دقائق", many: "دقيقة" };
  return `مرة كل ${counted(Math.ceil(gapMs / MINUTE_MS), forms)}`;
}

/** A rota khatma as the share message names it, by how often it is read. */
const rotaKindText: Record<ReadingDaysKind, string> = {
  daily: "ختمة يومية بالتناوب",
  weekly: "ختمة أسبوعية بالتناوب",
  biweekly: "ختمة كل أسبوعين بالتناوب",
  monthly: "ختمة شهرية بالتناوب",
};

/** Every UI string lives here. Components never contain Arabic literals. */
export const ar = {
  errors: commonErrors,
  app: {
    name: "وِردك",
  },
  help: {
    mark: "؟",
    open: "محتاج مساعدة؟",
    title: "محتاج مساعدة؟",
    intro: "اكتب أو سجّل رسالة، وسنرد عليك هنا.",
    placeholder: "اكتب ما حدث…",
    message: "رسالتك",
    screenshot: "صورة الشاشة",
    removeScreenshot: "إزالة الصورة",
    enlargeScreenshot: "تكبير الصورة",
    closeScreenshot: "إغلاق الصورة",
    record: "اضغط للتسجيل",
    stop: "إيقاف",
    recording: (s: string) => `جارٍ التسجيل… ${s}`,
    deleteVoice: "حذف التسجيل",
    voiceNote: "تسجيل صوتي",
    send: "أرسل",
    sending: "جارٍ الإرسال…",
    sentTitle: "وصلتنا رسالتك",
    sentBody: "سنرد عليك هنا في وِردك، وسيصلك تنبيه.",
    done: "تم",
    back: "رجوع",
    newRequest: "طلب جديد",
    yourRequests: "طلباتك",
    you: "أنت",
    team: "فريق وِردك",
    reply: "ردّك",
    replyCardTitle: "رد من فريق وِردك",
    openReply: "اقرأ الرد",
    status: {
      open: "بانتظار الرد",
      answered: "تم الرد",
      closed: "مغلق",
    },
    errors: {
      rate_limited: "أرسلت رسائل كثيرة. حاول بعد قليل.",
      empty: "اكتب رسالة أو سجّل صوتك.",
      too_long: "الرسالة أطول من ١٠٠٠ حرف.",
      bad_file: "تعذّر إرفاق الملف. حاول مرة أخرى.",
      not_found: "لم نجد هذا الطلب.",
      generic: "تعذّر الإرسال. تأكد من الإنترنت ثم حاول مرة أخرى.",
    },
  },
  status: {
    maintenanceDefault: "نعمل على تحسين وِردك. نعود قريبًا بإذن الله.",
    updateNeeded: "يوجد إصدار أحدث من وِردك.",
    updateButton: "حدّث الصفحة",
    dismiss: "إخفاء",
  },
  pages: {
    home: "ختماتي",
    create: "ختمة جديدة",
    khatma: "الختمة",
    signOut: "تسجيل الخروج",
  },
  common: {
    loading: "جارٍ التحميل",
    listSeparator: "، ",
    home: "الصفحة الرئيسية",
  },
  retry: {
    title: "تعذّر تحميل الصفحة",
    retrying: "نحاول مرة أخرى…",
    failed: "لم نستطع تحميلها بعد. حاول مرة أخرى بعد قليل.",
    tryAgain: "حاول مرة أخرى",
  },
  errorBoundary: {
    title: "عذراً، تعثّرت الصفحة",
    body: "لم نستطع عرض هذه الصفحة الآن. أعد تحميلها، وإن تكرر ذلك فحاول بعد قليل بإذن الله.",
    reload: "أعد تحميل الصفحة",
  },
  notFound: {
    dead: "هذا الرابط لم يعد يعمل. اطلب من صاحب الدعوة رابطاً جديداً.",
  },
  schedules: {
    daily: "يومية",
    every3days: "كل ٣ أيام",
    weekly: "أسبوعية",
    biweekly: "كل أسبوعين",
    monthly: "شهرية",
    none: "بدون موعد",
  } satisfies Record<Schedule, string>,
  khatma: {
    invited: (inviter: string) => `دعاك ${inviter} إلى هذه الختمة.`,
    invitedAnon: "دُعيتَ إلى هذه الختمة.",
    verifyHint: "تصفّحها بحرية، وعندما تأخذ جزءاً نتحقق من رقمك عبر واتساب.",
    // The invite preview (lib/og.ts) repeats this wording; change both together.
    untitled: (date: string) => `ختمة ${date}`,
    round: (n: string) => `الختمة ${n}`,
    target: (date: string) => `الهدف: ${date}`,
    groupTotal: (n: string) => `ختمتم معاً ${n} ختمة، الحمد لله`,
    poolHeading: "الأجزاء الثلاثون",
    openCount: (n: string) => `${n} متاح`,
  },
  ring: {
    ofThirty: (total: string) => `من ${total} جزءاً تمّت`,
    label: (done: string, total: string) => `تمّ ${done} من ${total} جزءاً`,
  },
  tile: {
    open: "متاح",
    reading: "يُقرأ",
    mine: "أنت تقرؤه",
    done: "تمّ ✓",
    doneWord: "تمّ",
    juz: (n: string) => `الجزء ${n}`,
  },
  legend: {
    open: "متاح",
    reading: "يُقرأ",
    done: "تمّ",
  },
  card: {
    held: "جزؤك الآن",
    startsFrom: (surah: string) => `يبدأ من سورة ${surah}`,
    finish: "أتممتُ القراءة",
    release: "لا أستطيع إكماله",
    take: "خذ جزءاً",
    suggest: (n: string, name: string) => `نقترح عليك الجزء ${n} «${name}»`,
    pickYourself: "أو اختر جزءاً بنفسك",
    allTaken: "كل الأجزاء مأخوذة الآن",
    allTakenHint: "ننتظر أحبابنا يُتمّون قراءتهم.",
    stillReading: "ما زلت أقرأ",
    openForHelp: "يمكن لغيرك أن يساعد فيه الآن، ويمكنك إتمامه إن شئت.",
    /** Whole days, 1 to 7: `يوم`, `يومين`, `٣ أيام`. */
    pace: (days: number) =>
      `عادةً تُتمّ الجزء في نحو ${counted(days, {
        one: "يوم",
        two: "يومين",
        few: "أيام",
        many: "يوماً",
      })}`,
  },
  notes: {
    heading: "رسائل لك",
    /** The only door to the note texts: components never import them directly. */
    text: noteText,
    stillReading: "ما زلت أقرأ",
    finished: "أتممت القراءة",
    cantFinish: "لا أستطيع إكماله",
    takeJuz: "خذ الجزء",
    sendInvite: "أرسل الدعوة",
    takeOne: "خذ جزءاً",
    ok: "حسناً",
    /** The label beside the dot on the home page's khatma card. */
    newMessage: "رسالة جديدة",
  },
  grace: {
    label: "مهلة كل جزء",
    summary: (amount: string) => `مهلة كل جزء: ${amount}`,
    change: "تغيير",
    done: "تمّ",
    amountLabel: "المدة",
    unitsLabel: "الوحدة",
    units: { minutes: "دقائق", hours: "ساعات", days: "أيام" },
    range: "المهلة بين ٣٠ دقيقة و٣٠ يوماً.",
    amount: {
      minutes: (n: number) =>
        counted(n, {
          one: "دقيقة",
          two: "دقيقتان",
          few: "دقائق",
          many: "دقيقة",
        }),
      hours: (n: number) =>
        counted(n, {
          one: "ساعة",
          two: "ساعتان",
          few: "ساعات",
          many: "ساعة",
        }),
      days: (n: number) =>
        counted(n, { one: "يوم", two: "يومان", few: "أيام", many: "يوماً" }),
    },
  },
  cheer: {
    heading: "رسائل التشجيع",
    explain:
      "حين يتمّ أحد القرّاء جزءاً، تصل غيره رسالة تشجيع. لا تذكر اسمه ولا رقم جزئه إلا إن اخترت ذلك.",
    rotaHint: "تصل على واتساب، لمن راسلنا خلال آخر ٢٤ ساعة فقط.",
    switchLabel: "أرسل رسائل التشجيع",
    showNameLabel: "اذكر اسم القارئ",
    showJuzLabel: "اذكر رقم الجزء",
    audienceLabel: "من تصله",
    audience: { reading: "من ما زال يقرأ", everyone: "الجميع" },
    gapLabel: "كم مرة تصل الشخص الواحد",
    gapEvery: cheerGap,
    followsDefault: "هذه هي الإعدادات العامة، ويمكنك تغييرها لهذه الختمة.",
    useDefault: "ارجع إلى الإعدادات العامة",
  },
  khatmaSettings: {
    link: "إعدادات الختمة",
    notifications: "إشعارات هذه الختمة",
    on: "مفعّلة",
    off: "متوقفة",
  },
  organizer: {
    back: "العودة إلى الختمة",
    nameHeading: "الاسم",
    save: "حفظ",
    saved: "تمّ الحفظ",
    cancel: "تراجع",
    scheduleNote: "يبدأ التغيير من الختمة القادمة",
    graceNote:
      "إن احتاج القارئ وقتاً أطول يستطيع طلبه مرة واحدة، وبعدها يمكن لغيرك أن يساعد.",
    suggested: (amount: string) => `المقترح لهذا الموعد: ${amount}`,
    membersHeading: "الأعضاء",
    organizerBadge: "المنظّم",
    makeOrganizer: "اجعله المنظّم",
    remove: "إزالة",
    handoverTitle: (name: string) => `اجعل ${name} المنظّم؟`,
    handoverBody:
      "ستصبح عضواً عادياً، ولن تستطيع بعد ذلك تغيير إعدادات الختمة.",
    removeTitle: (name: string) => `إزالة ${name}؟`,
    removeBody:
      "سيعود جزؤه إلى الختمة، ولن يستطيع الانضمام مرة أخرى حتى تسمح له.",
    blockedHeading: "من أُزيلوا",
    allow: "السماح بالعودة",
    resetHeading: "رابط الدعوة",
    reset: "غيّر رابط الدعوة",
    resetTitle: "تغيير رابط الدعوة؟",
    resetBody:
      "الروابط القديمة ستتوقف عن العمل. أرسل الرابط الجديد إلى المجموعة.",
    resetConfirm: "غيّر الرابط",
    errors: {
      maintenance: commonErrors.maintenance,
      network: commonErrors.network,
      generic: commonErrors.generic,
      archived: "هذه الختمة مؤرشفة، فلا يمكن تغييرها.",
    },
  },
  archive: {
    banner: "هذه الختمة مؤرشفة",
    bannerHint: "للقراءة فقط، ولا تصل منها رسائل.",
    heading: "أرشفة الختمة",
    hint: "عندما تنتهون منها، تتوقف الرسائل وتبقى الختمة للقراءة فقط.",
    button: "أرشف الختمة",
    title: "أرشفة الختمة؟",
    body: "تتوقف الرسائل، ولا يضيع شيء: تبقى الختمة وأسماء من فيها للقراءة، وتجدها في «المؤرشفة».",
    confirm: "نعم، أرشف الختمة",
    archiving: "جارٍ الأرشفة",
    restart: "ابدأ من جديد بالأشخاص أنفسهم",
    restartTitle: "ابدأ ختمة جديدة؟",
    restartBody:
      "تبدأ ختمة جديدة بالأشخاص أنفسهم وأجزائهم. كلٌّ منهم يرسل رسالة الانضمام من جديد، ولا تصل الرسائل إلى من لم يرسلها.",
    restartDate: "تبدأ الختمة الأولى",
    restartConfirm: "ابدأ الختمة الجديدة",
    starting: "جارٍ البدء",
    delete: "احذف الختمة",
    deleteTitle: "حذف الختمة؟",
    deleteBody:
      "لا يمكن التراجع عن الحذف. تُحذف الختمة ورابطها، ويبقى المشاركون المحفوظون عندك.",
    deleteConfirm: "نعم، احذف الختمة",
    deleting: "جارٍ الحذف",
    deleteBusy: "نحذف ختمة أخرى الآن. حاول بعد ثوانٍ.",
    cancel: "تراجع",
  },
  nav: {
    label: "التنقل",
    home: "ختماتي",
    create: "ختمة جديدة",
    settings: "إعداداتي",
    back: "ختماتي",
    switchKhatma: "تبديل الختمة",
    switchTitle: "اختر ختمة",
    tabs: {
      label: "أقسام الختمة",
      mine: "جزئي",
      pool: "الأجزاء",
      group: "المجموعة",
    },
  },
  device: {
    unknownDevice: "جهاز",
    unknownBrowser: "متصفح",
  },
  sheet: {
    close: "إغلاق",
  },
  verify: {
    beforeTake: "قبل أن تأخذ جزءاً",
    intro:
      "نتحقق من رقمك مرة واحدة فقط، ليعرفك أحبابك وتعود إلى ختماتك من أي هاتف.",
    nameLabel: "ما اسمك؟",
    namePlaceholder: "مثلاً: أبو علي",
    start: "تحقّق عبر واتساب",
    starting: "جارٍ التحضير",
    startHint:
      "سيفتح واتساب ومعه رسالة جاهزة. اضغط «إرسال» فقط، ثم ارجع إلى هنا.",
    privacy: "كيف نحفظ رقمك واسمك",
    waitingTitle: "بانتظار رسالتك على واتساب",
    waitingHint: "اضغط «إرسال» في واتساب ثم ارجع إلى هنا. سنكمل تلقائياً.",
    openWhatsApp: "افتح واتساب",
    reopenWhatsApp: "افتح واتساب مرة أخرى",
    confirmTitle: (name: string) => `تمّ التحقق، أهلاً ${name}`,
    yourNumber: "رقمك:",
    yes: "نعم، هذا رقمي",
    notMe: "ليس رقمي",
    pinTitle: "أرسلنا لك رمزاً على واتساب",
    pinHint:
      "هذا الرقم مسجّل عندنا. اضغط «نسخ الرمز» في رسالة واتساب، ثم «الصق الرمز» هنا، أو اكتب الأرقام الستة.",
    pinPaste: "الصق الرمز",
    pinPasteEmpty:
      "لم نجد رمزاً من ستة أرقام. اضغط «نسخ الرمز» في رسالة واتساب، ثم عُد إلى هنا.",
    pinLabel: "رمز الدخول",
    pinSubmit: "تأكيد",
    devicesTitle: "أنت مسجّل الدخول على أجهزة أخرى",
    devicesHint: "تستطيع تسجيل الخروج منها الآن، أو المتابعة وتركها كما هي.",
    lastUsed: (date: string) => `آخر استخدام: ${date}`,
    signOutOthers: "تسجيل الخروج من كل الأجهزة الأخرى",
    keep: "متابعة",
    retry: "حاول مرة أخرى",
    errors: {
      nameRequired: "اكتب اسمك ليعرفك أحبابك.",
      invalid_name: "لم نستطع قبول هذا الاسم. اكتب اسماً قصيراً بحروف عادية.",
      rate_limited: "حاولتَ مرات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
      maintenance: commonErrors.maintenance,
      whatsapp_not_configured:
        "التحقق عبر واتساب غير متاح الآن. نعمل على إصلاحه.",
      network: commonErrors.network,
      generic: commonErrors.generic,
      expired: "انتهت مهلة الرمز. ابدأ من جديد، ولن يستغرق ذلك دقيقة.",
      rejected: "حسناً، لم نربط هذا الرقم. جرّب مرة أخرى بالرقم الذي تقصده.",
      wrong_pin:
        "الرمز غير صحيح. راجعه في رسالة واتساب وحاول مرة أخرى. عدد المحاولات محدود.",
      too_many_attempts:
        "تجاوزتَ عدد المحاولات المسموح. ابدأ من جديد لتحصل على رمز جديد.",
    },
  },
  signIn: {
    button: "عندك ختمات؟ ادخل برقمك",
    title: "ادخل برقمك",
  },
  toast: {
    taken: (n: string) => `الجزء ${n} لك الآن. يسّر الله لك`,
    finished: "تقبّل الله منك 🤍",
    undo: "تراجع",
    undone: "أعدنا الجزء إليك. أتمّه متى تيسّر.",
    released: "أعدناه إلى الختمة. جزاك الله خيراً",
    stillReading: "أعطيناك وقتاً إضافياً. يسّر الله لك.",
    /** Someone else took the reader's juz' as they tapped finish. */
    takenOver: (n: string) => `أحدهم يُكمل الجزء ${n} الآن. جزاكما الله خيراً.`,
  },
  take: {
    confirm: "نعم، هذا جزئي",
    notNow: "ليس الآن",
    as: (name: string) => `تأخذه باسم ${name}`,
    notYou: (name: string) => `لستَ ${name}؟`,
  },
  release: {
    title: "لا بأس، جزاك الله خيراً",
    body: (n: string) => `سنعيد الجزء ${n} ليقرأه غيرك. لن يعرف أحد أنك أعدته.`,
    confirm: "أعِده إلى الختمة",
    keep: "سأكمله إن شاء الله",
  },
  push: {
    title: "تذكير لطيف",
    body: "نرسل لك تذكيراً لطيفاً، ونخبرك حين نختم معاً.",
    enable: "فعّل الإشعارات",
    notNow: "ليس الآن",
  },
  /** Shown inside an app's own browser (WhatsApp, Facebook), which has its own sign-in. */
  openInBrowser: {
    body: "هذه الصفحة مفتوحة داخل التطبيق، لا في متصفحك. افتحها في متصفحك لتجد حسابك.",
    open: "افتح في المتصفح",
    iosHint:
      "اضغط ⋯ أو زر المشاركة، ثم اختر الفتح في Safari. أو انسخ الرابط والصقه في Safari.",
    copy: "انسخ الرابط",
    copied: "تمّ نسخ الرابط",
    dismiss: "ليس الآن",
  },
  /** Notifications on WhatsApp, off until the person turns them on. */
  whatsappNotes: {
    heading: "رسائل واتساب",
    label: "تنبيهات الختمات على واتساب",
    explain: "نرسل لك تنبيهات ختماتك على واتساب، على رقمك المسجّل.",
    offer: "أرسلها لي على واتساب",
    sheetTitle: "التنبيهات على واتساب",
    sheetBody:
      "هذا المتصفح لا يدعم الإشعارات. نستطيع أن نرسل لك تنبيهات ختماتك على واتساب، على رقمك المسجّل.",
    notNow: "ليس الآن",
  },
  install: {
    title: "أضف وِردك إلى الشاشة الرئيسية",
    intro:
      "لتصلك الإشعارات على الآيفون، أضف وِردك إلى الشاشة الرئيسية الآن، ونافذة الخطوات هذه مفتوحة. ثم افتحه من هناك، وستجده مفتوحاً بحسابك.",
    steps: {
      share: "اضغط زر المشاركة",
      add: "اختر «إضافة إلى الشاشة الرئيسية»",
      confirm: "اضغط «أضف»",
    },
    added: "أضفتُه",
    notNow: "ليس الآن",
  },
  /** Why an action did not go through. Every reason the server can give has kind copy. */
  actions: {
    errors: {
      notHolding: "ليس معك جزء الآن.",
      archived: "هذه الختمة مؤرشفة، فلا يمكن تغييرها.",
      /** The session ended on another device (signed out from there, say). */
      signedOut: "خرجتَ من حسابك على هذا الجهاز. سجّل دخولك من جديد لتكمل.",
      shared: {
        blocked:
          "لا نستطيع تنفيذ ذلك الآن. تواصل مع صاحب الختمة إن احتجت مساعدة.",
        maintenance: commonErrors.maintenance,
        rate_limited: "ضغطتَ مرات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
      },
      take: {
        taken: "سبقك أحدهم إليه. اخترنا لك غيره.",
        already_holding: "معك جزء الآن. أتمّه أو أعِده أولاً، ثم خذ غيره.",
        khatma_full: "اكتمل عدد المشاركين في هذه الختمة.",
      },
      stillReading: {
        already_extended: "أعطيناك وقتاً إضافياً من قبل لهذا الجزء.",
        opened: "لم يعد الوقت الإضافي متاحاً. يمكنك إتمام الجزء متى شئت.",
      },
      undo: {
        window_closed: "انتهت مهلة التراجع. الجزء محسوب لك، تقبّل الله منك.",
        holding_another: "معك جزء آخر الآن، فلا نستطيع إرجاع هذا إليك.",
        round_completed: "اكتملت الختمة، فلا يمكن التراجع الآن.",
        nothing_to_undo: "لا يوجد ما نتراجع عنه الآن.",
      },
    },
  },
  home: {
    hello: (name: string) => `السلام عليكم، ${name}`,
    helloAnon: "السلام عليكم",
    signedOutIntro:
      "وِردك يجمع أحبابك على ختمة واحدة للقرآن، يأخذ كل واحد جزءاً واحداً في كل مرة. أنشئ ختمة وادعُ أهلك وأصحابك.",
    empty: "لا توجد ختمات بعد. ابدأ ختمة جديدة وادعُ أحبابك إليها.",
    startNew: "＋ ابدأ ختمة جديدة",
    startNewPlain: "ابدأ ختمة جديدة",
    settings: "إعداداتي",
    doneOf: (done: string, total: string) => `${done} من ${total} تمّت`,
    yours: (n: string, name: string) => `جزؤك: الجزء ${n} «${name}»`,
    archived: "المؤرشفة",
    loadError: commonErrors.network,
  },
  create: {
    nameLabel: "اسم الختمة",
    optional: "(اختياري)",
    namePlaceholder: (date: string) => `ختمة ${date}`,
    scheduleLegend: "كل كم تختمون؟",
    subtitles: {
      daily: "نختم كل يوم",
      weekly: "الأكثر شيوعاً",
      none: "نقرأ على راحتنا",
    } as Partial<Record<Schedule, string>>,
    graceInvalid: "عدّل مهلة كل جزء لتكون بين ٣٠ دقيقة و٣٠ يوماً.",
    submit: "أنشئ الختمة",
    submitting: "جارٍ الإنشاء",
    beforeCreate: "قبل أن تنشئ ختمة",
    back: "رجوع",
    errors: {
      rate_limited:
        "أنشأتَ ختمات كثيرة اليوم. جرّب غداً بإذن الله، أو استخدم إحدى ختماتك.",
      maintenance: commonErrors.maintenance,
      network: commonErrors.network,
      generic: commonErrors.generic,
    },
  },
  rota: {
    typeQuestion: "أي ختمة تريد؟",
    poolTitle: "ختمة بالحجز",
    poolBody: "كل شخص يختار جزءاً متاحاً، ونختم عندما تكتمل الأجزاء الثلاثون.",
    rotaTitle: "ختمة بالتناوب",
    rotaBody: "لكل شخص جزء ثابت يتقدّم مع كل ختمة، ويصله على واتساب مع زرّين.",
    step: (n: number, of: number) =>
      `${toArabicDigits(n)} من ${toArabicDigits(of)}`,
    nameQuestion: "ما اسم الختمة؟",
    namePlaceholder: "مثلاً: ختمة العائلة",
    whenQuestion: "متى تقرؤون؟",
    daily: "كل يوم",
    weekly: "كل أسبوع",
    monthly: "كل شهر",
    onDays: "في يوم:",
    ofMonth: "في أيام الشهر:",
    everyWeek: "كل أسبوع",
    everyTwoWeeks: "كل أسبوعين",
    /** Saturday first, the week the way readers count it. */
    weekdays: {
      0: "الأحد",
      1: "الاثنين",
      2: "الثلاثاء",
      3: "الأربعاء",
      4: "الخميس",
      5: "الجمعة",
      6: "السبت",
    } as Record<number, string>,
    am: "ص",
    pm: "م",
    startLabel: "نبدأ",
    endLabel: "ننتهي",
    tomorrow: (date: string) => `غداً، ${date}`,
    today: (date: string) => `اليوم، ${date}`,
    noEnd: "تستمر دائماً",
    change: "تغيير",
    startDateInput: "تاريخ البداية",
    endDateInput: "تاريخ النهاية",
    next: "التالي",
    creating: "جارٍ الإنشاء",
    errors: {
      not_signed_in: "سجّل دخولك أولاً ثم حاول مرة أخرى.",
      rota_not_allowed: "الختمة بالتناوب غير متاحة لحسابك بعد.",
      rota_cap: "لديك العدد الأقصى من الختمات بالتناوب.",
      invalid_name: "اكتب اسماً للختمة",
      invalid_days: "اختر يوماً واحداً على الأقل.",
      invalid_dates: "تاريخ البداية أو النهاية غير صحيح. عدّله وحاول مرة أخرى.",
      rate_limited: "أنشأتَ ختمات كثيرة اليوم. جرّب غداً بإذن الله.",
      maintenance: commonErrors.maintenance,
      forbidden: "هذا للمنظّم فقط.",
      first_date_passed: "لا يمكن تغيير يوم البداية بعد أن بدأت الختمة.",
      invalid_times:
        "رتّب الأوقات: رسالة الجزء أولاً، ثم التذكير، ثم الأجزاء غير المقروءة، ثم الملخّص.",
      invalid_zone: "التوقيت غير صحيح.",
      invalid_cheer: "المدة بين رسائل التشجيع غير صحيحة.",
      not_reading_date: "هذا اليوم ليس يوم قراءة.",
      past: "هذا اليوم مضى.",
      archived: "هذه الختمة مؤرشفة، فلا يمكن تغييرها.",
      not_archived: "أرشِف الختمة أولاً، ثم ابدأ منها من جديد أو احذفها.",
    } as Record<string, string>,
    setupTitle: "من سيقرأ معك؟",
    personName: "الاسم",
    personPhone: "الرقم",
    phoneHint: "مع رمز الدولة، مثل \u200E+971",
    add: "أضف",
    adding: "جارٍ الإضافة",
    me: "أنا",
    peopleList: "المشاركون",
    todayQuestion: "متى يبدأ القراءة؟",
    todayHint:
      "بقيت ساعات قليلة من اليوم. إن بدأ اليوم، يكون له جزء اليوم ما دام منضماً قبل منتصف الليل.",
    readsToday: "يبدأ اليوم",
    readsNextDay: "يبدأ من يوم القراءة التالي",
    addErrors: {
      bad_name: "اكتب اسم الشخص.",
      bad_phone: "الرقم غير صحيح. اكتبه مع رمز الدولة، مثل \u200E+971",
      no_free_juz: "الأجزاء الثلاثون كلها لها قرّاء.",
      juz_taken: "هذا الجزء له قارئ. حاول مرة أخرى.",
      already_added: "هذا الرقم مضاف في الختمة.",
    } as Record<string, string>,
    juzOf: (juz: number[]) =>
      juz.length === 1
        ? `الجزء ${toArabicDigits(juz[0] ?? 0)}`
        : `الأجزاء ${juz.map((j) => toArabicDigits(j)).join(" و")}`,
    /** The banner when ajza' have no reader; the numbers are named only while they are few. */
    leftover: (juz: number[]) => {
      const n = juz.length;
      const named =
        juz.length <= 4
          ? ` (${juz.map((j) => toArabicDigits(j)).join(" و")})`
          : "";
      if (n === 1) return `بقي جزء بلا قارئ${named}`;
      if (n === 2) return `بقي جزءان بلا قارئ${named}`;
      if (n <= 10) return `بقيت ${toArabicDigits(n)} أجزاء بلا قارئ${named}`;
      return `بقي ${toArabicDigits(n)} جزءاً بلا قارئ`;
    },
    leftoverHint: "أعطِها لمن يحب أن يقرأ أكثر، أو أضف أشخاصاً.",
    giveTitle: (juz: number) => `من يقرأ الجزء ${toArabicDigits(juz)} أيضاً؟`,
    giveHint: "يقرأ أكثر من جزء كل يوم، ويتقدّمان معاً.",
    giveErrors: {
      juz_taken: "هذا الجزء له قارئ الآن.",
      too_many: "لا يمكنه أن يقرأ أكثر من هذا.",
      not_found: "لم نجد هذا الشخص.",
    } as Record<string, string>,
    done: "تمّ",
    tabs: { today: "اليوم", people: "المشاركون" },
    whatsappOnly: "هذه الختمة تعمل على واتساب. يصلك جزؤك كل يوم مع زرّين.",
    imOrganizer: "أنت المنظّم؟ سجّل الدخول",
    joinOnWhatsApp: "انضمّ عبر واتساب",
    // Joining
    shareJoin: "أرسل رابط الانضمام إلى مجموعتكم",
    shareMessage: (title: string, link: string, days: ReadingDaysKind) =>
      `السلام عليكم، بدأنا ${title}، ${rotaKindText[days]}. اضغطوا الرابط وأرسلوا الرسالة كما هي: ${link}`,
    joined: "انضمّ",
    notJoined: "لم ينضمّ · أعد الإرسال",
    notJoinedShort: "لم ينضمّ",
    notJoinedMe: "لم تنضمّ بعد · انضمّ الآن",
    stoppedMessages: "أوقف الرسائل",
    silencedMessages: "أوقفنا الرسائل",
    requestsHeading: "طلبات الانضمام",
    requestLine: (name: string | null, phone: string) =>
      name ? `${name} · ${phone}` : phone,
    requestJuz: "جزؤه",
    acceptRequest: "أضفه واختر جزأه",
    declineRequest: "لا",
    joinRequestErrors: {
      not_found: "لم نجد هذا الطلب. أعد تحميل الصفحة.",
      juz_taken: "هذا الجزء له قارئ الآن. اختر جزءاً آخر.",
      already_added: "هذا الرقم مضاف في الختمة.",
      no_free_juz: "الأجزاء الثلاثون كلها لها قرّاء.",
      bad_name: "اكتب اسم الشخص.",
    } as Record<string, string>,
    answerNone: "لم يردّ",
    answerNotYet: "ردّ: ليس بعد",
    cardLine: (done: string, total: string) =>
      `ختمة بالتناوب · ${done} من ${total} اليوم`,
    // Today
    heading: (number: number, date: string) =>
      `الختمة ${toArabicDigits(number)} · ${date}`,
    cycle: (cycle: number) => `الدورة ${toArabicDigits(cycle)}`,
    progress: (done: number, total: number) =>
      `${toArabicDigits(done)} / ${toArabicDigits(total)}`,
    readToday: "تمّت قراءتها اليوم",
    nextDay: (number: number, when: string) =>
      `التالي: الختمة ${toArabicDigits(number)} · ${when}`,
    nextTomorrow: (time: string) => `غداً ${time}`,
    nextOn: (date: string, time: string) => `${date} ${time}`,
    notStarted: (number: number, date: string, time: string) =>
      `تبدأ الختمة ${toArabicDigits(number)} يوم ${date} الساعة ${time}`,
    ended: "انتهت أيام القراءة المحددة.",
    pausedBanner:
      "الختمة موقوفة الآن. لا رسائل ولا يتقدّم رقم الختمة حتى تعيد تشغيلها.",
    archivedSettings: "هذه الختمة مؤرشفة، فلا يمكن تغيير إعداداتها.",
    setupNotDone: "أضف من سيقرأ معك، ثم اضغط «ابدأ الختمة».",
    startKhatma: "ابدأ الختمة",
    completeBanner: (number: number) =>
      `اكتملت الختمة ${toArabicDigits(number)}. تقبّل الله منكم.`,
    gridLabel: "أجزاء اليوم",
    legendDone: "تمّ",
    legendUnread: "لم يُقرأ",
    legendReassigned: "أُسند",
    tileLabel: (juz: number, state: string) =>
      `الجزء ${toArabicDigits(juz)}، ${state}`,
    unreadTitle: (juz: number) => `الجزء ${toArabicDigits(juz)} لم يُقرأ بعد`,
    doneTitle: (juz: number) => `الجزء ${toArabicDigits(juz)} تمّت قراءته`,
    holder: (name: string) => `صاحبه اليوم: ${name}`,
    readerNow: (name: string) => `يقرؤه الآن: ${name}`,
    readBy: (name: string) => `قرأه: ${name}`,
    assign: "أسنده إلى مشارك",
    readMyself: "سأقرؤه أنا",
    markDone: "سجّله تامّاً",
    undoDone: "ليس بعد؟ ألغِ التسجيل",
    pickTitle: (juz: number) => `من يقرأ الجزء ${toArabicDigits(juz)} اليوم؟`,
    finishedToday: "أتمّ جزأه اليوم",
    readingIt: "يقرؤه الآن",
    back: "رجوع",
    saving: "جارٍ الحفظ",
    todayErrors: {
      not_found: "لم نجد هذا الجزء أو هذا الشخص. أعد تحميل الصفحة.",
      closed: "انتهى هذا اليوم، فلا يمكن تغييره.",
      done: "هذا الجزء مسجّل تامّاً.",
    } as Record<string, string>,
    // People
    firstBanner: (date: string | null) =>
      `جزء كل مشارك في الختمة ١${date ? `، يوم ${date}` : ""}`,
    nextBanner: (number: number, date: string | null) =>
      `الختمة ${toArabicDigits(number)}${date ? ` يوم ${date}` : ""}. هذا جزء كل مشارك فيها، ويتقدّم كلٌّ منهم جزءاً في كل ختمة.`,
    addReader: (juz: number) => `+ أضف قارئاً للجزء ${toArabicDigits(juz)}`,
    secondJuz: "جزء ثانٍ",
    noReader: "بلا قارئ",
    readerTitle: (juz: number) => `قارئ الجزء ${toArabicDigits(juz)}`,
    walk: (juz: number, number: number) => {
      // Each khatma moves a reader up one juz', and after 30 it goes back to 1.
      const nextJuz = (juz % 30) + 1;
      const nextNumber = (number % 30) + 1;
      return `يقرأ الجزء ${toArabicDigits(juz)} في الختمة ${toArabicDigits(number)}، ثم ${toArabicDigits(nextJuz)} في الختمة ${toArabicDigits(nextNumber)}، وهكذا.`;
    },
    moveLabel: "انقله إلى الجزء",
    moveOption: (juz: number, other: string | null) =>
      `الجزء ${toArabicDigits(juz)}${other ? ` · سيتبادل مع ${other}` : ""}`,
    swapsWith: (name: string) => `سيتبادل مع ${name}`,
    swapsWithMe: "سيتبادل معي",
    move: "انقله",
    giveMore: "أعطه جزءاً آخر",
    giveMoreHint: (juz: number) =>
      `يقرأ معه الجزء ${toArabicDigits(juz)} كل يوم`,
    rename: "غيّر الاسم",
    renameOf: (name: string) => `غيّر اسم ${name}`,
    renameTitle: "غيّر الاسم",
    renameSave: "احفظ الاسم",
    remove: "أزله من الختمة",
    stopReading: "لن أقرأ جزءاً",
    stopReadingHint: "تبقى منظّم الختمة، ويصبح جزؤك بلا قارئ.",
    orGiveTo: "أو أعطه لمن في الختمة",
    removeTitle: (name: string) => `أزل ${name} من الختمة؟`,
    removeBody: "يصبح جزؤه بلا قارئ، وتبقى قراءته اليوم كما هي.",
    removeConfirm: "نعم، أزله",
    cancel: "تراجع",
    peopleErrors: {
      not_found: "لم نجد هذا الشخص. أعد تحميل الصفحة.",
      is_me: "لا يمكن إزالة منظّم الختمة منها.",
      juz_taken: "هذا الجزء له قارئ الآن.",
      too_many: "لا يمكنه أن يقرأ أكثر من هذا.",
      bad_name: "اكتب اسم الشخص.",
    } as Record<string, string>,
    // Saved participants and pool members
    savedFrom: "من ختمات سابقة",
    savedTitle: "من ختمات سابقة",
    savedHint: "اختر من أضفتَهم من قبل.",
    savedInKhatma: "في الختمة",
    savedErrors: {
      no_free_juz: "الأجزاء الثلاثون كلها لها قرّاء.",
      juz_taken: "هذا الجزء له قارئ. حاول مرة أخرى.",
      already_added: "هذا الشخص مضاف في الختمة.",
      not_found: "لم نجد هذا الشخص. أعد تحميل الصفحة.",
    } as Record<string, string>,
    importTitle: (title: string) => `أضف أعضاء ${title}`,
    importCount: (n: number) =>
      `${counted(n, { one: "عضو واحد", two: "عضوان", few: "أعضاء", many: "عضواً" })}، بالأسماء فقط`,
    importHint: "لا ترى أرقامهم، وكلٌّ منهم ينضمّ بنفسه من رابط الانضمام.",
    importResult: (added: number, skipped: number) => {
      const people = (n: number) =>
        counted(n, {
          one: "شخصاً واحداً",
          two: "شخصين",
          few: "أشخاص",
          many: "شخصاً",
        });
      const first = added > 0 ? `أضفنا ${people(added)}.` : "لم نضف أحداً.";
      return skipped > 0
        ? `${first} تركنا ${people(skipped)}، لأنهم في الختمة أو لأن الأجزاء اكتملت.`
        : first;
    },
    importErrors: {
      not_found: "لم نجد تلك الختمة. أعد تحميل الصفحة.",
    } as Record<string, string>,
    // Settings
    pauseHeading: "الإيقاف",
    pauseNow: "أوقف الختمة الآن",
    pauseHint: "لا رسائل حتى تعيد تشغيلها، ولا يتقدّم رقم الختمة.",
    pauseDates: "أوقف في أيام محددة",
    pauseDatesHint: "يوم الإيقاف بلا رسائل، ولا يتقدّم رقم الختمة.",
    addDate: "+ تاريخ",
    removeDate: (date: string) => `احذف ${date}`,
    pickDateTitle: "اختر يوماً للإيقاف",
    noUpcoming: "لا توجد أيام قراءة قادمة.",
    messagesHeading: "الرسائل",
    messagesHint: (from: string, to: string) =>
      `بتوقيت الختمة، بين ${from} و${to}.`,
    messageNames: {
      dayAt: "رسالة الجزء مع الأزرار",
      reminder: "تذكير لمن لم يُتمّ",
      unread: "الأجزاء غير المقروءة (لي)",
      summary: "ملخّص اليوم (لي)",
    },
    timeLabel: "الوقت",
    atDayStart: "عند بداية اليوم (١٢ ص)",
    lateTapLabel: "احتساب «أتممت» بعد منتصف الليل",
    lateTapHint:
      "من أتمّ جزء الأمس خلال هذه المدة يُحتسب له، ولا يؤثر ذلك في جزء اليوم.",
    lateTapHours: (hours: number) =>
      hours === 0
        ? "لا يُحتسب"
        : hours === 1
          ? "ساعة واحدة"
          : hours === 2
            ? "ساعتان"
            : `${toArabicDigits(hours)} ${hours <= 10 ? "ساعات" : "ساعة"}`,
    locked: "هذه الرسالة لا يمكن إيقافها.",
    saveTimes: "احفظ الأوقات",
    detailsHeading: "الختمة",
    nameLabel: "اسم الختمة",
    timeZoneLabel: "التوقيت",
    timeZoneHint: "كل الأوقات بهذا التوقيت.",
  },
  share: {
    inviteButton: "ادعُ أحبابك",
    remindButton: "ذكّر المجموعة",
    inviteTitle: "ادعُ أحبابك",
    createdTitle: "تمّ إنشاء الختمة. ادعُ أحبابك",
    remindTitle: "ذكّر المجموعة",
    previewHint: "هذه الرسالة التي ستُرسل:",
    remindNote: "الرسالة لا تذكر أسماء أحد",
    send: "أرسل على واتساب",
    done: "تمّ",
    preparing: "جارٍ تجهيز رابطك",
    error: commonErrors.network,
  },
  messages: {
    invite: (name: string, url: string) =>
      `السلام عليكم 🤍\nانضم إلينا في «${name}». نختم القرآن معاً، وكل واحد يأخذ جزءاً واحداً في كل مرة.\nاضغط هنا: ${url}`,
    remindCount: (n: number, digits: string) =>
      n === 1
        ? "بقي جزء واحد"
        : n === 2
          ? "بقي جزءان"
          : n <= 10
            ? `بقي ${digits} أجزاء`
            : `بقي ${digits} جزءاً`,
    remind: (name: string, remaining: string, until: string | null) =>
      `السلام عليكم 🤍\n«${name}»: ${remaining}${until ? ` حتى ${until}` : ""}.`,
    remindOpen: (list: string) => `الأجزاء المتاحة: ${list}`,
    remindLink: (url: string) => `خذ جزءاً من هنا: ${url}`,
  },
  signOut: {
    confirmTitle: "تسجيل دخول لم تقم به؟",
    confirmBody:
      "سنسجّل الخروج من كل الأجهزة المسجّلة برقمك، فلا يبقى لأحد غيرك دخول إلى حسابك. تستطيع الدخول من جديد متى شئت.",
    confirm: "نعم، سجّل الخروج",
    kept: "سجّلنا خروج الأجهزة الأخرى. هذا الجهاز ما زال مسجّلاً.",
    all: "سجّلنا خروجك من كل الأجهزة.",
    owner: "سجّلنا خروج كل أجهزة صاحب الرقم.",
    invalid: "هذا الرابط لم يعد صالحاً.",
    error: commonErrors.network,
    retry: "حاول مرة أخرى",
  },
  settings: {
    nameLabel: "اسمك",
    save: "احفظ الاسم",
    saving: "جارٍ الحفظ",
    saved: "تمّ حفظ الاسم",
    numberLabel: "رقمك",
    devicesHeading: "الأجهزة المسجّلة",
    thisDevice: "هذا الجهاز",
    lastUsed: (date: string) => `آخر استخدام: ${date}`,
    signOut: "تسجيل خروج",
    signOutOthers: "تسجيل الخروج من كل الأجهزة الأخرى",
    signedOutOthers: "سجّلنا خروج الأجهزة الأخرى.",
    signedOutOne: "سجّلنا خروج ذلك الجهاز.",
    numbers: "أرقامي",
    savedHeading: "مشاركوني",
    savedHint: "من أضفتَهم إلى ختماتك بالتناوب. تجدهم عند إضافة قارئ جديد.",
    savedHidden: "مخفي",
    savedRemove: "احذف",
    savedRemoveLabel: (name: string) => `احذف ${name}`,
    savedRemoveTitle: (name: string) => `احذف ${name} من مشاركيك؟`,
    savedRemoveBody:
      "يبقى في الختمات التي هو فيها الآن. فقط لا يظهر في قائمتك بعد اليوم.",
    savedRemoveConfirm: "نعم، احذفه",
    savedRemoveCancel: "تراجع",
    savedErrors: {
      not_found: "لم نجد هذا الشخص. أعد تحميل الصفحة.",
    } as Record<string, string>,
    /** Whole juz' read: `جزءاً واحداً`, `جزأين`, `٤ أجزاء`, `١٢ جزءاً`. */
    juzRead: (n: number) =>
      `قرأتَ ${counted(n, {
        one: "جزءاً واحداً",
        two: "جزأين",
        few: "أجزاء",
        many: "جزءاً",
      })}`,
    noJuzYet: "لم تُتمّ جزءاً بعد",
    /** Consecutive weeks with a finish, 2 or more. */
    weekStreak: (n: number) => {
      const digits = toArabicDigits(n);
      if (n === 1) return "أسبوع واحد تقرأ فيه";
      if (n === 2) return "أسبوعين متتاليين تقرأ فيهما";
      return n <= 10
        ? `${digits} أسابيع متتالية تقرأ فيها`
        : `${digits} أسبوعاً متتالياً تقرأ فيه`;
    },
    pushHeading: "الإشعارات على هذا الجهاز",
    pushLabel: "إشعارات هذا الجهاز",
    pushInstallHint:
      "على الآيفون تصلك الإشعارات بعد إضافة وِردك إلى الشاشة الرئيسية.",
    pushInstall: "أرني خطوات الإضافة",
    pushUnsupported: "هذا المتصفح لا يدعم الإشعارات.",
    pushBlocked:
      "الإشعارات محظورة لوِردك في إعدادات المتصفح. اسمح بها من هناك لتصلك.",
    signedOutPrompt:
      "لا يوجد حساب مسجّل على هذا الجهاز. ابدأ ختمة أو انضم إلى ختمة، وسنتحقق من رقمك عبر واتساب.",
    errors: {
      invalid_name: "لم نستطع قبول هذا الاسم. اكتب اسماً قصيراً بحروف عادية.",
      maintenance: "وِردك في صيانة قصيرة الآن. احفظ اسمك بعد قليل بإذن الله.",
      rate_limited:
        "غيّرتَ اسمك مرات كثيرة في وقت قصير. انتظر قليلاً ثم حاول مرة أخرى.",
      network: commonErrors.network,
    },
  },
  celebration: {
    title: "ختمنا القرآن معاً",
    subtitle: (name: string, round: string) =>
      `الحمد لله، ${name}، الختمة ${round}`,
    participants: (n: string) => `شارك فيها ${n} من أحبابك`,
    share: "شارك الفرحة على واتساب",
    shareMessage: (round: string) =>
      `الحمد لله، ختمنا القرآن معاً للمرة ${round} 🤍\nتقبّل الله منا ومنكم.`,
    continue: "تابع إلى الختمة",
    duas: DUAS,
  },
} as const;

export const t = ar;

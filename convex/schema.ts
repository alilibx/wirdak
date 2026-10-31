import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { auditActionValidator, auditTargetKindValidator } from "./lib/audit";
import { cheerConfigValidator } from "./lib/cheer";
import { graceValidator } from "./lib/grace";
import { rotaConfigValidator } from "./lib/rota";
import { scheduleValidator } from "./lib/schedule";

const nullableNumber = v.union(v.number(), v.null());

export default defineSchema({
  people: defineTable({
    phone: v.string(), // E.164
    displayName: v.string(),
    verifiedAt: v.number(),
    timeZone: v.string(),
    lastSeenAt: v.number(),
    // Opted in to notifications on WhatsApp (missing means no).
    whatsappNotes: v.optional(v.boolean()),
    // An admin allowed this person to create rotating khatmas (missing means no).
    rotaAllowed: v.optional(v.boolean()),
  }).index("by_phone", ["phone"]),

  sessions: defineTable({
    personId: v.id("people"),
    tokenHash: v.string(),
    alertTokenHash: v.string(),
    deviceLabel: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_alertTokenHash", ["alertTokenHash"])
    .index("by_person", ["personId"]),

  verifications: defineTable({
    codeNormalized: v.string(),
    secretHash: v.string(),
    displayName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("matched"),
      v.literal("needs_pin"),
      v.literal("claimed"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    phone: v.optional(v.string()),
    pinHash: v.optional(v.string()),
    pinAttempts: v.number(),
    existingPersonId: v.optional(v.id("people")),
    /** The site path the sign-in started on; the WhatsApp reply links back to it. */
    returnPath: v.optional(v.string()),
    /** Set for an admin panel sign-in; absent for the website. */
    surface: v.optional(v.literal("admin")),
    /** The allowlisted admin with this phone, for an admin sign-in that found one. */
    adminId: v.optional(v.id("admins")),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_code_status", ["codeNormalized", "status"])
    .index("by_createdAt", ["createdAt"]),

  inboundMessages: defineTable({
    waMessageId: v.string(),
    receivedAt: v.number(),
  })
    .index("by_waMessageId", ["waMessageId"])
    .index("by_receivedAt", ["receivedAt"]),

  khatmas: defineTable({
    name: v.union(v.string(), v.null()),
    schedule: scheduleValidator,
    grace: graceValidator,
    creatorPersonId: v.id("people"),
    inviteCode: v.string(),
    currentRoundId: v.optional(v.id("rounds")),
    completedRounds: v.number(),
    createdAt: v.number(),
    /** Missing means a pool khatma. A rota khatma has no rounds (`rota` holds its settings). */
    kind: v.optional(v.literal("rota")),
    rota: v.optional(rotaConfigValidator),
    /** What a member sends on WhatsApp to ask to join a rota khatma. */
    joinCode: v.optional(v.string()),
    /** When a pool khatma was archived. A rota khatma keeps `rota.archivedAt`. */
    archivedAt: v.optional(nullableNumber),
    /** The organizer's own cheer settings; missing means the admin's defaults. */
    cheer: v.optional(cheerConfigValidator),
  })
    .index("by_inviteCode", ["inviteCode"])
    .index("by_joinCode", ["joinCode"])
    .index("by_kind", ["kind"])
    .searchIndex("search_name", { searchField: "name" }),

  members: defineTable({
    khatmaId: v.id("khatmas"),
    personId: v.id("people"),
    joinedAt: v.number(),
    shareToken: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("blocked"),
      // An unblocked person who isn't a member; `take` reactivates the row.
      v.literal("former"),
    ),
    notificationsOn: v.boolean(),
    lastNudgeAt: nullableNumber,
    lastCelebratedRound: v.number(),
    /** When they were last cheered; missing means never. */
    lastCheerAt: v.optional(nullableNumber),
  })
    .index("by_khatma", ["khatmaId"])
    .index("by_person", ["personId"])
    .index("by_khatma_person", ["khatmaId", "personId"])
    .index("by_shareToken", ["shareToken"]),

  rounds: defineTable({
    khatmaId: v.id("khatmas"),
    number: v.number(),
    startedAt: v.number(),
    targetEndAt: nullableNumber,
    completedAt: nullableNumber,
    lastFinishedAt: nullableNumber,
    behindInvitedAt: nullableNumber,
  })
    .index("by_khatma_number", ["khatmaId", "number"])
    .index("by_lastFinishedAt", ["lastFinishedAt"])
    .index("by_completedAt", ["completedAt"])
    .index("by_open_lastFinishedAt", ["completedAt", "lastFinishedAt"]),

  assignments: defineTable({
    khatmaId: v.id("khatmas"),
    roundId: v.id("rounds"),
    roundNumber: v.number(),
    juz: v.number(),
    memberId: v.id("members"),
    personId: v.id("people"),
    takenAt: v.number(),
    finishedAt: nullableNumber,
    releasedAt: nullableNumber,
    releasedBySystem: v.boolean(),
    graceWakingMs: v.number(),
    noticeAt: v.number(),
    graceEndsAt: v.number(),
    extended: v.boolean(),
    noticeSentAt: nullableNumber,
    openedForHelpAt: nullableNumber,
    remindedAt: nullableNumber,
  })
    .index("by_round_juz", ["roundId", "juz"])
    .index("by_khatma_person", ["khatmaId", "personId"])
    .index("by_khatma_finishedAt", ["khatmaId", "finishedAt"])
    .index("by_round", ["roundId"])
    .index("by_person_finishedAt", ["personId", "finishedAt"])
    .index("by_finishedAt", ["finishedAt"]),

  notes: defineTable({
    personId: v.id("people"),
    khatmaId: v.id("khatmas"),
    kind: v.union(
      v.literal("almostUp"),
      v.literal("openForHelp"),
      v.literal("thanks"),
      v.literal("reminder"),
      v.literal("behind"),
      v.literal("cheer"),
      v.literal("completed"),
      v.literal("nowOrganizer"),
      v.literal("organizerMoved"),
      v.literal("rotaUnread"),
      v.literal("rotaSummary"),
      v.literal("rotaJoinRequest"),
      v.literal("rotaSilent"),
      v.literal("rotaSilenced"),
      v.literal("rotaStopped"),
      v.literal("rotaEnabled"),
    ),
    /** A rota participant's name, in the organizer notes about them. */
    name: v.optional(v.union(v.string(), v.null())),
    juz: v.array(v.number()),
    count: nullableNumber,
    until: nullableNumber,
    assignmentId: v.union(v.id("assignments"), v.null()),
    roundNumber: nullableNumber,
    createdAt: v.number(),
    pushedAt: nullableNumber,
    // When its WhatsApp message went out; at most one per note.
    whatsappSentAt: v.optional(nullableNumber),
    clearedAt: nullableNumber,
  })
    .index("by_person_khatma", ["personId", "khatmaId", "clearedAt"])
    .index("by_khatma_kind", ["khatmaId", "kind", "clearedAt"])
    .index("by_assignment", ["assignmentId"])
    .index("by_createdAt", ["createdAt"])
    .index("by_clearedAt", ["clearedAt"]),

  /** Someone who reads in a rota khatma: a name and a phone, not necessarily a Wirdak person. */
  rotaParticipants: defineTable({
    khatmaId: v.id("khatmas"),
    name: v.string(),
    phone: v.string(), // E.164
    personId: v.union(v.id("people"), v.null()),
    addedAt: v.number(),
    removedAt: nullableNumber,
    // WhatsApp state; missing means null (or 0 for `silentDays`).
    /** Their own join message: the opt-in for business-started messages. */
    joinedAt: v.optional(nullableNumber),
    /** They sent «إيقاف». */
    stoppedAt: v.optional(nullableNumber),
    /** Wirdak stopped messaging them after days without a reply. */
    silencedAt: v.optional(nullableNumber),
    lastReplyAt: v.optional(nullableNumber),
    /** Reading days in a row they sent no reply. */
    silentDays: v.optional(v.number()),
    /**
     * Imported from a pool khatma: the organizer never sees this phone, so
     * nothing returns it to a client (the join link is the only way in).
     */
    phoneHidden: v.optional(v.boolean()),
    /**
     * The reading day they start on, when the organizer added them late in
     * the day and said not today. Missing means they can read from the day they join.
     */
    readsFrom: v.optional(v.string()),
    /** When they were last cheered; missing means never. */
    lastCheerAt: v.optional(nullableNumber),
  })
    .index("by_khatma", ["khatmaId"])
    .index("by_khatma_phone", ["khatmaId", "phone"])
    // Every khatma a phone reads in, for its WhatsApp replies.
    .index("by_phone", ["phone"]),

  /** Someone an organizer added before: they can be added to another rota khatma in a tap. */
  rotaContacts: defineTable({
    ownerPersonId: v.id("people"),
    name: v.string(),
    /** Null for someone imported from a pool khatma: the organizer never sees the number. */
    phone: v.union(v.string(), v.null()), // E.164
    personId: v.union(v.id("people"), v.null()),
    createdAt: v.number(),
    /**
     * The organizer removed it from their list. Only a contact without a number
     * is kept this way: it is how a number stays hidden from them afterwards.
     */
    removedAt: v.optional(v.number()),
  })
    .index("by_owner", ["ownerPersonId"])
    .index("by_owner_phone", ["ownerPersonId", "phone"])
    .index("by_owner_person", ["ownerPersonId", "personId"]),

  /** Which participant owns each of the 30 slots. */
  rotaSlots: defineTable({
    khatmaId: v.id("khatmas"),
    slot: v.number(),
    participantId: v.id("rotaParticipants"),
  })
    .index("by_khatma_slot", ["khatmaId", "slot"])
    .index("by_participant", ["participantId"]),

  /** One reading day of a rota khatma. */
  rotaDays: defineTable({
    khatmaId: v.id("khatmas"),
    n: v.number(),
    number: v.number(),
    cycle: v.number(),
    date: v.string(),
    startedAt: v.number(),
    closesAt: v.number(),
    completedAt: nullableNumber,
    closedAt: nullableNumber,
    unreadSentAt: nullableNumber,
    summarySentAt: nullableNumber,
    /** When the participants' reminders went out; missing means not yet. */
    reminderSentAt: v.optional(nullableNumber),
    /** When the completion messages went out; missing means not yet. */
    celebratedAt: v.optional(nullableNumber),
  })
    .index("by_khatma_n", ["khatmaId", "n"])
    .index("by_khatma_date", ["khatmaId", "date"])
    .index("by_completedAt", ["completedAt"]),

  /** One juz' of one rota day, and who holds, reads and finished it. */
  rotaReads: defineTable({
    dayId: v.id("rotaDays"),
    khatmaId: v.id("khatmas"),
    juz: v.number(),
    slot: v.number(),
    holderId: v.union(v.id("rotaParticipants"), v.null()),
    readerId: v.union(v.id("rotaParticipants"), v.null()),
    doneAt: nullableNumber,
    doneByOrganizer: v.boolean(),
    reassignedAt: nullableNumber,
    /** The reader answered «ليس بعد»; missing means no. */
    notYetAt: v.optional(nullableNumber),
  })
    .index("by_day_juz", ["dayId", "juz"])
    .index("by_reader_day", ["readerId", "dayId"])
    .index("by_khatma", ["khatmaId"]),

  /** Someone who sent a rota khatma's join code and waits for the organizer's answer. */
  rotaJoinRequests: defineTable({
    khatmaId: v.id("khatmas"),
    phone: v.string(), // E.164
    profileName: v.union(v.string(), v.null()),
    createdAt: v.number(),
    resolvedAt: nullableNumber,
    outcome: v.union(v.literal("accepted"), v.literal("declined"), v.null()),
    // Who declined it: the organizer, or the requester with «إيقاف». Absent
    // on older rows, which count as the organizer's.
    declinedBy: v.optional(
      v.union(v.literal("organizer"), v.literal("member")),
    ),
  })
    .index("by_khatma_open", ["khatmaId", "resolvedAt"])
    .index("by_khatma_phone", ["khatmaId", "phone"])
    .index("by_phone", ["phone"]),

  /**
   * The last message each rota phone sent us: its 24-hour WhatsApp window.
   * Only phones on a rota list or with a join request; purged once closed.
   */
  waContacts: defineTable({
    phone: v.string(), // E.164
    lastInboundAt: v.number(),
  })
    .index("by_phone", ["phone"])
    .index("by_lastInboundAt", ["lastInboundAt"]),

  /** A message to a rota participant, queued for the sender to deliver. */
  rotaOutbox: defineTable({
    khatmaId: v.id("khatmas"),
    participantId: v.id("rotaParticipants"),
    dayId: v.union(v.id("rotaDays"), v.null()),
    kind: v.union(
      v.literal("juz"),
      v.literal("reminder"),
      v.literal("assigned"),
      v.literal("covered"),
      v.literal("complete"),
      v.literal("cycle"),
      v.literal("welcome"),
      v.literal("cheer"),
    ),
    juz: v.array(v.number()),
    number: nullableNumber,
    /** Who finished, in a cheer that shows it. */
    name: v.optional(v.union(v.string(), v.null())),
    createdAt: v.number(),
    sentAt: nullableNumber,
    skippedAt: nullableNumber,
  })
    .index("by_day_kind_participant", ["dayId", "kind", "participantId"])
    .index("by_khatma_unsent", ["khatmaId", "sentAt", "skippedAt"])
    .index("by_createdAt", ["createdAt"]),

  pushSubscriptions: defineTable({
    personId: v.id("people"),
    sessionId: v.id("sessions"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_person", ["personId"])
    .index("by_session", ["sessionId"])
    .index("by_endpoint", ["endpoint"]),

  handoffTokens: defineTable({
    tokenHash: v.string(),
    personId: v.id("people"),
    sessionId: v.id("sessions"),
    createdAt: v.number(),
    expiresAt: v.number(),
    usedAt: nullableNumber,
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_session", ["sessionId"])
    .index("by_createdAt", ["createdAt"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  admins: defineTable({
    phone: v.string(), // E.164
    /** null for the first admin, added from the command line. */
    addedBy: v.union(v.id("admins"), v.null()),
    addedAt: v.number(),
    /** Push alerts for help requests; absent means on (spec 7). */
    notifyHelp: v.optional(v.boolean()),
    notifySummary: v.optional(v.boolean()),
    notifyMilestones: v.optional(v.boolean()),
  }).index("by_phone", ["phone"]),

  /** One row per Dubai day: that day's counts and the running totals (spec 6.2). */
  dailyStats: defineTable({
    day: v.number(),
    ajzaFinished: v.number(),
    newMembers: v.number(),
    newKhatmas: v.number(),
    roundsCompleted: v.number(),
    /** Rotating khatma days whose 30 ajza' were all read; missing on older rows. */
    rotaDaysCompleted: v.optional(v.number()),
    signInsStarted: v.number(),
    signInsCompleted: v.number(),
    totalMembers: v.number(),
    totalKhatmas: v.number(),
    totalRoundsCompleted: v.number(),
    /** Active khatmas at the end of the day; set by the nightly run only (not the backfill). */
    activeKhatmas: v.optional(v.number()),
    computedAt: v.number(),
  }).index("by_day", ["day"]),

  /** Small named counters, e.g. `signin:<day>:started` (verifications are purged daily). */
  counters: defineTable({
    key: v.string(),
    value: v.number(),
  }).index("by_key", ["key"]),

  milestonesSent: defineTable({
    metric: v.union(
      v.literal("khatmas"),
      v.literal("members"),
      v.literal("completed"),
    ),
    value: v.number(),
    sentAt: v.number(),
  }).index("by_metric_value", ["metric", "value"]),

  /** Numbers an admin blocked app-wide (spec 8). */
  blockedPhones: defineTable({
    phone: v.string(),
    blockedBy: v.id("admins"),
    at: v.number(),
    note: v.union(v.string(), v.null()),
  }).index("by_phone", ["phone"]),

  /** Admin push subscriptions belong to the admin, not to one admin session (spec 7). */
  adminPushSubscriptions: defineTable({
    adminId: v.id("admins"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_admin", ["adminId"])
    .index("by_endpoint", ["endpoint"]),

  /** A help conversation (spec 3). Exactly one of personId and reporterHash is set. */
  helpRequests: defineTable({
    personId: v.union(v.id("people"), v.null()),
    /** sha256 of a signed-out visitor's reporter token */
    reporterHash: v.union(v.string(), v.null()),
    khatmaId: v.union(v.id("khatmas"), v.null()),
    status: v.union(
      v.literal("open"),
      v.literal("answered"),
      v.literal("closed"),
    ),
    context: v.object({
      path: v.string(),
      appVersion: v.string(),
      userAgent: v.string(),
      screen: v.string(),
      timeZone: v.string(),
    }),
    createdAt: v.number(),
    lastMessageAt: v.number(),
    answeredAt: nullableNumber,
    closedAt: nullableNumber,
    /** the last time the person opened the conversation */
    seenAt: nullableNumber,
    attachmentsDeletedAt: nullableNumber,
  })
    .index("by_person", ["personId", "lastMessageAt"])
    .index("by_reporter", ["reporterHash", "lastMessageAt"])
    .index("by_khatma", ["khatmaId"])
    .index("by_status", ["status", "lastMessageAt"])
    .index("by_status_answeredAt", ["status", "answeredAt"])
    .index("by_closedAt", ["closedAt"])
    .index("by_attachments_closedAt", ["attachmentsDeletedAt", "closedAt"]),

  helpMessages: defineTable({
    requestId: v.id("helpRequests"),
    from: v.union(v.literal("person"), v.literal("visitor"), v.literal("team")),
    text: v.union(v.string(), v.null()),
    screenshotId: v.union(v.id("_storage"), v.null()),
    voiceId: v.union(v.id("_storage"), v.null()),
    voiceSeconds: nullableNumber,
    /** Set when retention deleted this message's files, so admins see "deleted". */
    filesDeletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_request", ["requestId", "createdAt"])
    .index("by_screenshot", ["screenshotId"])
    .index("by_voice", ["voiceId"]),

  adminSessions: defineTable({
    adminId: v.id("admins"),
    tokenHash: v.string(),
    alertTokenHash: v.string(),
    deviceLabel: v.string(),
    createdAt: v.number(),
    /** createdAt + 12 hours, however active the admin is. */
    expiresAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_alertTokenHash", ["alertTokenHash"])
    .index("by_admin", ["adminId"])
    .index("by_expiresAt", ["expiresAt"]),

  auditLog: defineTable({
    /** null for changes made from the command line (the first admin). */
    adminId: v.union(v.id("admins"), v.null()),
    /** The actor's phone when the row was written, so it outlives the admin's removal. */
    adminPhone: v.union(v.string(), v.null()),
    action: auditActionValidator,
    targetKind: auditTargetKindValidator,
    targetId: v.string(),
    before: v.any(),
    after: v.any(),
    note: v.union(v.string(), v.null()),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_admin_at", ["adminId", "at"])
    .index("by_action_at", ["action", "at"]),

  /** Where an incremental sweep got to, by name (e.g. the orphaned-upload sweep). */
  sweepMarks: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    /** windowStart + windowMs; expired windows carry no information and are purged. */
    expiresAt: v.number(),
    count: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),
});

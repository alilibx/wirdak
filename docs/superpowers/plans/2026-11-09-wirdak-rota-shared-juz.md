# Rota shared juz' Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let two readers share one juz' of a rotating khatma once all 30 slots have a reader. Both read the whole juz', and either one's «أتممت» marks it done once.

**Architecture:** A slot gets an optional second `rotaSlots` row, marked `second: true`. `slotRowsByJuz` keeps returning only first readers, so every existing caller keeps its meaning. A new `partnerRowsByJuz` returns the second readers. Each day's `rotaReads` row records the second reader in `partnerId`, a fixed field like `holderId`. While `reassignedAt` is null, the partner reads too. Every reader-facing path (messages, reminders, replies, silence, cycle note, cheers, Today) treats "reads it" as `readerId === me || (partnerId === me && reassignedAt === null)`.

**Tech Stack:** Convex (TypeScript), convex-test with Vitest, React 19 web app (`apps/web`), Playwright e2e, Bun.

**Spec:** `docs/superpowers/specs/2026-11-09-wirdak-rota-shared-juz-design.md`. Also read the rotating khatma design (`docs/superpowers/specs/2026-10-29-wirdak-rotating-khatma-design.md`) for the terms it uses.

## Global Constraints

- Rotating khatma only. Nothing in `convex/pool.ts` or the pool pages changes.
- Both readers read the whole juz'. The words "half", «النصف», and hizb never appear in new code or copy.
- A slot has at most two readers. One person can't be both readers of a slot.
- A second reader may be added only while every one of the 30 slots of the target day (`targetDay`) has a first reader, and only when `rotaSharedSlotsOn` is on. The server checks this on every path. The website hides the action when the view says so.
- The second reader must be new to the khatma: not an active participant already.
- Done once: the first «أتممت» or typed «تم» from either reader, or an organizer's mark, sets `doneAt`. Neither reader gets a reminder after that.
- The partner is named in the reader's juz' phrase as «الجزء 26 (مشترك مع فلان)». No new WhatsApp templates.
- `rotaHalfCountsAsSlot` keeps its key, and its meaning becomes: a shared slot counts toward `rotaMaxSlotsPerPerson` for each of its readers. Fix its comment in `convex/lib/settings.ts` and its admin label so neither says "half".
- No AI attribution in commits or PR text (`CLAUDE.md`).
- Arabic copy lives in `apps/web/src/i18n/ar.ts` for the website and `convex/lib/noteText.ts` / `convex/lib/rotaTemplates.ts` for WhatsApp. Digits in Arabic copy are Western (123) through `toWesternDigits` (`convex/lib/digits.ts`).
- Each task ends with `bun run typecheck && bun run lint && bun run test` passing.

## Review Focus

1. **The first reader leaves a shared slot.** Through remove, move, or free, the second reader must become the slot's first reader (`second` cleared). Otherwise `slotRowsByJuz` shows the juz' as empty while someone holds it. Task 1 tests each of the three paths.
2. **A reassigned shared juz'.** The partner must stop getting reminders, stop counting as reading, and get "read for you". A late «أتممت» from them must still count, as a holder's does today (rota design 6.2). Tasks 3 and 4 test this.
3. **Typed «تم» from the partner after the juz' is done** must not mark another khatma's or another day's juz' done. Task 3 tests it with two khatmas, and in the late window.
4. **The rule breaks between screen and server.** A slot empties after the organizer opened the share sheet, so the server must refuse with `not_full` and the website must show it in Arabic. Tasks 2 and 5 test it.
5. **Cheers and the day count with two readers.** «26 / 30» counts the juz' once, and the cheer's "still reading" set includes an unread partner. Task 3 tests it.

---

### Task 1: Second readers in the data model, and leaving a shared slot

**Files:**
- Modify: `convex/schema.ts` (`rotaSlots`, `rotaReads`, `rotaOutbox`)
- Modify: `convex/lib/rotaPlace.ts` (`slotRowsByJuz` :142, add `partnerRowsByJuz`, `sharingOpen`, `leaveSlot`)
- Modify: `convex/rotaDays.ts` (`startDay` :102 sets `partnerId`)
- Modify: `convex/lib/rotaOps/people.ts` (`moveJuz` :624, `freeJuz` :664, `removeParticipant` :693, the slot cap in `giveJuz` :489 and `spreadFreeJuz` :525)
- Modify: `convex/rota.ts` (start-again copy :426 keeps `second`)
- Modify: `convex/rotaOutbox.ts` (`takeFreeJuzToday` :275 skips `second` rows)
- Modify: `convex/lib/settings.ts` :134 comment, and the admin label for `rotaHalfCountsAsSlot` in `apps/admin/src/i18n/ar.ts`
- Test: `convex/rota.people.test.ts`, `convex/rotaDays.test.ts`, `convex/rota.create.test.ts`

**Interfaces:**
- Produces (schema):
  - `rotaSlots.second: v.optional(v.boolean())`: true on the second reader's row.
  - `rotaReads.partnerId: v.optional(v.union(v.id("rotaParticipants"), v.null()))`: the day's second reader, fixed when the day starts. New index `by_partner_day: ["partnerId", "dayId"]`.
  - `rotaReads.doneById: v.optional(v.union(v.id("rotaParticipants"), v.null()))`: the reader whose tap marked it done, or null for an organizer's mark.
  - `rotaReads.partnerNotYetAt: v.optional(nullableNumber)`: the partner's «ليس بعد».
  - `rotaReads.thankedIds: v.optional(v.array(v.id("rotaParticipants")))`: readers who answered «أتممت» after the juz' was already done.
  - `rotaOutbox.partners: v.optional(v.array(v.object({ juz: v.number(), name: v.string() })))`.
- Produces (functions in `convex/lib/rotaPlace.ts`):
  - `slotRowsByJuz(ctx, khatmaId, number): Promise<Map<number, Doc<"rotaSlots">>>`: unchanged signature. It ignores rows with `second === true`.
  - `partnerRowsByJuz(ctx, khatmaId, number): Promise<Map<number, Doc<"rotaSlots">>>`: the `second` rows, by juz'.
  - `sharingOpen(ctx, khatmaId, number): Promise<boolean>`: `rotaSharedSlotsOn` is on and `slotRowsByJuz` has all 30.
  - `leaveSlot(ctx: MutationCtx, row: Doc<"rotaSlots">): Promise<void>`: deletes the row. If it wasn't `second`, it patches the same slot's `second` row (if any) to `second: undefined`.
  - `readsFor(read: Doc<"rotaReads">, participantId): boolean`: `read.readerId === participantId || (read.partnerId === participantId && read.reassignedAt === null)`. Export it from `convex/lib/rota.ts` so later tasks share one definition.
  - `heldSlotCount(ctx, participantId): Promise<number>`: the participant's `rotaSlots` rows, counting `second` rows only when `rotaHalfCountsAsSlot` is on. `giveJuz` and `spreadFreeJuz` use it for the cap.

- [ ] **Step 1: Write the failing tests**
  - `rotaDays.test.ts` › `"two readers on one slot rotate together"`: insert a first and a `second` row on slot 7, start khatma 1 and khatma 2 days. Expect the khatma 2 read of juz' 8 to have `holderId === readerId === first` and `partnerId === second`, and a slot without a second row to have `partnerId: null`.
  - `rota.people.test.ts` › `"removing the first reader of a shared slot makes the second whole"`: after `rota.removeParticipant` on the first, the people view's row for that juz' shows the second reader, and the slot's only row has no `second`.
  - `rota.people.test.ts` › `"freeing the first reader of a shared slot makes the second whole"`, using `rota.freeJuz`.
  - `rota.people.test.ts` › `"moving the first reader of a shared slot to an empty juz' leaves the second whole"`, using `rota.moveJuz`. Moving a shared slot's reader onto another reader (a swap) returns `{ error: "shared" }`.
  - `rota.people.test.ts` › `"today's read keeps both readers after one leaves"`: an open day's read still has both ids after the remove.
  - `rota.people.test.ts` › `"a shared slot counts toward the cap unless rotaHalfCountsAsSlot is off"`: with `rotaMaxSlotsPerPerson` 1, `giveJuz` to a second reader returns `too_many`, and `ok` with the setting off. (Free a slot first so `giveJuz` has an empty one.)
  - `rota.create.test.ts` › `"starting again keeps shared slots"`: the new khatma's slot rows keep `second`.
- [ ] **Step 2: Run them**

  Run: `bunx vitest run convex/rotaDays.test.ts convex/rota.people.test.ts convex/rota.create.test.ts`
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the schema fields, the `rotaPlace` helpers, `readsFor`, and `heldSlotCount`. Make `startDay` set `partnerId` from `partnerRowsByJuz` (null when none). Route `freeJuz`, `removeParticipant`, and the no-swap branch of `moveJuz` through `leaveSlot`. `moveJuz` and `freeJuz` look up the participant's row among both first and second rows for `fromJuz`. Make `takeFreeJuzToday` skip `second` rows. Make the start-again copy carry `second`. Fix the setting's comment and admin label.
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rota): let a slot hold a second reader who rotates with the first`

### Task 2: Adding a second reader, only when all 30 have one

**Files:**
- Modify: `convex/lib/rotaOps/people.ts` (`placeNewParticipant` :358, `addParticipant` :436, `addSaved` :1008, `acceptJoinRequest` :1141, `people` view :253)
- Modify: `convex/lib/rotaOps/bulk.ts` (`addSavedMany` :42)
- Modify: `convex/rota.ts` (`addParticipant`, `addSaved`, `addSavedMany`, `acceptJoinRequest`, `importMembers` :743 args and placement)
- Modify: `convex/adminRota.ts` (the same mutations' args, audited as today)
- Test: `convex/rota.people.test.ts`, `convex/rota.saved.test.ts`, `convex/adminRota.test.ts`, `convex/rota.settings.test.ts`

**Interfaces:**
- Consumes: `slotRowsByJuz`, `partnerRowsByJuz`, `sharingOpen` (Task 1).
- Produces:
  - `placeNewParticipant(ctx, khatma, who, juz, joinedAt?, late?, mode: "empty" | "share" | "fill" = "empty")`. The return error union gains `"not_full" | "sharing_off" | "already_shared"`.
    - `"empty"` is today's behavior.
    - `"share"`: `juz` is required. It refuses `sharing_off` when `rotaSharedSlotsOn` is off, `not_full` when any slot is empty, `already_shared` when the juz' has a second reader, and otherwise inserts a `second: true` row on that slot.
    - `"fill"`: the lowest free juz'. When none is free and `sharingOpen`, it uses the lowest juz' with no second reader. Otherwise `no_free_juz`.
    - In `"share"` and `"fill"`, the late-in-the-day question (`lateInTheDay`) is never asked for a second row, because a second reader never takes today's juz'.
  - `addParticipant` args gain `share?: boolean`, which places with `"share"` on `args.juz`. Its error union gains the three new errors.
  - `addSaved` and `acceptJoinRequest` args gain `share?: boolean` the same way.
  - `addSavedMany` and `importMembers` place with `"fill"`.
  - `PeopleView.rows[i]` gains `partner: (same shape as participant) | null`, built from `partnerRowsByJuz`. `PeopleView.participants[i].juz` includes the juz' where they're the second reader. `PeopleView` gains `sharing: { on: boolean; open: boolean; readers: number; shared: number }`. `on` is the setting. `open` is `sharingOpen`. `readers` is the count of distinct participants holding a slot. `shared` is the count of rows with a partner.
- [ ] **Step 1: Write the failing tests**
  - `"sharing is refused while any slot is empty"`: 29 slots filled, then `addParticipant({ share: true, juz: 1 })` returns `{ error: "not_full" }`.
  - `"sharing works once all 30 have a reader"`: fill 30, share juz' 1. The view row 1 shows both, `sharing.shared === 1`, and `readers === 31`.
  - `"a juz' takes no third reader"`: sharing it again returns `already_shared`.
  - `"someone already in the khatma can't become a second reader"`: `already_added`.
  - `"rotaSharedSlotsOn off refuses sharing, and shared slots carry on"`: `sharing_off`, and the existing share stays in the view.
  - `"a slot that empties keeps existing shares and blocks new ones"`: free one slot, then the view's `sharing.open` is false, and a new share returns `not_full`.
  - `"a khatma holds 60 readers"`: share all 30 slots. The view has 60 readers, and a 61st `"fill"` placement returns `no_free_juz`.
  - `rota.saved.test.ts` › `"adding saved people fills empty slots, then shares in order"`: 28 filled, `addSavedMany` with 4 people puts two on juz' 29 and 30 and shares juz' 1 and 2.
  - `"a join request can be accepted onto a shared slot"`: `acceptJoinRequest({ share: true, juz })` once full, and `not_full` before.
  - `adminRota.test.ts` › `"an admin can share a juz', audited"`.
  - `"a co-organizer needs People to share"`: refused without the permission, as `addParticipant` is today.
- [ ] **Step 2: Run** `bunx vitest run convex/rota.people.test.ts convex/rota.saved.test.ts convex/adminRota.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the `mode` parameter, the new args, the view fields, and the admin mirrors.
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rota): add a second reader to a juz' once all 30 have one`

### Task 3: The reading day on WhatsApp: both readers, done once

**Files:**
- Modify: `convex/lib/noteText.ts` (`juzPhrase` :66, `juzPhraseGenitive` :77, and the text builders that call them: `juzText`, `reminderText`, `assignedText`; `juzText` uses `juzList`, so `juzList` takes `partners` too)
- Modify: `convex/lib/rotaTemplates.ts` (`juzTemplate`, `reminderTemplate`, `assignedTemplate` take `partners`)
- Modify: `convex/rotaOutbox.ts` (`enqueue` :113 takes `partners`, `compose` :378 passes them, `plan` :458 counts a partner's reads as waiting, `welcomeMessage` :323 includes partner reads)
- Modify: `convex/rotaDays.ts` (`sendJuzMessages` :158, `sendReminders` :281, `countSilentDay` :327, `sendCycleMessages` :388)
- Modify: `convex/rotaInbound.ts` (`readsOf` :150, `answerDay` :211, `answerTyped` :501)
- Modify: `convex/cheers.ts` :170-200 (the "still reading" set uses `readsFor`)
- Test: `convex/lib/noteText.test.ts`, `convex/lib/rotaTemplates.test.ts`, `convex/rotaDays.test.ts`, `convex/rotaInbound.test.ts`, `convex/rotaOutbox.test.ts`, `convex/cheers.rota.test.ts`

**Interfaces:**
- Consumes: `readsFor`, the schema fields (Task 1).
- Produces:
  - `juzPhrase(juz: readonly number[], partners?: ReadonlyMap<number, string>): string`, and `juzPhraseGenitive` the same way. A juz' with a partner reads `الجزء 26 (مشترك مع فلان)`. In a list, the note follows its own number: `الجزآن 5 (مشترك مع فلان) و6`. Without `partners`, the output is byte-for-byte unchanged.
  - `partnersOf(read, participantId, names: Map<Id, string>): string | null` in `convex/lib/rota.ts`: for the reader, the partner's name; for the partner, the reader's name; null when the read isn't shared or `reassignedAt` is set.
  - `enqueue` row gains `partners?: { juz: number; name: string }[]`. `sendJuzMessages`, `sendReminders`, and `welcomeMessage` fill it.
- Behavior:
  - `sendJuzMessages` and `sendReminders` group unread reads by every participant `readsFor` is true for. So both readers of an unread shared juz' get it, and neither gets a reminder once `doneAt` is set.
  - `plan`'s `waiting` filter uses `readsFor`.
  - `readsOf(participant, day)`: `reading` = reads where `readsFor`. `handedOn` = reads where the participant is `holderId` or `partnerId` and `readsFor` is false.
  - `answerDay`:
    - «أتممت» marks `doneAt`, `doneByOrganizer: false`, and `doneById: participant._id`.
    - «ليس بعد» sets `notYetAt` when the participant is `readerId`, else `partnerNotYetAt`.
    - With nothing unread, if a read in `reading ∪ handedOn` is done with `doneById !== participant._id` and the participant isn't in `thankedIds`, it adds them to `thankedIds` and replies `thanksText(doneCount)`. That applies to both «أتممت» and «ليس بعد». Otherwise it replies `alreadyText` as today.
  - `answerTyped`: a day is open for the participant when it has an unread read in `reading ∪ handedOn`, or a read in either that's due a thanks reply (the condition above). So a typed «تم» after the partner finished lands on that juz', not on another khatma's.
  - `countSilentDay` counts every participant `readsFor` is true for on any read. The reply rule is unchanged.
  - `sendCycleMessages`' `holdsOn` includes `partnerId`.
  - Cheers: the "still reading" and "held back" sets include `partnerId` where `readsFor`. `notYetAt` or `partnerNotYetAt` holds back the matching reader.
- [ ] **Step 1: Write the failing tests**
  - `noteText.test.ts` › `"juzPhrase names a partner after its own juz'"`: `juzPhrase([26], new Map([[26, "سارة"]]))` is `الجزء 26 (مشترك مع سارة)`, and `juzPhrase([5, 6], new Map([[5, "سارة"]]))` is `الجزآن 5 (مشترك مع سارة) و6`. Also `"juzPhrase without partners is unchanged"`.
  - `rotaTemplates.test.ts` › `"the longest juz' phrase with partners fits a template parameter"`: three ajza', each with a 60-character name, stays under 1024 characters and has no newline.
  - `rotaDays.test.ts` › `"both joined readers get the juz' message naming each other"`.
  - `rotaDays.test.ts` › `"a reader who hasn't joined gets nothing, and the joined partner does"`.
  - `rotaInbound.test.ts` › `"either reader's «أتممت» marks the juz' done once"`: `doneCount` goes up by 1, `doneById` is the tapper, and no reminder row is queued for the other at reminder time.
  - `rotaInbound.test.ts` › `"the partner's later «أتممت» gets the thanks reply and changes nothing"`: a second tap from them gets `alreadyText`.
  - `rotaInbound.test.ts` › `"typed «تم» from the partner after the juz' is done doesn't mark another khatma's juz'"`: the partner is also in a second khatma with an unread juz'. The first «تم» gets thanks for the shared juz', and the other khatma's read stays undone.
  - `rotaInbound.test.ts` › `"the same in the late window"`: after midnight, the partner's «تم» is for the ended day's done shared juz', not today's.
  - `rotaInbound.test.ts` › `"«ليس بعد» from the partner sets partnerNotYetAt"`.
  - `rotaDays.test.ts` › `"a partner who never replies is still silenced after rotaSilenceStopDays"`.
  - `rotaDays.test.ts` › `"both readers of a shared slot get the cycle note"`.
  - `rotaOutbox.test.ts` › `"a queued juz' message to the partner drops once the juz' is done"`.
  - `cheers.rota.test.ts` › `"an unread partner counts as still reading"`.
- [ ] **Step 2: Run** the files under Test. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rota): message both readers of a shared juz', and count it done once`

### Task 4: Today, reassigning, and the organizer's mark

**Files:**
- Modify: `convex/lib/rotaOps/today.ts` (`TodayView` :12, `today` :82, `answerOf` :66, `reassign` :163, `markDone` :212, `markNotDone` :248)
- Test: `convex/rota.today.test.ts`, `convex/adminRota.test.ts`

**Interfaces:**
- Consumes: `readsFor`, the schema fields (Task 1).
- Produces:
  - Each `TodayView.tiles[i]` gains `partnerName: string | null`, `partnerId`, `partnerAnswer: "notYet" | "none" | null` (like `answer`, from `partnerNotYetAt`), and `doneByName: string | null`. Only a viewer with the Readings permission (or the owner or an admin) gets `doneByName`; others get null.
  - `participants[i].doneToday` uses `readsFor`.
  - `reassign` on a shared read: after today's patch, also enqueue `covered` to `partnerId` when it differs from the new reader, under the same "told" rule. Clear `partnerNotYetAt`.
  - `markDone` sets `doneById: null`. `markNotDone` clears `doneById` and `thankedIds`.
- [ ] **Step 1: Write the failing tests**
  - `"today shows both readers and their answers"`.
  - `"today shows who marked a shared juz' to those with Readings"`.
  - `"reassigning a shared juz' covers both readers"`: two `covered` rows.
  - `"reassigning a shared juz' to its partner covers only the first reader"`.
  - `"after reassigning, the partner gets no reminder, and their late «أتممت» still counts"`.
  - `"an organizer's mark records no reader, and undo clears it"`.
- [ ] **Step 2: Run** `bunx vitest run convex/rota.today.test.ts convex/adminRota.test.ts`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(rota): show both readers of a shared juz' on Today`

### Task 5: The website

**Files:**
- Modify: `apps/web/src/features/rota/PeoplePanel.tsx` (`PersonSheet` :35, the rows :431)
- Modify: `apps/web/src/features/rota/JoinRequests.tsx`
- Modify: `apps/web/src/features/rota/TodayPanel.tsx` (the tile sheet)
- Modify: `apps/web/src/features/rota/SavedPicker.tsx` and `AddPersonForm.tsx` only as needed to pass `share`
- Modify: `apps/web/src/features/rota/backend.tsx`, `apps/web/src/features/rota/errors.ts`
- Modify: `apps/web/src/i18n/ar.ts`, and `apps/admin` if its rota provider maps args
- Test: `apps/web/src/features/rota/PeoplePanel.test.tsx`, `JoinRequests.test.tsx`, a new `TodayPanel.test.tsx`

**Interfaces:**
- Consumes: the `PeopleView` fields and `share` args (Task 2), and the `TodayView` fields (Task 4).
- Produces (copy, in `t.rota`):
  - `shareAction`: «أضف قارئاً يشاركه الجزء».
  - `shareExplain(a, b, juz, number)`: «يقرأ ‎{a}‎ و‎{b}‎ الجزء {juz} في الختمة {number}، ثم الجزء {juz+1} في الختمة {number+1}. أيّهما سجّل أنه أتمّه يُحسب الجزء مقروءاً». It wraps after juz' 30 the way the existing placement sentence does.
  - `leavesAlone(name)`: «سيقرأ {name} الجزء وحده».
  - `sharedCount(readers, shared)`: «{readers} قارئاً، {shared} جزءاً مشتركاً», with the existing Arabic count helpers for agreement.
  - Errors: `not_full` «لا تُشارَك الأجزاء إلا بعد أن يكون لكل جزء قارئ», `sharing_off` «مشاركة الجزء غير متاحة الآن», and `already_shared` «لهذا الجزء قارئان».
- Behavior:
  - A row with a partner shows both names, each with its joined state.
  - A whole row's sheet shows `shareAction` only when `view.sharing.on && view.sharing.open && !archived`. It opens the existing add and saved pickers in share mode and shows `shareExplain` above the confirm button.
  - In the sheet of either reader of a shared row, remove, free, and move each show `leavesAlone(other)` before they confirm. Move offers empty ajza' only.
  - The `sharedCount` line shows above the list when `sharing.shared > 0`.
  - Join requests offer «شارِك جزءاً» with a juz' picker when `sharing.open` and there's no free juz'.
  - Today's tile sheet shows both readers, each answer, and `doneByName` when present.
- [ ] **Step 1: Write the failing tests**
  - `"no share action while a slot is empty"`.
  - `"no share action when sharing is off"`.
  - `"adding a second reader spells out what follows"`.
  - `"a shared row shows both names"`.
  - `"removing one reader warns the other reads it alone"`.
  - `"a not_full refusal shows in Arabic"`.
  - `"a join request can be shared onto a juz' when all are taken"`.
  - `TodayPanel.test.tsx` › `"a shared tile's sheet shows both readers and answers"`.
- [ ] **Step 2: Run** `bunx vitest run apps/web/src/features/rota`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add a second reader to a rota juz'`

### Task 6: End to end, and the PR

**Files:**
- Modify: `e2e/rota-lifecycle.spec.ts` (or create `e2e/rota-shared.spec.ts` following its setup)
- Modify: `docs/whatsapp-rota-templates.md` (one line: the juz' phrase may carry «(مشترك مع فلان)»)

- [ ] **Step 1: Write the e2e test** `"an organizer shares a juz' once all 30 have a reader"`. Create a rota and fill 29. Check that no share action shows. Fill the 30th, share juz' 1 with a new person, and check that the row shows both names.
- [ ] **Step 2: Run** `bun run e2e -- rota-shared` (or the file's grep). Expected: PASS on the default project.
- [ ] **Step 3: Run** `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 4: Commit** `test(e2e): share a rota juz' once all 30 have a reader`
- [ ] **Step 5:** Push, open the PR («feat(rota): two readers share one juz' once all 30 have one», body `Fixes ADA-117`, no attribution), run `/code-review` on it, and fix the confirmed findings.

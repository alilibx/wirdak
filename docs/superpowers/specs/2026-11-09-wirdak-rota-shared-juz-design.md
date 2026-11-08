# Wirdak rotating khatma: two readers share one juz'

Linear: [ADA-117](https://linear.app/manzilo/issue/ADA-117). Date: 2026-11-09.

This replaces section 5 ("Two readers on one juz'") of `2026-11-04-wirdak-co-organizers-design.md`, and Tasks 12 to 15 of `docs/superpowers/plans/2026-11-05-wirdak-co-organizers.md`. The other parts of that design still apply, and so does the rotating khatma design (`2026-10-29-wirdak-rotating-khatma-design.md`), which this document calls "the rota design".

Items marked **[builder's call]** were decided while writing this up, not by Ali, and he can overturn any of them. Everything else comes from Ali on 2026-11-09.

## 1. Why

A rotating khatma has 30 slots, so it holds 30 readers at most. Groups bigger than 30 can't all take part. Ali wants a second reader on a juz' once all 30 are taken, so a rotating khatma can hold up to 60 readers.

## 2. What Ali decided

1. **Rotating khatma only.** The pool khatma doesn't change.
2. **Both readers read the whole juz'.** There are no halves. Wirdak doesn't split a juz', track pages, or record who read which part. Ali: "we don't want to complicate that half or full, no need to be in the system".
3. **Done once.** Either reader can mark the juz' read. The first «أتممت» from either of them, or an organizer's mark, makes the juz' done for the day, for both of them.
4. **Both know they share.** Each reader is told that they share the juz', and with whom.
5. **Both get the messages, if they joined.** Each reader who joined through the join link, and hasn't stopped messages, gets the juz' message and the reminder. If only one of them joined, that's enough: the juz' still completes with that one reader's tap.
6. **Readers can't release a juz'.** Members only use WhatsApp, and they have no release. Only the owner, a co-organizer with the People permission, or an admin can move, free, or remove a reader. This is the rota as it is today.
7. **A juz' gets a second reader only when all 30 slots have a reader.** While any slot is empty, no slot can be shared.

## 3. Goals, non-goals, anti-goals

**Goals**

- An organizer adds a second reader to a juz' once every slot has a reader.
- Both readers of a shared juz' get its messages, and either one's «أتممت» completes it.
- The organizer sees both names on the participants page and on Today.
- It works: section 8 lists the tests and the staging check that prove it.

**Non-goals**

- Halves, parts, or page ranges of a juz'.
- More than two readers on one juz'.
- Sharing in the pool khatma.
- A way for a member to leave a juz' from WhatsApp.

**Anti-goals** (this fails even if it technically works if...)

- A shared juz' is counted twice in the day's «٢٦ / ٣٠», or a juz' stays undone after one of its readers tapped «أتممت».
- A reader of a shared juz' gets a reminder after the juz' is already done.
- Someone gets messages without tapping the join link themselves (rota design 2).
- A member other than the organizer sees who didn't read, or who covered whose juz' (rota design 2). Naming the partner in a reader's own juz' message is allowed, because Ali wants both to know they share. Nothing tells a reader whether their partner replied.
- A slot sits empty while another is shared, and the organizer can't see it (rota design 2, "a juz' assigned to nobody").
- The setup gets harder for an organizer with 30 people or fewer. Nothing about sharing shows until all 30 slots have a reader.

## 4. Slots with two readers

- Each of the 30 slots has no reader, one reader, or two readers. The two readers of a slot rotate together: on khatma `k` they both have the same juz'. Nothing about the rotation changes.
- The slot's first reader is whoever held it before the share. The second reader is the one added. The order only decides display order and who stays if the slot later needs one reader. Both readers have the same role in every other way **[builder's call]**.
- One person can't be both readers of the same slot.
- **The second reader is someone new to this khatma**: a new person, someone from the saved list, a join request, or a pool member brought in. A reader who already holds a slot can't also become the second reader of another slot. "Give a second juz'" and "move to another juz'" still target only empty slots, as today **[builder's call: sharing exists to fit more than 30 people, not to give one person more ajza']**.
- `rotaMaxSlotsPerPerson` counts a shared slot like a whole one for each of its readers, when the admin setting in section 7 is on.
- A rotating khatma holds up to 60 readers.

### 4.1 The "all 30 have a reader" rule

- A slot can take a second reader only while every one of the 30 slots has at least one reader. The server checks this rule on every path that adds a second reader, including the organizer's share action, accepting a join request, the saved-list and pool-import shortcuts, and the admin's share action. A request that breaks the rule is refused with a reason the website shows in plain Arabic.
- The rule is checked for the khatma the participants page shows (rota design 3.3), the same one placement changes apply to.
- **When a slot empties later** (its only reader is removed or moved), shared slots that already exist stay shared **[builder's call]**. The empty slot shows the way empty slots do today: on the participants page, on Today, and in the unread list. No new sharing is allowed until it has a reader again. To fill it, the organizer uses the existing "move to another juz'" on one reader of a shared slot, which makes the reader they leave behind whole again.
- Moving a reader into an empty slot is always allowed, so the organizer can always undo a share to fill a gap.

### 4.2 Leaving a shared slot

- Removing, moving, or freeing one reader of a shared slot leaves the other as its only reader. The sheet says so before it confirms: «سيقرأ فلان الجزء وحده». The change takes effect from the khatma the page shows. A reading day that's already fixed keeps both readers (rota design 3.3) **[builder's call]**.
- Members still can't do any of this themselves (section 2.6).

## 5. The reading day

### 5.1 Done once

- A shared juz' has one done state for the day. The first «أتممت» from either reader, typed «تم» included, or an organizer's mark, makes it done.
- **The other reader** then gets no reminder that day. If they tap «أتممت» afterwards, they get the usual «تقبّل الله منك» reply, with that moment's count, and nothing changes. «ليس بعد» from them after the juz' is done gets the same reply as «أتممت» does once a juz' is done, because there's nothing left to remind them of **[builder's call]**.
- **Who marked it** is recorded when a reader taps or types it: the reader who tapped first. Only the owner and co-organizers with the Readings permission see it. When an organizer marks it done, no reader is recorded. The "who read it" picker on the organizer's mark is Task 11 of the co-organizers plan, which isn't built and isn't part of this work **[builder's call]**.
- **Typed replies** (rota design 5.2). A shared juz' that the partner already finished, and that this reader hasn't answered, still counts as an open juz' for this reader's typed «تم», in the order Wirdak uses today: an ended day inside the late-tap window first, then today. The reply is the thanks reply, and nothing changes. So a «تم» meant for that juz' never marks a different juz' or another khatma's juz' done by mistake. If the reader has more than one open juz' across khatmas, the existing reply with one button per khatma applies **[builder's call]**.
- **Counts and cheers.** The day's «٢٦ / ٣٠» counts the juz' once. The reader who tapped first gets the credit Wirdak gives a finished juz' today, such as cheer notes. The partner doesn't, unless they tap too.
- **Late taps** (rota design 3.4) work the same way for both readers.

### 5.2 Messages

Each reader is handled separately: only a reader who joined, and who isn't stopped or silenced, gets anything.

| Message | Shared juz' |
| --- | --- |
| Welcome with today's juz' | Names the partner. |
| Juz' message | Names the partner: «المسجَّل لك الجزء ٢٦ (مشترك مع فلان) من هذه الختمة». |
| «ليس بعد» reply | Unchanged. |
| Reminder | Goes to each joined reader while the juz' isn't done. Names the partner: «لم تُسجَّل بعد قراءة الجزء ٢٦ (مشترك مع فلان) في هذه الختمة». Neither reader gets one once the juz' is done. |
| Reassigned to them | Unchanged. The person a juz' is reassigned to reads it alone that day. |
| «أتممت» reply | Unchanged, for both the first tap and a later tap. |
| Reassigned to someone else | Both readers get "your juz' was read for you" (rota design 5.1). |
| Khatma complete, dua | Unchanged. |
| End-of-cycle note | Unchanged. A reader of a shared juz' read the whole juz', so the note's words are true for them too **[builder's call]**. |

- The partner's name is the name the organizer gave them, the same name the organizer sees. If a reader holds more than one slot, each juz' names its own partner, and a juz' with no partner names nobody.
- **No new templates.** The juz' phrase is already a template parameter (`juzPhrase`, `juzPhraseGenitive`), and the approved bodies place it mid-sentence (`docs/whatsapp-rota-templates.md`). The partner goes into the phrase as a bracketed note right after the juz' it belongs to, «الجزء ٢٦ (مشترك مع فلان)», so the sentence around it still reads correctly. Two slots read «الجزآن ٥ (مشترك مع فلان) و٦». The builder checks every body that takes the phrase (`wirdak_rota_juz_v2`, `wirdak_rota_reminder`, `wirdak_rota_assigned_v2`, and the welcome) still reads as correct Arabic, with no newlines and within Meta's parameter limit **[builder's call]**. If a template needs new wording after all, that's a Linear task for Ali, and it blocks shipping.
- The partner is named whether or not they joined. "Sharing with" tells the reader who else is on the juz', not who replied **[builder's call]**.

### 5.3 Silence

The silence rule (rota design 5.3) counts replies, as today. A reader whose partner always taps first, and who never replies, gets a silence note after `rotaSilenceNoticeDays` and is stopped after `rotaSilenceStopDays`, like anyone else. The organizer is told, as today. The partner keeps getting the juz', so the juz' still completes. This protects the WhatsApp number's quality rating **[builder's call, carried over from the earlier design]**.

### 5.4 Today

- The grid stays 30 tiles. A shared juz' that isn't done shows both names in its sheet, each with their answer («لم يردّ» or «ليس بعد»).
- A done shared juz' shows who marked it, to those allowed to see it (5.1).
- Reassigning a shared juz' hands it to one person for the day, as today.
- The organizer's unread note doesn't change. It lists juz' numbers and names nobody, as it does today, so its template stays as it is **[builder's call]**. The names are on Today.

## 6. The participants page

- Nothing about sharing shows while any slot is empty.
- Once all 30 slots have a reader, a whole row's sheet gets «أضف قارئاً يشاركه الجزء». It picks a new or saved person the way the add sheet does, and refuses someone already in the khatma (section 4). It spells out what follows: «يقرأ فلان وفلانة الجزء ٧ في الختمة ١٢، ثم الجزء ٨ في الختمة ١٣. أيّهما سجّل أنه أتمّه يُحسب الجزء مقروءاً».
- A shared row shows both names, and whether each has joined.
- A short line above the list says how many readers there are when it's over 30: «٤٢ قارئاً، ١٢ جزءاً مشتركاً» **[builder's call]**.
- **Join requests** from numbers not on the khatma can be accepted onto a shared slot only when all 30 have a reader. Until then, they're accepted onto an empty slot, as today.
- **The saved list and «أضف أعضاء <khatma>»** fill empty slots first. Once all 30 have a reader, they share slots in order from the lowest-numbered slot with one reader.
- **"Start again from this"** copies shared slots as they are. If the copy has an empty slot, existing shares stay, and the rule in 4.1 applies from then on.
- **Co-organizers** need the People permission to share a slot, as for every other placement.
- **Admins** can do everything the organizer can (rota design 10.1), audited.

## 7. Admin settings

Both settings are already in `settingSpecs` and `settings.ts`.

| Key | Kind | Default | Use |
| --- | --- | --- | --- |
| `rotaSharedSlotsOn` | bool | on | Organizers can add a second reader to a rota juz'. Off hides the action and refuses it on the server. Shared slots that already exist carry on. |
| `rotaHalfCountsAsSlot` | bool | on | A shared slot counts toward `rotaMaxSlotsPerPerson` for each of its readers. Off means it doesn't count. |

The "half" in `rotaHalfCountsAsSlot` no longer matches the feature. The builder renames it to `rotaSharedCountsAsSlot` and moves any stored value to the new key, or keeps the key and fixes its label and comment, whichever is safer with stored settings. Either way, the admin page's explanation says "a shared juz'", not "a half" **[builder's call]**.

## 8. Making sure it works

Ali: "we need to make sure it works". Shipping needs all three of the checks below.

### 8.1 Tests

`bun run typecheck`, `bun run lint`, and `bun run test` pass, with tests that cover:

- Two readers on one slot rotate together: on khatma 2 both have juz' `s+1`.
- Sharing is refused while any slot is empty, on every path in 4.1, and allowed once all 30 have a reader.
- Existing shares stay when a slot empties, new sharing is refused until it's filled, and moving a sharer into the empty slot works.
- One person can't be both readers of a slot. A slot can't take a third reader.
- A khatma holds 60 readers.
- Removing, moving, or freeing one reader leaves the other whole from the next khatma, and the fixed day keeps both.
- Either reader's «أتممت» marks the juz' done once. The count goes up by one. The other gets no reminder. The other's later tap gets the thanks reply and changes nothing.
- Typed «تم» from either reader works, including in the late-tap window.
- A reader's typed «تم» after their partner finished the shared juz' gets the thanks reply and doesn't mark a different juz' done, in the same khatma or another one, during the day and in the late-tap window.
- Someone already in the khatma can't become a second reader.
- A reader who hasn't joined gets nothing, and the joined partner's tap completes the juz'.
- Each joined reader's juz' message and reminder name their partner. A reader with two slots gets each partner on the right juz'.
- Reassigning a shared juz' sends "read for you" to both readers.
- Today shows both readers and their answers.
- The silence rule for a partner who never replies.
- Each admin setting in section 7, on and off.
- The co-organizer People permission allows and refuses sharing.
- The longest juz' phrase, with partners, stays within Meta's parameter limit.

The e2e suite covers adding a second reader on a full khatma, and the share action being absent while a slot is empty.

### 8.2 Staging

On staging (Ali's rule: local or staging, not prod), with two real WhatsApp numbers:

1. Create a rotating khatma and fill all 30 slots. Bulk add with placeholder numbers that never join is fine, because they get no messages.
2. Before the last slot is filled, check that the share action doesn't show.
3. Put real number A on a slot, and share it with real number B. Both tap the join link.
4. At the juz' message time, check that A and B both get the juz' with each other's name.
5. Tap «أتممت» from A. Check that Today shows the juz' done once, «x / 30» went up by one, and B gets no reminder at the reminder time.
6. Tap «أتممت» from B. Check that B gets the thanks reply and nothing else changes.
7. Next reading day: B taps first this time. Check the same from the other side.
8. Share another slot where only one reader has joined. Check that the joined reader alone completes it.
9. Remove B. Check that A reads the juz' alone from the next khatma, and A's message no longer names a partner.

### 8.3 Review

The PR gets `/code-review`, and confirmed findings are fixed before it's handed over.

## 9. Left to the builder

- The schema for a second reader on a slot (a second `rotaSlots` row per slot is the obvious fit) and on a day's read (for example a `partnerId` on `rotaReads`), and the indexes the reminder, inbound, and silence paths need.
- The final Arabic wording, kept short and plain.
- Where the "all 30 have a reader" check lives, as long as every path in 4.1 goes through it.
- How the rename in section 7 is done.

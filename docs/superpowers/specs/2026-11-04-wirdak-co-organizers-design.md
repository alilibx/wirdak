# Wirdak co-organizers, marking done for anyone, and shared ajza': design

Linear: not filed yet (Wirdak project, P-ARQ-77). Date: 2026-11-04.

Items marked **[builder's call]** were decided while writing this up, not by Ali, and he can overturn any of them. Everything else comes from Ali's request on 2026-11-04 and his answer that a shared juz' is split in halves but marked done once.

## 1. Why

Organizers asked for three things the app doesn't do today:

1. **Mark a juz' done for anyone.** A member tells the organizer in the WhatsApp group "I read it" and never taps the button. The organizer wants to record it. Rota khatmas already allow this from the Today tab. Pool khatmas don't, because v1 spec 5.4 ruled it out ("The creator can't assign ajza' or mark ajza' done for others"). Ali now reverses that rule.
2. **More than 30 readers in a rotating khatma.** Groups bigger than 30 can't all take part. The rotating khatma design set this aside ("More than 30 people, with two people sharing a juz'. Ali: we can look at this later"). Now two people can share one juz', so a rotating khatma can have up to 60 readers.
3. **Help running a khatma.** One organizer can't always keep up. The organizer (now called the **owner**) can name one or more **co-organizers** (منظّم مساعد) and choose which controls each one gets.

Archive and delete stay with the owner. A khatma always has exactly one owner. If the owner wants someone else to archive or delete it, they transfer ownership.

## 2. Goals, non-goals, anti-goals

**Goals**

1. The owner and any co-organizer with the permission can mark any juz' of the current round or reading day done. Naming who read it is optional.
2. In a rotating khatma, each of the 30 juz' positions can have two readers, one per half. A rotating khatma holds up to 60 readers.
3. A shared juz' is marked done once. Either reader's «أتممت», or an organizer, marks the whole juz' done.
4. The owner adds co-organizers from the khatma's people and picks their permissions from a short list, with everything on by default.
5. Only the owner can archive, delete, transfer ownership, and manage co-organizers.
6. Admins can see and change co-organizers, like every other organizer control (they already have full access), and every admin change goes in the audit log.

**Non-goals**

- Sharing a juz' in a pool khatma. Ali scoped it to the rotating khatma.
- Splitting a juz' into more than two parts, or tracking each half's progress separately.
- More than one owner.
- Co-organizers starting a new khatma from an archived one. That belongs with archive, so it's owner-only **[builder's call]**.
- Changing what members see. Members never see who marked a juz' done, or who the co-organizers are, beyond what section 4.6 says.

**Anti-goals** (this fails even if it technically works if...)

- A member who isn't the owner or a co-organizer sees who didn't read, who covered whom, or who marked a juz' done (the v1 no-shaming rule).
- A co-organizer can archive or delete a khatma, transfer it, or change who else is a co-organizer.
- A khatma ends up with no owner, or two.
- A reading day ends with half a juz' assigned to nobody without the organizer seeing it.
- The setup gets harder for an 80-year-old owner who never uses co-organizers or shared ajza'. Both features stay out of the main path until someone asks for them (rotating khatma design 2.1).

## 3. Marking a juz' done for someone

### 3.1 Pool khatma

The pool grid's tiles become tappable for the owner and for co-organizers with the **Readings** permission (4.3).

- **A juz' someone is reading.** The sheet shows the reader's name and offers «سجّلته مقروءاً» (mark it read). It finishes their hold as if they had tapped «أتممت»: the tile turns done, any grace timers and the reminder for that hold are cancelled, and round completion follows the usual rule (v1 spec 3.6).
- **An open juz'.** The sheet offers «سجّلته مقروءاً» with an optional «قرأه:» picker listing the khatma's active members, and «لا أعرف» (don't know) chosen by default. Ali: who read it is "maybe by who but not required".
- **A done juz'.** The sheet offers «ألغِ التسجيل» (undo) until the round completes. A juz' marked done for nobody, or for someone who didn't hold it, goes back to open. A juz' its reader held goes back to being held by them, with a fresh grace from that moment, unless they now hold another juz'. A pool member holds one juz' at a time, so in that case it goes back to open **[builder's call]**.
- The member the juz' was marked done for gets no message. They see it done the next time they open the khatma **[builder's call: a message about someone else recording your reading reads like a nudge]**.
- **Their counts.** A juz' marked done for a named member counts in that member's "ajza' read" total and streak (`myStats`). It never counts toward pace (`personPace`), because its timing isn't theirs **[builder's call]**. A juz' marked for nobody counts for the khatma and the round, and for no person.
- The tile shows done with no name, as today (v1 spec 3.7). Only the owner and co-organizers with the Readings permission see, in the sheet, who it was recorded for and that an organizer recorded it.

This is a change to v1 spec 5.4 and plan 2's organizer controls. The data model must let a pool assignment exist without a person, or record it another way. That's left to the builder.

### 3.2 Rotating khatma

Rota khatmas already let the organizer mark any juz' of the day done or not done (rotating khatma design 6.2, `rota.markDone` and `rota.markNotDone`). Two changes:

- **The late window.** A member's late «أتممت» counts during `rotaLateTapMs` after midnight (rotating khatma design 3.4). Today the organizer can't mark anything once the day closes. The organizer may now mark done, or undo, until the same late window ends, for the reading day that just ended **[builder's call]**.
- **Who read it.** The sheet gets the same optional «قرأه:» picker as the pool khatma, listing the day's participants, with «لا أعرف» by default. It's recorded on the day's read, not shown to members.
- **Naming someone counts as their reply** for the silence rule (rotating khatma design 5.3), because the organizer is vouching that they're taking part. Without this, a member who only ever tells the organizer in the group would be stopped after `rotaSilenceStopDays`, which defeats the point **[builder's call]**. With «لا أعرف», nobody's silence count changes, as today.
- **Naming someone other than the day's reader** works like a reassignment that's already done: the day's reader gets the "your juz' was read for you" message (5.1 of the rotating khatma design), and the person named gets nothing **[builder's call]**. Naming the day's reader sends no message.
- **Credit.** The person named gets the credit Wirdak gives a finished juz' today (counts, cheer notes). With «لا أعرف», the juz' counts for the day only, as an organizer's mark does today.
- Co-organizers with the Readings permission can do all of this (4.3).

## 4. Owner and co-organizers

### 4.1 Words

- **Owner** (صاحب الختمة): the one person who holds the khatma. Today's `creatorPersonId`. Everything the organizer can do today, the owner can still do.
- **Co-organizer** (منظّم مساعد): someone the owner named, with some or all of the owner's controls, never the owner-only ones (4.4).
- In the interface, "organizer" (المنظّم) keeps meaning the owner wherever only one name fits, such as the members list. Co-organizers show as «منظّم مساعد» **[builder's call]**.

### 4.2 Who can be a co-organizer

- **Pool khatma:** any active member who isn't the owner.
- **Rotating khatma:** any participant who isn't the owner. A participant without a Wirdak account (WhatsApp-only) can be named. The role takes effect when someone signs in on the website with that participant's number **[builder's call]**. Until then the list shows «لم يسجّل الدخول بعد» (hasn't signed in yet) next to their name. A participant whose number the owner can't see (imported from a pool khatma, `phoneHidden`) already has an account, so they can be named the same way.
- At most `maxCoOrganizers` co-organizers per khatma (section 6).
- Someone who leaves the khatma stops being a co-organizer: a pool member who is removed, blocked, or becomes former, and a rota participant who is removed. Coming back doesn't restore the role.
- Only the owner can remove, block, or free the slots of a co-organizer. A co-organizer with People can't do it to another co-organizer, because that would change who else is a co-organizer (anti-goal). On the people pages, those rows show no remove control to co-organizers **[builder's call]**.

### 4.3 Permissions

Three switches. When someone is first named, they start with the admin's default permissions (section 6), which are all three on, so "all functionalities" is the default and one tap turns any of them off. Only the owner sets them, and can change them at any time (4.4a).

| Permission | Pool khatma | Rotating khatma |
| --- | --- | --- |
| **Readings** (القراءة) | Mark done and undo (3.1). | Today tab: mark done and not done, reassign, «سأقرؤه أنا» (I'll read it) (3.2). The unread list and the day summary. |
| **People** (المشاركون) | Remove and unblock members. Reset the invite link. | Participants: add, place, move, give a second juz' or a half, free, rename, remove. Import pool members. Join requests: accept and decline. Share and resend the join link. |
| **Settings** (الإعدادات) | Name, schedule, grace, cheer settings. | Name, reading days, start and end dates, time zone, message times and switches, late window, cheer settings, pause now, paused dates. |

Seeing a tab follows its permission: a co-organizer without People doesn't see the participants page's controls, and so on. A co-organizer always sees the khatma as a member does.

**Phone numbers.** A co-organizer with the People permission in a rotating khatma sees participants' numbers as the owner does, and the same hidden numbers stay hidden from them. The privacy page (Arabic and English) says that organizers can share a khatma's participant list with co-organizers they choose. Ali approves the wording before merge **[builder's call]**.

**The saved list (مشاركوني).** It stays the owner's, per person (rotating khatma design 8). A co-organizer who adds someone saves them to their own saved list, and picks from their own list **[builder's call: one person's contacts never leak to another]**.

### 4.4 Owner only

- Archive, restore, and delete the khatma.
- Start again from an archived rotating khatma.
- Transfer ownership (4.5).
- Name and remove co-organizers, and change their permissions.

A co-organizer never sees these controls. The server refuses them with `forbidden`, whatever the client sends.

### 4.4a The owner manages co-organizers

Ali: the owner (the main organizer) manages co-organizers' permissions. They sit in the khatma's settings, in a section only the owner sees, «المنظّمون المساعدون»:

- The list shows each co-organizer's name and which of the three permissions they have, in words («القراءة والمشاركون»).
- «أضف منظّماً مساعداً» opens a sheet that picks a person (4.2), then shows the three switches, already set to the admin's defaults. «حفظ» names them.
- Tapping a co-organizer opens the same switches, plus «أزل من المنظّمين المساعدين». A change takes effect at once: the co-organizer's screens update live, and the next call they make is checked against the new permissions.
- Turning all three switches off is allowed. The person stays named but can do nothing extra, and the list says «بلا صلاحيات» **[builder's call]**.
- Admins can do the same from the admin panel (4.7).

### 4.5 Transferring ownership

Today's "hand over" (`organizer.handOver`) becomes «انقل ملكية الختمة» (transfer ownership).

- The owner picks the new owner from the same people who could be co-organizers (4.2), and confirms. In a rotating khatma, the new owner must already have a Wirdak account, because ownership can't wait for a sign-in **[builder's call]**.
- The new owner gets the existing `nowOrganizer` note.
- The old owner becomes a co-organizer with all three permissions, so they can keep helping. The new owner can change or remove that **[builder's call]**.
- If the new owner was a co-organizer, that role ends: they're the owner now.
- **The 30-day automatic handover** (v1 spec 5.4) picks the longest-serving co-organizer seen in the last 7 days first. In a pool khatma it falls back to today's rule (the longest-standing active member seen in the last 7 days). Today rotating khatmas skip the handover entirely, because their readers aren't members. From now on a rotating khatma is handed over only to a co-organizer with an account seen in the last 7 days. With none, nothing changes, as today. The old owner becomes a co-organizer with all permissions here too, and gets the existing `organizerMoved` note **[builder's call]**.
- The owner's saved list doesn't move with the khatma (rotating khatma design 6.5).

### 4.6 Notes and messages

- **Named or removed.** The person named gets a new note kind, «أصبحت منظّماً مساعداً في <khatma>», in the app and by push. Removal sends nothing **[builder's call]**. Neither goes on WhatsApp: a new template needs Meta's approval, and this message isn't urgent **[builder's call]**.
- **Organizer notes** in a rotating khatma (unread list, day summary, join requests, silence notes, «أوقف الرسائل»): the owner gets them as today. Co-organizers whose permission covers the note get them in the app and by push (`coOrganizerNotesOn`). They don't get them on WhatsApp unless an admin turns on `coOrganizerWhatsAppOn`, so a khatma with five co-organizers doesn't send five paid messages by default **[builder's call]**. Readings covers the unread list and the day summary. People covers join requests, silence notes, and «أوقف الرسائل».
- **The pool khatma's open-for-help alert** (plan 2) goes to the owner, and to co-organizers with Readings in the app and by push **[builder's call]**.
- **Members** see nothing new. Members have no members list today, so the «منظّم مساعد» label appears only on the organizer pages that the owner and co-organizers see **[builder's call]**.

### 4.7 Admin panel

- The khatma view lists the owner and the co-organizers with their permissions.
- Admins can name and remove co-organizers, change their permissions, and transfer ownership, like every other organizer control (Ali's admin-full-access rule). Every change goes in the audit log.
- The new settings are in section 6.

## 5. Two readers on one juz' (rotating khatma)

> Replaced by `2026-11-09-wirdak-rota-shared-juz-design.md`: both readers read the whole juz' (no halves), and sharing opens only once all 30 slots have a reader.

### 5.1 Halves

- Each of the 30 slots (rotating khatma design 3.2) is **whole** (one reader) or **shared** (two readers). The two readers of a shared slot rotate together: on khatma `k` they both have the same juz'.
- The first reader of a shared slot reads the first half (النصف الأول) and the second reads the second half (النصف الثاني). A half is a hizb. Wirdak doesn't track the pages **[builder's call]**.
- A rotating khatma now has up to 60 readers: 30 slots, two each.
- `rotaMaxSlotsPerPerson` counts a half like a whole slot **[builder's call]**. One person can't hold both halves of the same slot.
- The juz' a half belongs to is still worked out from the slot and the khatma number. Nothing about the rotation changes.

### 5.2 Done once

Ali: "the done reading should be done once because the goal is for the juz' to be marked as read". So:

- A shared juz' has one done state for the day. The first «أتممت» from either reader, or an organizer's mark, makes the whole juz' done.
- **The other reader** then gets no reminder that day. If they tap «أتممت» afterwards, they get the usual «تقبّل الله منك» reply and nothing changes. That tap counts as their reply for the silence rule (rotating khatma design 5.3).
- **Who marked it** is recorded when Wirdak knows it (the reader who tapped, or the person the organizer picked). Only the owner and co-organizers with Readings see it.
- **Silence.** The silence rule counts replies, as today. A reader whose partner always taps first gets no reply counted, and is stopped after `rotaSilenceStopDays` like anyone else. The organizer is told, as today. This protects the WhatsApp number's quality rating **[builder's call]**.
- **Cheer notes and counts.** The reader who tapped gets the credit Wirdak gives a finished juz' today. The partner doesn't, unless they tap too. The day's "26 / 30" counts the juz' once.
- **The end-of-cycle note** (rotating khatma design 5.1) says the reader read the whole Quran over the cycle. Anyone who held a half during the cycle doesn't get it **[builder's call: the wording would be wrong for them]**.

### 5.3 The participants page

- A whole row keeps today's look. Tapping it adds a new action, «أضف قارئاً يشاركه الجزء» (add a reader to share this juz'). The sheet says what follows: «يقرأ فلان النصف الأول وفلانة النصف الثاني من الجزء ٧ في الختمة ١٢، ثم الجزء ٨ في الختمة ١٣».
- A shared row shows both names, each with its half.
- Removing or moving one reader of a shared slot makes the other reader whole again. The sheet says so before confirming: «سيقرأ فلان الجزء كاملاً». Changes take effect from the khatma the page shows (rotating khatma design 3.3) **[builder's call]**.
- «من ختمات سابقة» and «أضف أعضاء <khatma>» fill empty slots first, then offer to share slots in order, only once all 30 have a reader **[builder's call]**.
- Join requests can be accepted onto a free half as well as a free slot.
- "Start again from this" copies shared slots as they are.

### 5.4 The Today tab

- The grid stays 30 tiles. A shared juz' that isn't done shows both names in its sheet, with each reader's answer («لم يردّ», «ليس بعد»).
- Reassigning a shared juz' (rotating khatma design 6.2) hands the whole juz' to one person for the day. Both readers get today's "your juz' was read for you" message **[builder's call]**.
- The unread list names both readers of an unread shared juz'.

### 5.5 WhatsApp

- The juz' message, the reminder, and the reassignment message say the half: «جزؤك اليوم: النصف الأول من الجزء ٢٦». The juz' phrase is already a template parameter (`juzPhrase`, `juzPhraseGenitive`), so this may not need new templates. The builder checks that Meta accepts the longer parameter in the approved templates. If a template needs rewording or a re-review, that's a task for Ali.
- Typed replies work as today. «تم» from either reader marks the juz' done.
- Button payloads still identify the reading day and the slot. A tap from either reader of the slot is valid.

## 6. Admin settings

Ali: everything has a setting. Every feature here has an admin switch, and every number is an admin setting, in `settingSpecs` with its kind, bounds, and group. They show on the admin settings page with plain explanations, like the existing ones, and every change goes in the audit log.

| Setting | Kind | Default | Bounds | Group | What it does |
| --- | --- | --- | --- | --- | --- |
| `markDoneForOthersOn` | bool | on | | switches | Organizers can mark a pool juz' done for someone (3.1). Off hides the control. The rota Today tab keeps its existing mark-done, which predates this. |
| `markDoneNameOn` | bool | on | | switches | The «قرأه:» picker shows (3.1, 3.2). Off records every organizer mark as «لا أعرف». |
| `organizerLateMarkOn` | bool | on | | rota | Organizers can mark done during the late window after midnight (3.2). The window's length stays `rotaLateTapMs`. |
| `namedCountsAsReplyOn` | bool | on | | rota | Naming a rota reader counts as their reply for the silence rule (3.2). |
| `coOrganizersOn` | bool | on | | switches | Owners can name co-organizers. Off hides «المنظّمون المساعدون», and existing co-organizers keep their role but get no new ones **[builder's call]**. |
| `maxCoOrganizers` | int | 5 | 1 to 20 | limits | Co-organizers per khatma (4.2). |
| `coOrganizerDefaultReadings` | bool | on | | switches | The Readings switch's starting value when someone is named (4.3). |
| `coOrganizerDefaultPeople` | bool | on | | switches | The People switch's starting value. |
| `coOrganizerDefaultSettings` | bool | on | | switches | The Settings switch's starting value. |
| `coOrganizerNotesOn` | bool | on | | notifications | Co-organizers get the organizer notes their permissions cover, in the app and by push (4.6). |
| `coOrganizerWhatsAppOn` | bool | off | | notifications | Co-organizers also get those notes on WhatsApp, if they turned WhatsApp notes on. Off by default, because each copy is a paid message (4.6). |
| `handoverToCoOrganizerOn` | bool | on | | switches | The automatic handover tries co-organizers first, and hands rotating khatmas to them (4.5). Off keeps today's rule. |
| `oldOwnerStaysOn` | bool | on | | switches | After a transfer, the old owner stays as a co-organizer with all permissions (4.5). |
| `rotaSharedSlotsOn` | bool | on | | rota | Organizers can add a second reader to a rota juz' (5.1). Off hides the control. Shared slots that already exist carry on **[builder's call]**. |
| `rotaHalfCountsAsSlot` | bool | on | | rota | A half counts as a slot in `rotaMaxSlotsPerPerson` (5.1). |

The organizer-side controls are the owner's own: the per-co-organizer permission switches (4.4a). There's no per-khatma switch for shared slots: an organizer who doesn't want them doesn't add a second reader.

## 7. Constraints

- The pool khatma's member experience doesn't change, apart from the done tiles that organizers record (3.1).
- One owner per khatma, always. The server enforces every permission. The client only hides controls.
- Existing khatmas keep working with no migration step that an organizer has to do: every khatma starts with its current organizer as owner, no co-organizers, and only whole slots.
- No new WhatsApp templates unless 5.5 needs them.
- `bun run typecheck`, `bun run lint`, and `bun run test` pass. Unit tests cover each admin setting in section 6 (on and off), each permission against each control (allowed and refused), the owner-only controls refusing co-organizers, transfer and automatic handover with co-organizers, co-organizer roles ending when people leave, marking done for a named person and for nobody in a pool khatma (including counts and pace), undo, the rota late window for organizers, shared-slot rotation, done-once with two readers, the silence rule for a partner, and making a reader whole again. The e2e suite covers naming a co-organizer and using a permission, and adding a second reader to a juz'.

## 8. Test on staging

1. Create a pool khatma as Ali. Have a second test number join and take a juz'. Name it co-organizer with only Readings. Check it can mark the juz' done and can't see People, Settings, archive, delete, or transfer.
2. Mark an open juz' done for nobody and another for a named member. Check the counts, then undo one.
3. Transfer ownership to the co-organizer. Check the old owner is now a co-organizer with all permissions, and the new owner can archive.
4. In a rotating khatma with Ali's number on a slot, add a second reader to that slot. Check both get the half in the juz' message. Tap «أتممت» from one and check the juz' is done, the other gets no reminder, and a later tap from the other gets the thanks reply.
5. Remove one reader of the shared slot and check the other reads the whole juz' from the next khatma.

## 9. Left to the builder

- The data model: where co-organizers and their permissions live (a table keyed by khatma and person, or by phone for a rota participant without an account), how a pool assignment records "done for nobody", how a slot holds a second reader, and how a day's read records who marked it.
- How the permission check replaces `requireOrganizer`, `organizerOf`, and the rota's `requireRotaOrganizer` and `organizerRota`, and the `isOrganizer` checks on the website.
- The final Arabic wording.
- File layout and test structure.

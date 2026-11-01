# Wirdak rotating khatma: design

Linear: [ARQ-287](https://linear.app/manzilo/issue/ARQ-287). Set aside for later: [ARQ-288](https://linear.app/manzilo/issue/ARQ-288) (a week-long reading window). Date: 2026-10-29.

Items marked **[builder's call]** were decided while writing this up, not by Ali, and he can overturn any of them. Everything else comes from Ali, from the brainstorm on 2026-10-29, which followed his talk with Wirdak's first organizer.

## 1. Why

Wirdak's khatma today is a pool. People pick a free juz', and a round ends when all 30 are done. Wirdak's first real organizer runs his group differently, using Google Forms:

- He assigns each of about 30 people a juz'.
- Every day is one full khatma. Each person reads their juz' and marks it done on that day's form.
- The next day everyone moves up one juz'. Whoever read juz' 30 reads juz' 1.
- The days are numbered. Khatma 1 is the start date, khatma 2 is the next day, and after khatma 30 the count goes back to khatma 1. There's no end date. The organizer can skip a day if the group agrees.
- If someone hasn't read by the evening, others read their juz' so the day still completes.

He wants the form gone. Members should only need WhatsApp: a message with their juz' and buttons for "done" and "not yet", plus reminders, with no website to open.

This adds a second khatma type, the **rotating khatma** (ختمة بالتناوب). The pool khatma stays exactly as it is.

The people using it are often very old, organizers included. Ali: "this should be simple to setup so please be simple". Section 2.1 turns that into rules every screen and message follows, and Ali (as admin) can set a khatma up for someone or help run it (section 10.1).

## 2. Goals, non-goals, anti-goals

**Goals**

1. An organizer creates a rotating khatma with a name, reading days, the date of khatma 1, and an optional end date.
2. The organizer adds people by name and WhatsApp number and places each on a juz'. A person can hold two juz' when there are fewer than 30 people.
3. Members join by tapping a link the organizer shares, which sends a ready-written WhatsApp message. That tap is their opt-in.
4. Members take part through WhatsApp alone: their juz' each reading day, «أتممت» and «ليس بعد» buttons, a reminder, and the khatm dua when the khatma is complete.
5. The organizer sees each reading day's progress on the website, and reassigns an unread juz' to a member or reads it themselves.
6. Message times have defaults in the admin panel. The organizer can change each one, and turn off any except the juz' message.
7. The organizer can pause now (until resumed) or on chosen dates.
8. Each organizer keeps a saved list of participants that outlives any khatma.
9. An organizer can archive a khatma, start a new one from an archived one, and delete an archived one.
10. Only organizers an admin has turned it on for can create a rotating khatma (section 10).
11. An admin can set up a rotating khatma on an organizer's behalf, and can do anything its organizer can do (section 10.1).

### 2.1 Simple enough for an 80-year-old

These rules decide every screen and message. When a feature can't follow them, it moves out of the way (into settings or "more"), not onto the main path.

- **One question per screen** when setting up, with big fields and big buttons. Setup is two screens: name and days, then people.
- **Everything has a default.** "Every day", "starts tomorrow", "no end", and the admin's message times are already chosen. An organizer who only types a name and adds people gets a working khatma.
- **Add people in order.** At setup, the organizer types a name and a number and taps «أضف». The first person reads juz' 1 on khatma 1, the next juz' 2, and so on. The organizer is first in the list by default and can remove themselves **[builder's call]**. Placing someone on a particular juz' happens later, by tapping them (3.3).
- **No numbers to work out.** Nobody ever converts between a slot, khatma 1, and today. The app always says it in words: «يقرأ الجزء ٧ في الختمة ١٢، ثم ٨ في الختمة ١٣».
- **Members do nothing but tap.** One message a day, two buttons, and typed replies like «تم» work too. No website, no app, no code to copy.
- **Plain Arabic**, short sentences, no jargon («تناوب» is fine, «slot» never appears).
- **Hidden until needed:** message times, pausing, the saved list, archive. Each sits in settings. Reading days and the end date stay on the first setup screen, as plain choices with defaults (6.1).

**Non-goals**

- More than 30 people, with two people sharing a juz'. Ali: "we can look at this later".
- A week-long reading window where faster readers take extra ajza' (ARQ-288).
- Each member's own time zone. Every time is in the organizer's time zone for now.
- Hijri dates. The organizer picks Gregorian dates, including for Ramadan **[builder's call]**.
- A website for rotating khatma members. The website is for the organizer **[builder's call]**. A member who opens the khatma's link sees a short page that says the khatma runs on WhatsApp, with the join button.
- Removing the PIN from website sign-in. The PIN guards against a code-relay takeover (someone else's device shows a code, and the victim sends it), and the join links in this design teach people to send ready-written messages. Ali went with the recommendation to keep it.
- Changing the pool khatma, apart from archive and delete (section 9).

**Anti-goals** (this fails even if it technically works if...)

- Someone gets messages from Wirdak without tapping the join link themselves.
- A member other than the organizer sees who didn't read, or who covered whose juz'.
- A member gets a message they didn't prompt between 22:00 and 07:00 in the organizer's time zone, other than the assignment messages in 3.4 (Ali, ARQ-364). A reply to the member's own message, sent seconds after it, isn't one (3.4).
- A reading day ends with a juz' assigned to two people, or to nobody, without the organizer seeing it.
- The rotation drifts. Everyone must always be exactly one juz' further on than on the previous reading day.
- Message volume or spam reports lower the WhatsApp number's quality rating. Sign-in depends on the same number.

## 3. The rotation

### 3.1 Reading days and the khatma number

Each **reading day** is one full khatma of 30 ajza'. The organizer picks reading days in one of three ways:

| Choice | Example | Comes back to khatma 1 after |
| --- | --- | --- |
| Every day (كل يوم) | Daily from 29 October | 30 days |
| Chosen weekdays, every week or every two weeks (أيام من الأسبوع) | Every Friday. Mondays and Thursdays. Every other Friday. | 30 reading days (30 weeks for every Friday) |
| Chosen days of the month (أيام من الشهر) | The 1st and the 15th | 30 reading days |

- The organizer sets the date of khatma 1. It must be a reading day.
- The **khatma number** of a reading day is `((n - 1) mod 30) + 1`. Here `n` counts the reading days since khatma 1 that weren't paused, including this one. A paused day doesn't count, so the next reading day keeps the number the paused one would have had.
- The **cycle** is `floor((n - 1) / 30) + 1`. The website shows it ("الدورة ٢") so organizers can tell the first khatma 12 from the second **[builder's call]**.
- A day of the month that doesn't exist in a month (the 31st in November) is skipped that month **[builder's call]**.
- Ramadan is "every day" from 1 Ramadan with an end date 30 days later, which is exactly one cycle. Nothing special is needed.

### 3.2 Slots

- A rotating khatma has 30 **slots**, numbered 1 to 30. A slot is the juz' its holder reads on khatma 1.
- On a reading day with khatma number `k`, the holder of slot `s` reads juz' `((s - 1 + k - 1) mod 30) + 1`. So slot 7 reads juz' 7 on khatma 1, juz' 8 on khatma 2, and juz' 6 on khatma 30.
- Each slot has one holder or none. A person can hold more than one slot. Ali's example is two, for groups under 30 **[builder's call: no cap beyond 30 slots]**.
- An empty slot shows on the organizer's pages and in the unread list each reading day, so it can't be missed (anti-goal).

### 3.3 Placing a person: one question, always about a single khatma

The organizer never converts between "their juz' on khatma 1" and "their juz' today". The participants page always shows a single khatma, said in a banner:

- Before khatma 1: «جزء كل مشارك في الختمة ١».
- Once running: the next reading day whose juz' message hasn't gone out yet, for example «الختمة ١٣ يوم الجمعة ٢٢ يناير. هذا جزء كل مشارك فيها». As soon as a day's juz' message goes out, the page moves on to the following reading day **[builder's call]**.

A reading day's assignments are fixed when its juz' message goes out. After that, the day changes only from the Today tab (6.2): an empty or unread juz' is filled by reassigning it. The one exception is a member who joins during the day: the juz' their slot has that day becomes theirs if nobody has it and it isn't marked read (3.4).

The list has 30 rows, one per juz' of that khatma. Each row shows the reader's name and whether they've joined. An empty row says «+ أضف قارئاً للجزء ٧». Tapping it opens a sheet that adds a new person (name and WhatsApp number) or picks someone from the saved list. The sheet spells out what follows: «يقرأ الجزء ٧ في الختمة ١٢، ثم ٨ في الختمة ١٣، وهكذا». Wirdak works out the slot from the juz' and khatma number.

Tapping a filled row offers: move to another juz' (a free one, or swap with the person there), give a second juz', and remove from this khatma. A change takes effect from the khatma the page shows.

### 3.4 Reading day timeline

All times are in the khatma's time zone, which defaults to the organizer's (`people.timeZone`). The organizer can change it in settings.

| Message | Default | Can be turned off | Goes to |
| --- | --- | --- | --- |
| The juz' message, with «أتممت» and «ليس بعد» | 08:00 | No | Every member who has joined and holds a slot |
| Reminder | 16:00 | Yes | Members not done yet |
| Unread list | 19:00 | Yes | The organizer |
| Day summary | 21:00 | Yes | The organizer |

- The admin panel holds the defaults and the bounds. Each organizer can change the times for their khatma. Every time must fall outside quiet hours (today 22:00 to 07:00, the `quietStartHour` and `quietEndHour` settings), and the four must keep the order above. The juz' message may also go at 00:00, when the day starts (Ali, ARQ-364).
- Times are in 15-minute steps **[builder's call]**.
- **The reading day is the calendar day** (Ali, ARQ-364). It runs from 00:00 to 23:59:59 in the khatma's time zone, whatever time the juz' message goes. Assignments are fixed at 00:00.
- **Late taps** (Ali, ARQ-364). A reader's «أتممت» still counts for the day that just ended during a window after midnight: `rotaLateTapMs`, 8 hours by default, 0 to 12, and each khatma can have its own. Typed «تم» goes to their unread juz' of the ended day first. «ليس بعد» doesn't apply after midnight. The silence count waits for the window to end **[builder's call]**.
- **Starts** (Ali, ARQ-364). A rotating khatma's first day is tomorrow at the earliest, even when the organizer starts it today: an admin switch, `rotaStartNextDay`, on by default. A member who joins while a reading day is open (their slot is part of it) gets that day's juz' with its buttons in the welcome reply, inside the 24-hour window. That includes someone added after the day's message went out, when the juz' their slot has that day is free. Nothing is taken on a paused khatma, and a member accepted from a join request takes it only if the welcome can go at once. Someone who joined after the day started isn't sent the day's juz' message too **[builder's call]**.
- **Adding someone in the day's last six hours** (Ali). From 18:00 in the khatma's time zone, an organizer adding someone, typed, saved or from a join request, is asked whether they start today or on the next reading day. Choosing the next day means no juz' today, even if they join before midnight. The question doesn't appear when today's juz' for their slot has a reader or is marked read, when the khatma is paused, when no day is open, when there's no next reading day, or for a join request whose welcome can't go at once **[builder's call]**. Bringing in a pool khatma's members doesn't ask **[builder's call]**.
- **Quiet hours** **[builder's call]**. Every message Wirdak starts waits until quiet hours end, except the assignment messages: the juz' message, a reassignment, and the welcome go at once (Ali, ARQ-364), an admin switch, `rotaAssignDuringQuiet`, on by default. A reply to a member's own message goes out at once, at any hour, because they just wrote to us. That includes the dua for the member whose «أتممت» completed the khatma.
- When every juz' of the reading day is done, the khatma is **complete** (section 5.5). The day summary still goes to the organizer if it's on.
- A day that closes incomplete stays incomplete. The rotation moves on as usual.

### 3.5 Pause, end, and archive

- **Pause now** (settings switch): no messages, and reading days don't count until the organizer turns it back on. If it's paused during a reading day, that day still closes normally, and only later reading days are skipped **[builder's call]**.
- **Pause on dates**: the organizer adds dates from upcoming reading days. Each one is skipped and doesn't count. Paused dates can be removed until they arrive.
- **End date**: optional. The last reading day on or before it closes, then the khatma is archived automatically.
- **Changing reading days** after the start: the count carries on from the current number. The date of khatma 1 can't change once it has passed **[builder's call]**.

## 4. Joining

### 4.1 The join link

- Each rotating khatma has one join link. The organizer shares it in their existing WhatsApp group with the «شارك رابط الانضمام في مجموعتكم» button.
- The link is a `wa.me` link to Wirdak's business number, with the text already written: «انضمام إلى <khatma title> · <join code>». The join code is a short code that doesn't look like a sign-in code, so the matcher tells them apart **[builder's call]**.
- The member taps send. Wirdak checks the sender's number:
  - **A number on this khatma**: they've joined. Wirdak replies inside the 24-hour window with a welcome, the next reading day, and their juz' (section 5.1).
  - **A number not on this khatma**: Wirdak replies that the organizer has been told. The organizer gets a join request (section 6.4) to accept, which places the person, or to decline. A forwarded link alone never lets a stranger in **[builder's call]**.
- The join message is the only thing that turns WhatsApp messages on for a person in a khatma. Adding someone's number doesn't (anti-goal).
- **No PIN.** A join never signs a device in, so there's nothing to take over.
- The participants page shows «لم ينضمّ · أعد الإرسال» for people who haven't joined. "Resend" shares the same link again, to that person directly **[builder's call]**.

### 4.2 Joining the next khatma

Joining one khatma is consent to that khatma's messages only. A new khatma, including one started from an archive, needs its own join tap. Wirdak never sends an invitation to join, because Meta counts an invitation as marketing (the `behind` lesson in the WhatsApp templates design).

### 4.3 The organizer

The organizer is a participant like any other. They hold slots and join with the same link. They manage the khatma on the website and get its organizer messages (section 6.3).

## 5. The member's WhatsApp

### 5.1 Messages

| When | Message | Buttons |
| --- | --- | --- |
| After the join tap | «أهلاً <name>، انضممت إلى <khatma title>. تصلك رسالة جزئك يوم <next reading day> الساعة <time>.» If a reading day that includes them is open, it carries today's juz' instead (3.4). | «أتممت» «ليس بعد» when it carries a juz' |
| Juz' message time | Header: khatma title. «الختمة ١٢ اليوم. جزؤك: الجزء ٢٦.» Two slots: «جزآك: ٥ و٦». | «أتممت» «ليس بعد» |
| «ليس بعد» | «لا بأس، نذكّرك الساعة ٤ عصراً.» (no time when the reminder is off) | none |
| Reminder time | «تذكير: الجزء ٢٦ لم يُسجَّل بعد.» | «أتممت» «ليس بعد» |
| «أتممت» | «تقبّل الله منك. ٢٦ من ٣٠ جزءاً تمّت اليوم.» | none |
| Reassigned to them | «أُسند إليك الجزء ٨ في الختمة ١٢ اليوم.» | «أتممت» «ليس بعد» |
| Their juz' reassigned | «قُرئ الجزء ٨ عنك اليوم، فلا شيء عليك فيه.» It doesn't say who read it. | none |
| Khatma complete | Section 5.5 | |
| End of each cycle | A personal note: over these 30 reading days they've read the whole Quran once themselves **[builder's call: Ali agreed to the idea, wording open]**. | none |

- Wording here is a draft. The builder writes the final Arabic, keeping it short and plain, and gets it past Meta as UTILITY (section 7).
- With two slots, one «أتممت» marks both ajza' done **[builder's call]**. The organizer can correct a single one.
- Tapping «أتممت» twice, or after the day closed, gets a short reply and changes nothing.

### 5.2 Typed replies

- Typed text counts too, because some members won't use buttons. «تم», «أتممت», «الحمد لله» and similar mean done, and «ليس بعد» and «بعدين» mean not yet. The builder keeps a short list with spelling variants **[builder's call]**.
- Anything else from a rotating khatma member gets a short reply asking them to use the buttons. It doesn't get today's "no code found" sign-in reply.
- If a member has two open reading days in different khatmas, a typed «تم» gets a reply with one button per khatma **[builder's call]**.

### 5.3 Silence

- No reply on a day counts as «ليس بعد». Their juz' stays unmarked until the day closes. They get the reminder, and the juz' shows on the organizer's unread list.
- After **3** reading days in a row with no reply at all, the organizer gets a private note. After **7**, Wirdak stops messaging that member and tells the organizer. Their slots stay, and their ajza' show as unread every day. Any message from the member turns their messages back on **[builder's call; both numbers are admin settings]**. People who never answer tend to block the number, which lowers its quality rating.

### 5.4 Stopping

A member who replies «إيقاف» (or "stop") stops all messages from Wirdak for every rotating khatma they're in. Meta requires this. The organizer sees «أوقف الرسائل» next to their name, and the member stays on the organizer's saved list. Sending the join message again turns them back on.

### 5.5 When the khatma is complete

When the last juz' of a reading day is marked done, every member who has joined gets the khatm dua. That's the two duas the celebration page already shows (`t.celebration.duas`, Tanzil text, verbatim).

Meta marked our templates that contained prayers as marketing. So:

- Members inside the 24-hour window (they messaged us in the last 24 hours, by tapping a button for example) get the dua as a plain message. It needs no template.
- Everyone else gets the approved completion template («اكتملت الختمة ١٢.») with a «دعاء الختم» quick-reply button. Tapping it opens the window, and Wirdak replies with the dua.

The next juz' message brings everyone their next juz'.

## 6. The organizer's website

The rotating khatma's page has the app's existing tabs, adapted. These mockups were reviewed (local only, under `.superpowers/brainstorm/*/content/`): `organizer-flow-v2.html` for the participants list, settings and today, and `simple-setup-v3.html` for create and admin setup, which replaces v2's create screen.

### 6.1 Create

Create is two screens (mockup: `simple-setup-v4.html` for the first, `simple-setup-v3.html` for the second).

1. **Name and days.**
   - «ما اسم الختمة؟»
   - «متى تقرؤون؟» with three big choices: «كل يوم» (chosen), «كل أسبوع», «كل شهر». Picking «كل أسبوع» opens weekday chips inside the choice, with Friday chosen and more days allowed, plus «كل أسبوع» / «كل أسبوعين». Picking «كل شهر» opens the days of the month the same way.
   - Two lines, each with «تغيير»: «نبدأ: غداً، <date>» (the date of khatma 1) and «ننتهي: تستمر دائماً» (no end, or a date).
   - Message times don't appear here, because they use the defaults (Ali).
   - Ali found v3's single «أيام أخرى أو تاريخ نهاية» link unclear, which is why days and the end are separate here.
2. **People.** A name field, a number field, and «أضف», filling ajza' in order (2.1). Two shortcuts sit above the fields when they apply: «أضف أعضاء <current khatma>» for an organizer who already runs a pool khatma (10.2), and «من ختمات سابقة» for the saved list. If ajza' are left over, one line says so in words («بقي جزءان بلا قارئ (٢٩ و٣٠)») and offers to give them to someone. The big button at the bottom sends the join link to the group.

The type (pool or rotating) is chosen before these screens, as two big cards, and only by people an admin has turned rotating khatmas on for (section 10).

### 6.2 Today

- The reading day's number, cycle, and date, plus «٢٦ / ٣٠» done and when the next reading day is.
- The 30-juz' grid: done, unread, and reassigned.
- Tapping an unread juz' shows who holds it and whether they answered («لم يردّ» or «ليس بعد»), with two actions: «أسنده إلى مشارك» and «سأقرؤه أنا».
- Reassigning sends the two messages in 5.1. The organizer can reassign again. The juz' belongs to its latest assignee, and an earlier assignee's «أتممت» still counts **[builder's call: the day completing matters more than who finished]**.
- The organizer can also mark any juz' done for someone (a member who told them in the group) **[builder's call]**.

### 6.3 Organizer messages

The unread list, the day summary, join requests, silence notes and «أوقف الرسائل» reach the organizer the same way plan 2 notes do: an in-app note, push, and WhatsApp if they turned WhatsApp notifications on (`people.whatsappNotes`). Each gets its own note kind. The unread list names the readers, because only the organizer sees it.

### 6.4 Participants

The list in 3.3, plus:

- Join requests from numbers not on the khatma, each with accept (and choose a juz') or decline.
- The «شارك رابط الانضمام في مجموعتكم» button.
- People who stopped messages, and people Wirdak stopped messaging after silence.

### 6.5 Settings

- Pause: the "pause now" switch and the list of paused dates.
- Messages: the four times and their switches, and the time zone.
- Reading days, end date, and name.
- Archive (section 9).

The existing organizer controls (reset the invite link, hand over, remove a member) work as they do for the pool khatma where they apply. Handing over gives the new organizer the khatma, not the old organizer's saved list **[builder's call]**.

## 7. WhatsApp templates and cost

- Every business-started message needs an approved UTILITY template in `ar`, named in `convex/lib/whatsappTemplates.ts` like the existing ones. New ones: the juz' message, the reminder, reassigned to you, your juz' was covered, khatma complete, the cycle note, and the organizer messages that don't fit an existing template.
- The juz' message, the reminder and "reassigned to you" carry two quick-reply buttons. Each button's payload identifies the reading day and the person's slot, so a tap can't apply to the wrong day or khatma. On staging, it also marks the deployment (7.1).
- Replies to a member's own message (the welcome, the «ليس بعد» and «أتممت» answers, the dua) are sent inside the 24-hour window as plain or interactive messages, with no template.
- The lessons from the template work apply: no prayers, questions, or opt-out footers in template bodies, and no invitations. A template recategorized as MARKETING gets reworded, never sent as marketing.
- Quiet hours are checked again at send time, as `whatsappNotes.deliver` does.
- **Cost.** A 30-person daily khatma sends at least 30 templates a day. Meta doesn't charge for a utility template sent inside an open 24-hour window, and members who tap a button each day mostly stay inside it. The builder confirms Meta's current pricing and notes it in the PR. The silence rule (5.3) also limits paid messages to people who never answer.

### 7.1 Inbound handling

- `parseIncoming` reads only `text` messages today. It must also read quick-reply button replies (`button` and `interactive`).
- Inbound routing order: a sign-in code, then a join code, then a rotating member's button or typed reply. Anything left gets today's reply.
- Staging shares production's number, and Meta calls only production. Join codes and button replies that production doesn't recognize are relayed to staging, as unknown sign-in codes are today. A typed reply from a number production doesn't know as a rotating member is relayed too. The relay's signing, size cap and timeout stay as they are.

## 8. Saved participants (مشاركوني)

- Each organizer has a saved list of people, each with a name and a WhatsApp number. Adding someone to a rotating khatma saves them to the organizer's list. Picking from the list fills the sheet in 3.3.
- The list belongs to the organizer (the person), not to any khatma. Archiving or deleting a khatma never changes it. A person leaves it only when the organizer removes them.
- People added from the organizer's pool khatma (10.2) are saved by name, linked to their Wirdak account, and their number stays hidden from the organizer.
- Only the organizer sees their list's numbers. Admins can see them in the admin panel's person view, as they see members' numbers today **[builder's call]**.
- The privacy page (Arabic and English) says that organizers enter participants' names and numbers, and what WhatsApp messages those people get after they join. Ali approves the wording before merge.

## 9. Archive and delete

- **Archive** stops all messages and leaves the khatma read-only, with its history. It happens automatically after the end date, and the organizer can archive any time. Archived khatmas move to an «المؤرشفة» section of the home list **[builder's call]**.
- **Start again from this**, on an archived rotating khatma, creates a new rotating khatma with the same name, reading days, message settings, and people in the same slots. The organizer picks the new date of khatma 1, and everyone joins again (4.2).
- **Delete** is offered only on an archived khatma, after a confirmation. It removes the khatma and its history for everyone. The saved list stays.
- Members keep their own counts **[builder's call]**. Deleting a khatma doesn't lower anyone's "ajza' read" total or break their streak (`myStats`), so the reads behind those numbers must outlive the khatma in some form (left to the builder). Pace (`personPace`, which sets pool grace periods) counts only pool reads, never rotating ones. A rotating khatma hands out a juz' every reading day, which says nothing about how fast someone reads.
- Both apply to pool khatmas too **[builder's call; Ali was told and didn't object]**. Archiving a pool khatma also stops its rounds and notes.

## 10. Admin panel

- **Who can create a rotating khatma** (Ali). At launch an admin turns it on per person, from the person view. Without it, create offers only the pool khatma, and the rotating type doesn't appear. Turning it off later stops that person from creating new rotating khatmas, and their running ones carry on **[builder's call]**. Every change goes in the audit log.
- **A cap** on how many active (not archived) rotating khatmas one organizer runs at a time, an admin setting with a default of 2 **[builder's call]**. Both guard the number everyone signs in with: a 30-person daily khatma sends at least 30 templates a day.
- New settings with their kinds and bounds in `settingSpecs`: the four default message times, the silence thresholds (3 and 7 days), and the most slots one person can hold **[builder's call]**.
- The khatma view shows the type, and for a rotating khatma its reading days, current number and cycle, pause state, and today's progress.
- Stats count reading days completed. Whether they join `roundsCompleted` or get their own counter is left to the builder.

### 10.1 Setting up and helping on someone's behalf

Ali wants to set khatmas up for organizers who can't, and to help run them.

- **Set up on behalf.** In the admin panel, «أنشئ ختمة بالتناوب نيابةً عن منظّم» asks for the organizer's name and WhatsApp number, then shows the same two setup screens (6.1). The admin gets the join link to pass on.
- **The organizer takes over by joining.** Until the organizer's join message arrives from that number, the khatma has no active organizer and only admins manage it. When it arrives, they become the organizer, and the khatma shows as theirs if they ever sign in on the website **[builder's call]**. Organizer messages (6.3) go to the admin who set it up until then.
- **Help with any rotating khatma.** An admin can open any rotating khatma in the admin panel and do everything its organizer can: participants, reassigning, marking done, pause, settings, archive. An admin doesn't need the organizer's sign-in.
- **This is an exception to plan 3 spec 8**, where an admin sees a khatma's counts but never who reads what. For rotating khatmas, admins see names, numbers and the day's progress, because helping needs them. The privacy page says so. Every admin change goes in the audit log, like every admin action today.
- An admin-created khatma counts against the organizer's cap, and the per-person switch doesn't apply to it, since the admin decided **[builder's call]**.

### 10.2 Organizers who already use Wirdak

- **Turning it on.** The admin panel gets an «المنظّمون» list: everyone who organizes a khatma today, with their khatmas, member counts, and the rotating switch on each row. The same switch is on every person's page, and search finds anyone not on the list (mockup: `simple-setup-v4.html`).
- **Telling them.** Turning it on sends the person a note: «جديد لك: يمكنك الآن إنشاء ختمة بالتناوب…». It goes as an in-app note and push only, never WhatsApp, because Meta reads "you can now…" as marketing however it's worded (the `behind` lesson) **[builder's call]**. If you want to tell them yourself, do it from the admin panel's person page. Create then shows the rotating type.
- **Bringing their members.** On the people screen, «أضف أعضاء <khatma>» adds the active members of a pool khatma they organize, in join order, by name. The organizer still doesn't see those members' numbers, as today (plan 2 spec 6.1). Wirdak already has them. Each member still taps the new join link once (4.2) **[builder's call]**.
- Their pool khatma carries on unchanged. Turning a pool khatma into a rotating one in place isn't offered **[builder's call: the two keep different history, and starting fresh is one tap]**.

## 11. Constraints

- The pool khatma's behavior doesn't change, apart from archive and delete.
- Staging sends from production's number to real phones and costs the same. Tests send only to Ali's number.
- No new environment variables, unless the relay needs one.
- `bun run typecheck`, `bun run lint` and `bun run test` pass. Unit tests cover the rotation arithmetic (every reading-day kind, pauses, cycle rollover, skipped month days), placing a person from a juz' and khatma number, day closing, the inbound routing order, typed reply matching, button payloads, the silence rule, and the template parameters. The e2e suite covers create, participants, and today for the organizer.

## 12. Test on staging

1. Create and get approval for the templates.
2. Deploy the branch to staging.
3. Create a daily rotating khatma whose khatma 1 is today, with Ali's number on one slot and the rest empty.
4. Join through the link from Ali's phone. Check that the welcome carries today's juz' (3.4), then «ليس بعد», the reminder, «أتممت», and a typed «تم» the next day after the juz' message.
5. Mark the other 29 ajza' done as the organizer and check the dua message.
6. From the admin panel, set up a second khatma on behalf of an organizer with Ali's number, and check that joining makes Ali its organizer.
7. Pause tomorrow, check that no message arrives and the number doesn't move, then check the next reading day.

## 13. Left to the builder

- The data model: tables, indexes, and how reading days and their assignments are stored. One reading day row with 30 assignment rows, created when the day starts, is the obvious fit with today's rounds and assignments.
- How scheduled sends are driven (crons against per-khatma scheduled functions), as long as times land in their 15-minute step.
- Whether WhatsApp-only members get a `people` row. If they do, the phone their join message came from counts as verified, and a later website sign-in with that number shows the khatma.
- The final Arabic wording, within section 5's meaning.
- File layout and test structure.

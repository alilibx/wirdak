# Rota khatma: add several saved participants in one go

Status: draft, waiting for Ali's OK. Linear: not filed yet (see the last section).

## Why

Ali asked for two things, in their words: "bulk add people that already existing into a khatma", and "if people are already active i can auto enroll them or what do you think?"

An organizer who runs a second or third rota khatma usually wants mostly the same readers again. Today they add them one tap, and one server call, at a time. On a running khatma it is worse: saved people can be added only from an empty juz' row, so filling ten free ajza' takes ten trips into ten sheets.

## What "already existing" means today

| Source | Where | What exists |
|---|---|---|
| Saved participants («من ختمات سابقة») | `rotaContacts`, `ops.saved`, `ops.addSaved`, `SavedPicker.tsx` | Everyone the organizer ever added to a rota: typed, accepted from a join request, or imported from a pool. One tap adds one person. |
| Members of the organizer's pool khatmas | `rota.importable`, `rota.importMembers` | Whole-pool import in one press, numbers hidden. Already bulk. |
| People in the organizer's other rota khatmas | none of its own | Already covered: every one of them is a saved participant. |
| The admin directory | `readerDirectory`, `people`, `adminPeople.ts` | Every reader in Wirdak. Not tied to any organizer. |

So the saved list is the source. It already includes the other two organizer-owned sources.

## Recommendation on auto-enroll: no

Don't put active people into a new khatma automatically. Let the organizer pick them, with a fast way to tick the active ones, and have each person send that khatma's join message as today. The reasons:

1. **The opt-in is per khatma.** `joinedAt` sits on each `rotaParticipants` row, and `reachable()` in `rotaOutbox.ts` sends nothing a business starts until that person's own join message for that khatma. An auto-enrolled person holds a juz' that no message reaches. The juz' goes unread every day until the organizer covers it or they join.
2. **Wirdak can't tell them they were added.** A "you were added" or "join this khatma" message is an invitation, and Meta classed every invitation-like wording as MARKETING (`docs/whatsapp-rota-templates.md`). Free text works only inside the 24-hour window. The organizer's group link is the only channel, as it is now.
3. **Consent carries meaning.** Joining one khatma is agreeing to its daily juz' and time. Copying that to another khatma, with another time and schedule, is a decision the reader didn't make. «إيقاف» already stops every khatma at once; we shouldn't create khatmas they never agreed to.
4. **Caps make "auto" ambiguous.** A rota has 30 ajza', `rotaMaxSlotsPerPerson` and `rotaMaxActivePerOrganizer` apply, and an organizer may have more active readers than free ajza'. Someone has to choose who gets in; that is the organizer.

What Ali wants from "auto" is speed. The picker gives that: active readers are listed first and one press ticks them.

## Goals

- Tick several saved participants and add them in one press and one server call.
- Reach it from the running khatma's People screen, not only from setup.
- Show who reads with the organizer right now, and tick them in one press.
- Same feature on the admin rota screens, through the shared rota backend.

## Non-goals

- Automatic enrollment, and treating one khatma's join as another's (see above).
- Any WhatsApp message on add. Nothing is sent until the person joins.
- Pool khatmas. Members join through the invite link. Adding an account silently would put a khatma on their home screen and send them push notes they didn't ask for.
- Picking from the admin directory. It would put strangers' names, and maybe numbers, in an organizer's khatma.
- Picking single members from a pool khatma. Whole-pool import stays as it is.
- Choosing a juz' per person in the bulk add. Everyone goes to the lowest free juz', as in setup today.

## Anti-goals

- Adding someone into a juz' the organizer didn't mean to fill. If there is less room than ticks, the picker stops ticking; the server never silently drops people without saying so.
- Showing a hidden pool number. Contacts with `phone === null` stay numberless in every view.

## Design

### Server

`ops.addSavedMany(ctx, khatma, rota, { contactIds, readsToday? })` in `convex/lib/rotaOps/people.ts`.

- `contactIds`: 1 to 30 ids (`ROTA_SIZE`); more throws `ConvexError({ code: "too_many" })`. Duplicates are ignored.
- Each id is checked as `addSaved` checks it (owner, `removedAt`, a phone to resolve). Bad ones count as `notFound`. Already in the khatma counts as `alreadyIn`.
- People go in the order given, each to the lowest free juz' of the target day, through `placeNewParticipant`. When the ajza' run out, the rest count as `noRoom`.
- **Late in the day, ask once, before writing.** When `readsToday` is undefined and any of the slots the batch would take is late-in-the-day free (the `lateInTheDay` rule with `joined = false`), return `{ error: "ask_today" }` before inserting anything. With an answer, it applies to the whole batch. Factor the check out of `placeNewParticipant` so both use it.
- Returns `{ ok: true, added: number, alreadyIn: number, noRoom: number, notFound: number }`.
- No new rate limit: 30 ajza' bound one call, and single adds have none.

Public mutations:

- `rota.addSavedMany`, a `sessionMutation` behind `requireRotaOrganizer`, beside `addSaved`.
- `adminRota.addSavedMany`, an `adminMutation` behind `requireLiveRota`, wrapped in `audited(ctx, args, "addSavedMany", …)`. One audit row per call.

`ops.saved` gains `active: boolean` on each contact: the same phone (for a hidden contact, the linked person's phone) has a row in another non-archived rota khatma of this organizer, whose setup is done (`setupDoneAt` set), that is not removed, joined, not stopped, not silenced, and holds at least one juz' (a `rotaSlots` row). The last rule matches `spreadFreeJuz`: someone who holds nothing was taken off on purpose, so the one-press button must not tick them back (builder check; my call). Use the `rotaParticipants.by_phone` index. Sort: active first, then by name (Arabic collation) as now.

### Web (organizer and admin share it)

`SavedPicker.tsx`:

- **With `juz`** (an empty row's sheet): unchanged. One tap adds that person to that juz'.
- **Without `juz`** (setup, and the People screen): a checklist.
  - Each row is a checkbox row, `min-h-14`, name and (when shown) number. In-khatma rows stay disabled with «في الختمة». Active rows carry a small tag «يقرأ معك الآن».
  - A line above the list says how many free ajza' there are. Once the ticks equal it, the other rows can't be ticked.
  - «اختر من يقرأ معك الآن» ticks the active rows from the top, up to the room. Shown only when some active row can be ticked.
  - A full-width primary button «أضِف (n)» at the bottom, disabled at 0.
  - `useAddCall` handles `ask_today` as now. The question copy becomes plural when n > 1.
  - On success the sheet closes and the screen shows one status line: how many were added, how many didn't fit, and «ليصلهم وِردهم، يرسل كلٌّ منهم رسالة الانضمام من رابط المجموعة». Use `arabicCount` for the counts.
- `backend.tsx`: add `addSavedMany` to `organizerFunctions`, and to the admin backend.

`PeoplePanel.tsx`: in the leftover banner (shown when `freeJuz.length > 0`), add a ghost button «أضف من ختمات سابقة» beside `SpreadFreeJuz`, shown when some saved contact is not in the khatma. It opens the checklist picker. The result line uses the same status `<p>` as the spread result.

`RotaPeopleSetup.tsx`: the existing «من ختمات سابقة» button opens the checklist instead of the one-tap list.

All new copy goes in `apps/web/src/i18n/ar.ts` under `t.rota`.

### People count on the organizer's khatma cards

Ali added this on review: "in the khatma list for the organizer show the number of people in the khatma so that its easy to spot."

- `khatmas.mine` (`convex/khatmas.ts`) gains `peopleCount: number | null`. It is a number only on khatmas the viewer organizes (`creatorPersonId === personId`); for the others it is null. Use `memberCount` from `convex/adminLookup.ts`: active members of a pool, readers still on the list of a rota (joined or not). Move it to `convex/lib/` if importing from `adminLookup` looks wrong; that is the builder's call.
- `KhatmaCard` in `HomePage.tsx` shows it as a small pill under the progress line, e.g. «١٢ شخصاً», using `counted` from `convex/lib/arabicCount.ts` (1 «شخص واحد», 2 «شخصان»). Shown on archived cards too.
- The khatma switcher sheet (`SwitchKhatmaSheet.tsx`) is left as it is (my call: the home list is "the khatma list").
- Same branch and PR as the bulk add, its own commit.

### Tests

- Convex (`convex/rota.saved.test.ts`): adds in order to free ajza'; skips in-khatma and foreign or removed contacts; `noRoom` when ajza' run out; `ask_today` returns before any row is written, then the answer applies to all; hidden contacts stay `phoneHidden`; over 30 ids throws; `active` flag and sort in `saved`; admin call writes one audit row.
- Web unit (`SavedPicker.test.tsx`, `PeoplePanel.test.tsx`): ticking, the room cap, the active button, the count on the add button, the result line, the empty-row sheet still adds in one tap, the banner button shows only when someone can be added.
- People count: `khatmas.test.ts` checks `peopleCount` for an organizer (pool and rota, removed readers and left members not counted) and null for a member; `HomePage.test.tsx` checks the pill shows only on organized khatmas, with the 1, 2, and 3+ forms.
- e2e (`e2e/rota.spec.ts`): an organizer with saved people from an earlier khatma opens a new khatma's People screen, ticks three, presses add, and sees them on the first free ajza'. Add the same in `e2e/admin-rota.spec.ts` if its fixtures allow without a new seed.

## Left to the builder

- Exact Arabic wording, apart from the strings above.
- Whether the picker's room count is taken from `people.freeJuz` or a field added to `saved`.
- Whether an admin call that adds nobody still writes an audit row (`audited` takes a `changed` flag).
- How the setup screen shows the result line (`BringPeopleInList` has a `result` slot only on the pool-import path today).

## Open with Ali

- Approve this design.
- Linear: no issue matches (ADA-74 is the closest, done). Filing the new one was blocked by a permission check in this session; it needs Ali's go-ahead.

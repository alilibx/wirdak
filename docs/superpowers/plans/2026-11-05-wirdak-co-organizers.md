# Co-organizers, marking done for anyone, and shared rota ajza': implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owners can name co-organizers with three permissions, organizers can mark any juz' done for anyone in both khatma types, and a rota juz' can be shared by two readers (halves) who mark it done once.

**Architecture:** One new table, `coOrganizers`, keyed by khatma and phone, and one authority helper, `roleIn`, that every organizer function goes through with the permission it needs (`"owner" | "readings" | "people" | "settings"`). Pool mark-done reuses the `finish` path through a shared helper. Shared ajza' add a `half` to `rotaSlots` and a `partnerId` to `rotaReads`, so a day still has one read per juz' and "done once" falls out of the data.

**Tech Stack:** Convex (TypeScript), React + Vite (website `apps/web`, admin `apps/admin`), Vitest + convex-test, Bun, `convex-helpers`.

**Spec:** `docs/superpowers/specs/2026-11-04-wirdak-co-organizers-design.md`. Section numbers below (§) refer to it. Executors read both.

## Global Constraints

- No AI attribution anywhere: no `Co-Authored-By` for Claude, no "Generated with Claude Code", no session links (repo `CLAUDE.md`). Check every commit message with the grep in `CLAUDE.md`.
- Branches: `feat/` prefix, Conventional Commits, one PR per part (Parts 1, 2, 3), each reviewed with `/code-review` right after `gh pr create`.
- `bun run typecheck`, `bun run lint`, and `bun run test` pass at the end of every task.
- One owner per khatma, always. The server enforces every permission. The client only hides controls (§7).
- Existing khatmas need no migration step: every khatma starts with its current organizer as owner, no co-organizers, and only whole slots (§7). New schema fields are `v.optional`.
- No new WhatsApp templates. Halves travel inside the existing juz' phrase parameter (§5.5).
- Members see nothing new (§4.6). Who marked a juz' done, and who the co-organizers are, reach only the owner and co-organizers with the matching permission.
- Staging sends to real phones from production's number. Tests send only to Ali's number (rota spec §11).
- A new admin setting goes in all seven places: `convex/lib/settings.ts` `SETTING_DEFAULTS`, `convex/lib/settingSpecs.ts` `SETTING_SPECS`, `convex/lib/settings.test.ts` "defaults match the spec", `apps/admin/src/lib/settingLayout.ts`, `apps/admin/src/i18n/ar.ts` `labels`, `apps/admin/src/i18n/settingsHelp.ts` `help`. `settingSpecs.test.ts` already checks every default and that `rota*` keys are in group `rota`.

## Review Focus

1. **A co-organizer whose membership ends while their page is open.** Their next call is refused with `forbidden`, not half-applied. Test in Task 4.
2. **The owner turns a permission off while the co-organizer is mid-action.** The next call needing it is refused, and the page drops the control live. Test in Task 4.
3. **Marking an open pool juz' at the moment someone takes it.** The organizer's mark finishes that person's new hold instead of creating a second row for the juz'. Test in Task 9.
4. **Removing one reader of a shared slot after today's juz' message went out.** Today's read keeps both readers, and either one's «أتممت» still counts today. The change applies from the khatma the page shows. Test in Task 12.
5. **Transferring a rota khatma to a co-organizer who hasn't signed in yet.** Refused with `no_account`, and nothing changes. Test in Task 6.

---

# Part 1: Co-organizers and ownership (branch `feat/co-organizers`)

### Task 1: Admin settings for every feature

**Files:**
- Modify: `convex/lib/settings.ts`, `convex/lib/settingSpecs.ts`, `convex/lib/settings.test.ts`
- Modify: `apps/admin/src/lib/settingLayout.ts`, `apps/admin/src/i18n/ar.ts`, `apps/admin/src/i18n/settingsHelp.ts`

**Interfaces:**
- Produces: these keys for `getSetting(ctx, key)`, with defaults and specs copied from §6.

| Key | Default | Spec |
| --- | --- | --- |
| `markDoneForOthersOn` | `true` | `{ kind: "bool", group: "switches" }` |
| `markDoneNameOn` | `true` | `{ kind: "bool", group: "switches" }` |
| `organizerLateMarkOn` | `true` | `{ kind: "bool", group: "rota" }` |
| `namedCountsAsReplyOn` | `true` | `{ kind: "bool", group: "rota" }` |
| `coOrganizersOn` | `true` | `{ kind: "bool", group: "switches" }` |
| `maxCoOrganizers` | `5` | `{ kind: "int", min: 1, max: 20, group: "limits" }` |
| `coOrganizerDefaultReadings` | `true` | `{ kind: "bool", group: "switches" }` |
| `coOrganizerDefaultPeople` | `true` | `{ kind: "bool", group: "switches" }` |
| `coOrganizerDefaultSettings` | `true` | `{ kind: "bool", group: "switches" }` |
| `coOrganizerNotesOn` | `true` | `{ kind: "bool", group: "notifications" }` |
| `coOrganizerWhatsAppOn` | `false` | `{ kind: "bool", group: "notifications" }` |
| `handoverToCoOrganizerOn` | `true` | `{ kind: "bool", group: "switches" }` |
| `oldOwnerStaysOn` | `true` | `{ kind: "bool", group: "switches" }` |
| `rotaSharedSlotsOn` | `true` | `{ kind: "bool", group: "rota" }` |
| `rotaHalfCountsAsSlot` | `true` | `{ kind: "bool", group: "rota" }` |

- [ ] **Step 1:** Add the 15 keys to the expected object in `convex/lib/settings.test.ts` "defaults match the spec". Run `bunx vitest run convex/lib/settings.test.ts`. Expected: FAIL (keys missing).
- [ ] **Step 2:** Add the defaults and specs. Put the keys in `settingLayout.ts` sections: a new section «المنظّمون المساعدون» in `switches` for the six `coOrganizer*`, `handoverToCoOrganizerOn` and `oldOwnerStaysOn` keys; `markDone*` in the existing switches section; `maxCoOrganizers` in limits; the two notification keys in notifications; the four rota keys in a new rota section «القراءة المشتركة والتسجيل». Write an Arabic label and a `{what, why}` help entry for each, taking the meaning from §6's "What it does" column.
- [ ] **Step 3:** Run `bunx vitest run convex/lib apps/admin/src/lib apps/admin/src/pages/SettingsPage.test.tsx`. Expected: PASS, including `settingLayout.test.ts` "places every setting exactly once".
- [ ] **Step 4:** Commit: `feat(settings): add the co-organizer, mark-done and shared-juz' settings`.

### Task 2: The `coOrganizers` table and the role check

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/lib/organizerAuth.ts`, `convex/lib/organizerAuth.test.ts`
- Modify: `convex/organizer.ts:58-110` (`organizerOf`, `requireOrganizer`, `requireLiveOrganizer`, `requirePoolOrganizer`)

**Interfaces:**
- Produces:
  - Table `coOrganizers { khatmaId: Id<"khatmas">, phone: string /* E.164 */, readings: boolean, people: boolean, settings: boolean, addedAt: number }`, with indexes `by_khatma ["khatmaId"]`, `by_khatma_phone ["khatmaId","phone"]`, and `by_phone ["phone"]`. Keying by phone lets a rota participant with no account be named. The role takes effect when someone signs in with that number, with no hook needed for the check (§4.2).
  - `type Permission = "readings" | "people" | "settings"`
  - `type Need = Permission | "owner"`
  - `type OrganizerRole = { owner: true } | { owner: false; readings: boolean; people: boolean; settings: boolean }`
  - `roleIn(ctx: QueryCtx, khatma: Doc<"khatmas">, person: Doc<"people"> | null): Promise<OrganizerRole | null>` returns the owner when `creatorPersonId === person._id` and the person has an active membership (today's rule). It returns a co-organizer role when a `coOrganizers` row matches `person.phone` **and** the person is still in the khatma: an active `members` row for pool, or a `rotaParticipants` row with that phone and `removedAt === null` for rota. Otherwise it returns `null`.
  - `allows(role: OrganizerRole | null, need: Need): boolean`. The owner passes every need. A co-organizer never passes `"owner"`.
  - `organizerOf(ctx, inviteCode, person, need: Need = "owner"): Promise<{ person; khatma; role: OrganizerRole } | null>` and `requireOrganizer(ctx, inviteCode, need: Need = "owner")`. The default `"owner"` keeps every existing caller exactly as strict as today until Task 4 relaxes it. `requireLiveOrganizer` and `requirePoolOrganizer` take and forward `need` the same way.
- [ ] **Step 1: Write the failing tests** in `convex/lib/organizerAuth.test.ts`:
  - `"the owner passes every need"`: `allows({owner:true}, n)` is true for all four needs.
  - `"a co-organizer passes only its switches, never owner"`: `{owner:false, readings:true, people:false, settings:false}` gives `readings` true, `people` false, `owner` false.
  - `"roleIn finds a pool co-organizer by phone while they are an active member"`: insert a member and a `coOrganizers` row with their phone, and the role is a co-organizer. Patch the member to `status:"blocked"` and `roleIn` returns `null`.
  - `"roleIn finds a rota co-organizer only while their participant row is live"`: set `removedAt` and it returns `null`.
  - `"a removed owner holds no role"`: the creator with no active membership gives `null`.
- [ ] **Step 2:** Run `bunx vitest run convex/lib/organizerAuth.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Add the table and `convex/lib/organizerAuth.ts`, then thread `need` through the four helpers in `convex/organizer.ts`.
- [ ] **Step 4:** Run `bunx vitest run convex/lib/organizerAuth.test.ts convex/organizer.test.ts convex/rota*.test.ts convex/khatmaLifecycle.test.ts`. Expected: PASS, with existing tests unchanged.
- [ ] **Step 5:** Commit: `feat(organizer): add co-organizer roles keyed by phone`.

### Task 3: The owner names, edits, and removes co-organizers

**Files:**
- Create: `convex/coOrganizers.ts`, `convex/coOrganizers.test.ts`
- Modify: `convex/organizer.ts` (`otherMember` :349, `removeMember` :368, `blockMember` :383), `convex/lib/rotaOps/people.ts` (`removeParticipant` :528), `convex/verification.ts` (where a `people` row is inserted for a new number)

**Interfaces:**
- Consumes: `requireOrganizer(ctx, inviteCode, "owner")` and `roleIn` (Task 2).
- Produces:
  - `coOrganizers.list` (sessionQuery, owner only, `{ inviteCode }`) returns `{ max: number; enabled: boolean; defaults: { readings; people; settings }; coOrganizers: { coOrganizerId: Id<"coOrganizers">; name: string; readings; people; settings; pending: boolean }[]; candidates: { candidateId: string; name: string }[] } | { forbidden: true }`. Candidates are active pool members, or live rota participants, excluding the owner and people already named. `pending` is true when no `people` row has that phone. No phone ever leaves this query.
  - `coOrganizers.set` (sessionMutation, owner only, `{ inviteCode; candidateId?: string; coOrganizerId?: Id<"coOrganizers">; readings: boolean; people: boolean; settings: boolean }`) returns `{ ok: true } | { error: "disabled" | "full" | "not_member" | "self" }`. With `candidateId` it names a new person. That refuses `disabled` when `coOrganizersOn` is off, and `full` at `maxCoOrganizers`. With `coOrganizerId` it edits the switches, which is allowed even when the feature is off. Naming a rota participant who has an account also makes sure they have an active `members` row with `notificationsOn: true` (the rota owner has one today), so the khatma shows on their home list and push reaches them.
  - `coOrganizers.remove` (sessionMutation, owner only, `{ inviteCode; coOrganizerId }`) returns `{ ok: true } | { error: "not_found" }`.
  - `endCoOrganizer(ctx: MutationCtx, khatmaId: Id<"khatmas">, phone: string): Promise<void>`, exported, deletes the row if present.
  - `linkCoOrganizerRoles(ctx: MutationCtx, person: Doc<"people">): Promise<void>` adds the `members` row from above for every rota `coOrganizers` row with this phone. It's called once where verification inserts a new `people` row.
- [ ] **Step 1: Write the failing tests** in `convex/coOrganizers.test.ts`:
  - `"the owner names a member with the admin's default switches"`: set the defaults to `readings:true, people:false, settings:true`, and `list` reports them.
  - `"a co-organizer and a stranger cannot list, set, or remove"`: each gets `forbidden`.
  - `"naming stops at maxCoOrganizers and while coOrganizersOn is off, but editing still works"`.
  - `"a rota participant with no account is pending, and signing in with that number links the role"`: call `linkCoOrganizerRoles`, then `roleIn` returns a co-organizer and a `members` row exists.
  - `"removing or blocking a member ends their co-organizer role"`, and the same for `removeParticipant` in a rota.
  - `"a co-organizer with People cannot remove the owner or another co-organizer"`: `removeMember` and `removeParticipant` return `{ ok:false, reason:"is_organizer" }` (add the reason to both result types). The owner can remove a co-organizer, which also ends the role.
- [ ] **Step 2:** Run `bunx vitest run convex/coOrganizers.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. `otherMember` gains the `"is_organizer"` result when the target's phone has a `coOrganizers` row and the caller isn't the owner, so it needs the caller's role as a new last parameter.
- [ ] **Step 4:** Run `bunx vitest run convex/coOrganizers.test.ts convex/organizer.test.ts convex/rota.people.test.ts convex/verification.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(organizer): let the owner name co-organizers and set their permissions`.

### Task 4: Every organizer control checks its permission

**Files:**
- Modify: `convex/organizer.ts`, `convex/rota.ts`, `convex/khatmaLifecycle.ts`, `convex/khatmas.ts` (`view`), `convex/lib/rotaOps/people.ts` (saved-list owner and number visibility)
- Test: `convex/coOrganizers.permissions.test.ts`

**Interfaces:**
- Consumes: `requireOrganizer(..., need)` and `organizerOf(..., need)` (Task 2).
- Produces:
  - The permission map below, exactly as in §4.3 and §4.4.
  - `KhatmaView.organizerAccess: { owner: boolean; readings: boolean; people: boolean; settings: boolean } | null` (pool view) and the same field on the rota branch of `view`. `isOrganizer` stays and still means owner.
  - `organizer.settings` and `rota.settings` return `access` (the same shape) so the pages can hide controls.
  - In `convex/lib/rotaOps/people.ts`, `savedOwner(khatma: Doc<"khatmas">, actor: Actor): Id<"people">` returns `actor.personId ?? khatma.creatorPersonId`. It replaces `khatma.creatorPersonId` at the saved-list sites (:202, :351/:369, :709, :744, :952, :969), so a co-organizer saves to and picks from their own list (§4.3). Number visibility (:810 `numberHiddenFrom`) treats an owner and a co-organizer with People alike.

| Need | Functions |
| --- | --- |
| `"owner"` | `organizer.handOver`, `khatmaLifecycle.archive`, `khatmaLifecycle.remove`, `rota.insertAgain` / `startAgain`, `rota.finishSetup`, `coOrganizers.*` |
| `"people"` | `organizer.removeMember`, `organizer.unblock`, `organizer.activeMemberCount`, `organizer.applyInviteReset` (so `resetInvite`), `rota.addParticipant`, `giveJuz`, `spreadFreeJuz`, `moveJuz`, `freeJuz`, `renameParticipant`, `removeParticipant`, `importMembers`, `importable`, `ensureJoinLink`, `acceptJoinRequest`, `declineJoinRequest`, `people`, `saved`, `addSaved` |
| `"readings"` | `rota.today`, `reassign`, `markDone`, `markNotDone`, and the Part 2 mark functions |
| `"settings"` | `organizer.update`, `rota.update`, `setPaused`, `addPauseDate`, `removePauseDate`, `rota.settings` |
| any role | `organizer.settings` (the page shell, which returns `access`) |

`importable` and `importMembers` still require the caller to *own* the source pool khatma (`organizerOf(ctx, source, person, "owner")`).

- [ ] **Step 1: Write the failing tests** in `convex/coOrganizers.permissions.test.ts`. Use a table-driven test that names a co-organizer with exactly one switch on, calls one function per row of the map, and expects success only where the switch matches:
  - `"each control accepts its permission and refuses the others"`, for pool and for rota.
  - `"owner-only controls refuse a co-organizer with every switch on"`.
  - `"turning a switch off refuses the next call"` (Review Focus 2).
  - `"a co-organizer removed from the khatma is refused on the next call"` (Review Focus 1).
  - `"view reports organizerAccess for owner, co-organizer, and member"`: a plain member gets `null`.
  - `"a co-organizer saves people to their own saved list"`.
- [ ] **Step 2:** Run `bunx vitest run convex/coOrganizers.permissions.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Pass the need at each call site from the map. In `convex/rota.ts`, give `requireRotaOrganizer` and `organizerRota` a `need` parameter. Pass `{ personId: person._id }` as the `Actor` everywhere a rota op takes one, so `savedOwner` sees the real caller.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(organizer): check each co-organizer permission on the server`.

### Task 5: Organizer notes reach co-organizers

**Files:**
- Modify: `convex/schema.ts` (`notes.kind`, add `coOrganizerNow`; `notes` add `whatsappOff: v.optional(v.boolean())`), `convex/lib/noteText.ts` (`NOTE_KINDS`, `noteText`), `convex/lib/whatsappTemplates.ts` (`NOTE_TEMPLATES.coOrganizerNow = null`, `noteParams`), `convex/notes.ts` (`NotifyArgs.whatsappOff?`), `convex/whatsappNotes.ts` (`plan` returns `null` when `note.whatsappOff`), `convex/rotaDays.ts` (:220, :254, :266, :358, :368), `convex/rotaInbound.ts` (:393, :437), `convex/grace.ts` (`alertOrganizer` :23)
- Create: `convex/lib/organizerRecipients.ts`
- Test: `convex/coOrganizers.notes.test.ts`, plus `lib/noteText.test.ts` and `lib/whatsappTemplates.test.ts` updated for the new kind

**Interfaces:**
- Produces:
  - `organizerRecipients(ctx: QueryCtx, khatma: Doc<"khatmas">, permission: Permission): Promise<{ personId: Id<"people">; whatsappOff: boolean }[]>` returns the owner (`whatsappOff: false`) plus each co-organizer with an account, still in the khatma, and holding `permission`, when `coOrganizerNotesOn` is on. A co-organizer's `whatsappOff` is `!coOrganizerWhatsAppOn`.
  - The routing: `rotaUnread` and `rotaSummary` go to `readings`. `rotaJoinRequest`, `rotaSilent`, `rotaSilenced` and `rotaStopped` go to `people`. The pool open-for-help alert (`alertOrganizer`) goes to `readings` (§4.6).
  - Note kind `coOrganizerNow`, with in-app text «أصبحت منظّماً مساعداً في هذه الختمة». It goes in the app and by push only (`NOTE_TEMPLATES` null). Task 3's `set` sends it when naming someone with an account, and `linkCoOrganizerRoles` sends it on sign-in. Removal sends nothing.
- [ ] **Step 1: Write the failing tests:**
  - `"the unread list reaches the owner and co-organizers with Readings, not those without"`.
  - `"a co-organizer's note never goes on WhatsApp unless coOrganizerWhatsAppOn"`: check `whatsappNotes.plan` returns null.
  - `"coOrganizerNotesOn off sends organizer notes to the owner only"`.
  - `"naming someone sends coOrganizerNow in the app"`.
  - `"alertOrganizer batches per recipient"`: two recipients each get one batched alert.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Replace each `khatma.creatorPersonId` recipient listed under Files with a loop over `organizerRecipients`. `clearOlderOrganizerNotes` (rotaDays.ts:220) clears per recipient.
- [ ] **Step 4:** Run `bunx vitest run convex/coOrganizers.notes.test.ts convex/rotaDays.test.ts convex/rotaInbound.test.ts convex/grace.test.ts convex/lib convex/whatsappNotes.test.ts convex/notes.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(notes): send organizer notes to co-organizers in the app and by push`.

### Task 6: Transferring ownership

**Files:**
- Modify: `convex/organizer.ts` (`handOverTo` :297, `handOver` :450, `autoHandoverSweep` :470-478, `autoHandover` :499-503), `convex/adminOps.ts` (`handOver` :290)
- Test: `convex/organizer.test.ts` (extend), `convex/adminOps.test.ts` (extend)

**Interfaces:**
- Produces:
  - `handOverTo(ctx, khatma, member: Doc<"members">, previous: Doc<"people"> | null): Promise<void>` keeps its signature and adds two things. It deletes the new owner's `coOrganizers` row. When `oldOwnerStaysOn` is on and the old owner still has an active membership, it adds a row for the old owner's phone with all three switches on. This works even at `maxCoOrganizers` (§4.5).
  - `organizer.handOver` accepts rota khatmas too: it uses `requireLiveOrganizer(ctx, code, "owner")` instead of `requirePoolOrganizer`. For rota the target is the `members` row of a co-organizer or participant with an account. It returns `{ ok:false, reason:"no_account" }` for a pending participant, and the khatma doesn't change (Review Focus 5).
  - The auto handover: with `handoverToCoOrganizerOn` on, `autoHandoverSweep` no longer skips rota (it still skips archived). `autoHandover` first tries co-organizers in `addedAt` order who have an account seen within `successorActiveMs`. A pool khatma then falls back to today's rule. A rota khatma has no fallback, so nothing changes. With the setting off, the behavior is exactly today's.
  - The admin `handOver` gets the same co-organizer bookkeeping through `handOverTo`, and its audit stays `khatma.handOver`.
- [ ] **Step 1: Write the failing tests:**
  - `"transfer makes the old owner a co-organizer with every switch, and ends the new owner's co-organizer role"`.
  - `"oldOwnerStaysOn off leaves the old owner a plain member"`.
  - `"a rota khatma can be transferred to a participant with an account, not to a pending one"`.
  - `"auto handover picks the longest-serving active co-organizer before the longest-standing member"`.
  - `"auto handover hands a rota khatma only to a co-organizer, and does nothing without one"`.
  - `"handoverToCoOrganizerOn off keeps today's rule and still skips rota"`.
- [ ] **Step 2:** Run `bunx vitest run convex/organizer.test.ts convex/adminOps.test.ts`. Expected: FAIL on the new tests.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(organizer): transfer ownership, keeping the old owner as a co-organizer`.

### Task 7: Admins see and manage co-organizers

**Files:**
- Modify: `convex/lib/audit.ts` (`auditActionValidator`: add `khatma.coOrganizerSet`, `khatma.coOrganizerRemove`), `convex/adminKhatmas.ts`, `convex/adminLookup.ts` (`khatma` :127), `apps/admin/src/pages/KhatmaAdminPage.tsx`, `apps/admin/src/i18n/ar.ts`
- Test: `convex/adminKhatmas.test.ts`, `apps/admin/src/pages/KhatmaAdminPage.test.tsx`

**Interfaces:**
- Consumes: the `set` and `remove` logic from Task 3. Extract it as `setCoOrganizer(ctx, khatma, input)` and `removeCoOrganizer(ctx, khatma, coOrganizerId)` in `convex/coOrganizers.ts` so the session and admin functions share it.
- Produces:
  - `adminKhatmas.setCoOrganizer` (`adminMutation`, `{ khatmaId; candidateId?; coOrganizerId?; readings; people; settings; note? }`) and `adminKhatmas.removeCoOrganizer` (`{ khatmaId; coOrganizerId; note? }`). Each writes `writeAudit` with the before and after switches. Admins ignore `coOrganizersOn` and `maxCoOrganizers` (Ali's admin-full-access rule).
  - `adminLookup.khatma` adds `coOrganizers: { coOrganizerId; name; readings; people; settings; pending }[]` and `coOrganizerCandidates`.
  - KhatmaAdminPage gets a «المنظّمون المساعدون» card: the list, an add sheet with the three switches, and edit and remove.
- [ ] **Step 1: Write the failing tests:** `"an admin names a co-organizer past the cap and the change is audited"` and `"an admin removes one, audited"`. In the UI test: `"the khatma page lists co-organizers with their permissions in words"`.
- [ ] **Step 2:** Run `bunx vitest run convex/adminKhatmas.test.ts apps/admin/src/pages/KhatmaAdminPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the same command and `bunx vitest run convex/audit.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(admin): see and manage a khatma's co-organizers`.

### Task 8: Website: the owner's co-organizer section and permission-aware pages

**Files:**
- Create: `apps/web/src/features/khatma/CoOrganizersSection.tsx`, `apps/web/src/features/khatma/CoOrganizersSection.test.tsx`
- Modify: `apps/web/src/pages/OrganizerPage.tsx`, `apps/web/src/pages/KhatmaPage.tsx:506`, `apps/web/src/pages/RotaKhatmaPage.tsx:140-189`, `apps/web/src/pages/RotaSettingsPage.tsx`, `apps/web/src/features/rota/PeoplePanel.tsx:202`, `apps/web/src/features/rota/backend.tsx`, `apps/web/src/i18n/ar.ts`, `apps/web/src/test/fixtures.ts`, the privacy page (Arabic and English)
- Test: `OrganizerPage.test.tsx`, `RotaKhatmaPage.test.tsx`, `PeoplePanel.test.tsx`

**Interfaces:**
- Consumes: `coOrganizers.list/set/remove` (Task 3), `organizerAccess` and `access` (Task 4).
- Produces:
  - `CoOrganizersSection({ inviteCode }: { inviteCode: string })`, shown only to the owner, in pool settings and rota settings (§4.4a). It lists each co-organizer with their permissions in words («القراءة والمشاركون», «بلا صلاحيات» when none are on) and «لم يسجّل الدخول بعد» when pending. «أضف منظّماً مساعداً» opens a sheet: pick a candidate, then three switches preset to `defaults`, then «حفظ». Tapping a row opens the switches plus «أزل من المنظّمين المساعدين». It's hidden for adding when `enabled` is false.
  - Permission-aware pages:
    - The settings link (KhatmaPage) shows for any `organizerAccess`.
    - OrganizerPage shows the members controls only with `people`, the name, schedule, grace and cheer form only with `settings`, and archive, delete, transfer and the co-organizer section only with `owner`.
    - RotaKhatmaPage picks the organizer view from `access` instead of `today === null`. It shows the Today tab with `readings`, People with `people`, and settings with `settings`. A co-organizer with no switch on sees the member page.
    - PeoplePanel hides remove on the owner and co-organizers unless the viewer is the owner.
    - Members lists show «منظّم مساعد» next to co-organizers on these organizer pages only.
  - Rename the hand-over control to «انقل ملكية الختمة» and offer it on rota settings too.
  - Privacy page: add one sentence saying organizers can share a rota khatma's participant list (names and numbers) with co-organizers they choose. Ali approves the wording before merge. Open a Linear `[You]` task for that approval.
- [ ] **Step 1: Write the failing tests:**
  - `"the owner adds a co-organizer with preset switches and saves"`.
  - `"a co-organizer with only Readings sees Today and not People or settings"`.
  - `"a co-organizer never sees archive, delete, or transfer"`.
  - `"a co-organizer with People sees no remove on the owner or another co-organizer"`.
- [ ] **Step 2:** Run `bunx vitest run apps/web/src`. Expected: FAIL on the new tests.
- [ ] **Step 3:** Implement. In `features/rota/backend.tsx`, add the three `coOrganizers` functions to `OrganizerOnly`, since admins use the admin card from Task 7 instead.
- [ ] **Step 4:** Run `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5:** Run the web app (`preview_start`) against the dev deployment. As the owner, name a co-organizer. As that person, check the tabs match the switches. Take a screenshot for the PR.
- [ ] **Step 6:** Commit: `feat(web): let owners manage co-organizers and show each one only their controls`. Open the PR for Part 1, run `/code-review`, and fix confirmed findings.

---

# Part 2: Marking done for anyone (branch `feat/mark-done-for-anyone`, after Part 1 merges)

### Task 9: Pool: organizers mark a juz' done and undo it

**Files:**
- Modify: `convex/schema.ts` (`assignments`: add `markedByPersonId: v.optional(v.id("people"))` and `uncredited: v.optional(v.boolean())`), `convex/pool.ts` (extract the after-finish block of `finish` :396), `convex/people.ts` (`myStats` :145), `convex/lib/pace.ts` (`personPace` :64), `convex/pool.ts` (`juzFinishedInRecentRounds`)
- Create: `convex/poolMarks.ts`, `convex/poolMarks.test.ts`

**Interfaces:**
- Consumes: `requireOrganizer(ctx, inviteCode, "readings")` (Part 1).
- Produces:
  - `afterFinish(ctx: MutationCtx, round: Doc<"rounds">, assignments: Doc<"assignments">[], finished: Doc<"assignments">, now: number): Promise<void>` holds what `finish` does after patching `finishedAt`: clear notes, `lastFinishedAt`, cheer, and schedule completion. `finish` calls it too.
  - `poolMarks.markDone` (sessionMutation, `{ inviteCode; juz: number; forMemberId: Id<"members"> | null }`) returns `{ ok: true } | { error: "disabled" | "done" | "not_member" | "invalid_juz" }`.
    - A juz' being read finishes that hold with `markedByPersonId` set, and `forMemberId` is ignored.
    - An open juz' gets an inserted assignment with `finishedAt = takenAt = now`, zeroed grace fields, `releasedBySystem: false`, and `markedByPersonId`. With `forMemberId` the assignment carries that member and person. With `null`, it carries the marking organizer's member and person and `uncredited: true`.
    - It refuses `disabled` when `markDoneForOthersOn` is off. `markDoneNameOn` off forces `forMemberId` to `null`.
    - It re-reads the juz' state inside the mutation, so a hold taken a moment earlier is finished instead (Review Focus 3).
  - `poolMarks.undo` (sessionMutation, `{ inviteCode; juz }`) returns `{ ok: true } | { error: "not_done" | "round_completed" }`, allowed while the round is current and `completedAt === null` (§3.1).
    - A row with `uncredited`, or one inserted by `markDone`, gets `releasedAt = now` and `releasedBySystem: true`, so the juz' is open.
    - A hold its reader took gets `finishedAt: null` with a fresh grace (`graceTimes` and `scheduleGrace`, as `take` does), unless the reader now holds another juz', in which case it's released.
  - Credit: `myStats` skips `uncredited`. `personPace` skips any row with `markedByPersonId`. `juzFinishedInRecentRounds` skips `uncredited`.
  - No message goes to the member (§3.1).
- [ ] **Step 1: Write the failing tests** in `convex/poolMarks.test.ts`:
  - `"marking a juz' being read finishes the hold and completes the round at 30"`.
  - `"marking an open juz' for a member counts in their stats but not their pace"`.
  - `"marking an open juz' for nobody counts for the round and no person"`.
  - `"a hold taken a moment before the mark is finished, not duplicated"`.
  - `"undo gives a hold back to its reader with fresh grace, or opens it when they hold another"`.
  - `"undo refuses after the round completed"`.
  - `"a member or a co-organizer without Readings is forbidden"`.
  - `"markDoneForOthersOn off refuses, and markDoneNameOn off records nobody"`.
- [ ] **Step 2:** Run `bunx vitest run convex/poolMarks.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bunx vitest run convex/poolMarks.test.ts convex/pool.finish.test.ts convex/stats.test.ts convex/lib/pace.test.ts convex/pool.take.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(pool): let organizers mark a juz' done for anyone, and undo it`.

### Task 10: Pool: the organizer's tile sheet

**Files:**
- Modify: `convex/khatmas.ts` (`buildTiles` :107, `TileView` :39, `view`), `apps/web/src/components/Tile.tsx:62`, `apps/web/src/components/PoolGrid.tsx`, `apps/web/src/pages/KhatmaPage.tsx:178`, `apps/web/src/i18n/ar.ts`
- Create: `apps/web/src/components/MarkSheet.tsx`, `apps/web/src/components/MarkSheet.test.tsx`

**Interfaces:**
- Consumes: `poolMarks.markDone` and `poolMarks.undo` (Task 9), and `organizerAccess.readings` (Part 1).
- Produces:
  - `TileView.recordedFor?: string | null` and `TileView.byOrganizer?: boolean`, filled only when the viewer has Readings.
  - `KhatmaView.markCandidates?: { memberId: Id<"members">; name: string }[]`, filled only for Readings and only when `markDoneNameOn` is on.
  - `Tile` takes `onOrganize?: (juz: number) => void`. When it's set, every tile is tappable.
  - `MarkSheet({ tile, candidates, onMark, onUndo, onClose })`:
    - Reading: shows the reader's name and «سجّلته مقروءاً».
    - Open: «سجّلته مقروءاً» with a «قرأه:» picker defaulting to «لا أعرف».
    - Done: shows who it was recorded for and «ألغِ التسجيل».
  - Members' tiles are unchanged.
- [ ] **Step 1: Write the failing tests:** `"an organizer marks an open juz' for a picked member"`, `"the picker is hidden when there are no candidates"`, `"a done tile offers undo and names who it was recorded for"`, and `"a member's tiles stay as they were"`.
- [ ] **Step 2:** Run `bunx vitest run apps/web/src/components convex/khatmas.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(web): mark a pool juz' done for someone from the grid`.

### Task 11: Rota: who read it, the late window, and the picker

**Files:**
- Modify: `convex/schema.ts` (`rotaReads`: add `doneById: v.optional(v.union(v.id("rotaParticipants"), v.null()))`), `convex/lib/rotaOps/today.ts` (`markDone` :203, `markNotDone` :239, the closed checks :214 and :247), `convex/rota.ts` (`markDone` args), `convex/adminRota.ts` (`markDone` args), `convex/rotaInbound.ts` (`answerDay` :210 sets `doneById` to the tapping participant), `apps/web/src/features/rota/TodayPanel.tsx` (`TileSheet` :72)
- Test: `convex/rota.today.test.ts`, `convex/adminRota.test.ts`, `apps/web/src/features/rota/TodayPanel.test.tsx`

**Interfaces:**
- Produces:
  - `ops.markDone(ctx, khatma, rota, args: { readId: Id<"rotaReads">; readerId?: Id<"rotaParticipants"> | null }, actor: Actor)` keeps its return type. With a named `readerId`:
    - It records `doneById`.
    - It credits that participant (`scheduleRotaCheer(..., readerId)`).
    - When `namedCountsAsReplyOn` is on, it resets their `lastReplyAt`, `silentDays` and `silencedAt`.
    - When the named person differs from the read's `readerId`, it enqueues `covered` to the old reader and sets `readerId` to the named person. Naming the day's reader sends nothing.
    - With `null` or no `readerId`, it does what it does today.
    - `markDoneNameOn` off ignores `readerId`.
  - `organizerOpen(day: Doc<"rotaDays">, now: number, lateMarkOn: boolean): boolean` returns `day.closedAt === null || (lateMarkOn && now < (day.lateUntil ?? 0))`. It replaces the closed checks in `markDone` and `markNotDone` (`organizerLateMarkOn`). Not for `reassign`.
  - `today`'s view adds `doneByName: string | null` per read (Readings only), and `participants` for the picker.
  - TileSheet's mark action gets the «قرأه:» picker, defaulting to «لا أعرف».
- [ ] **Step 1: Write the failing tests:**
  - `"naming the day's reader records them, credits them, and counts as their reply"`.
  - `"naming someone else covers the day's reader"`: a `covered` outbox row to the old reader.
  - `"namedCountsAsReplyOn off leaves the silence count alone"`.
  - `"an organizer can mark done and undo during the late window, not after"`.
  - `"a member's own tap records them as doneById"`.
  - `"the admin's mark takes a reader too, audited"`.
- [ ] **Step 2:** Run `bunx vitest run convex/rota.today.test.ts convex/adminRota.test.ts convex/rotaInbound.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(rota): record who read a juz', and let organizers mark during the late window`. Open the PR for Part 2, run `/code-review`, and fix confirmed findings.

---

# Part 3: Two readers on one juz' (branch `feat/rota-shared-juz`, after Part 1 merges; independent of Part 2)

### Task 12: Shared slots and the day's reads

**Files:**
- Modify: `convex/schema.ts` (`rotaSlots`: add `half: v.optional(v.union(v.literal(1), v.literal(2)))`; `rotaReads`: add `partnerId: v.optional(v.union(v.id("rotaParticipants"), v.null()))` and index `by_partner_day ["partnerId","dayId"]`), `convex/lib/rotaPlace.ts` (`slotRowsByJuz` :142), `convex/rotaDays.ts` (`startDay` :131-145), `convex/lib/rotaOps/people.ts` (`moveJuz` :477, `freeJuz` :509, `removeParticipant` :528, the slot cap :403 and :431, the people view), `convex/rota.ts`, `convex/adminRota.ts`
- Test: `convex/rota.people.test.ts`, `convex/rotaDays.test.ts`

**Interfaces:**
- Produces:
  - `slotRowsByJuz(ctx, khatmaId, number): Promise<Map<number, Doc<"rotaSlots">[]>>` returns one or two rows per juz', half 1 first. Update every caller.
  - `startDay` sets `holderId = readerId =` the whole or half-1 holder, and `partnerId =` the half-2 holder or `null`.
  - `ops.shareJuz(ctx, khatma, rota, { participantId; juz })` returns `{ ok: true } | { error: "disabled" | "no_reader" | "already_shared" | "same_person" | "too_many" | "not_found" }`. It patches the existing row to `half: 1` and inserts the new participant's row with `half: 2`. It refuses `disabled` when `rotaSharedSlotsOn` is off. `too_many` uses `rotaMaxSlotsPerPerson`, counting a half as 1 when `rotaHalfCountsAsSlot` is on and 0 when off. Wire it as `rota.shareJuz` (Need `"people"`) and `adminRota.shareJuz` (audited).
  - Leaving a shared slot: `moveJuz`, `freeJuz` and `removeParticipant` on a half-holder delete that row and clear `half` on the other row, which makes that reader whole again. This applies from the khatma the page shows, and today's read keeps both (Review Focus 4).
  - The people view's per-juz' rows become `readers: { participantId; name; half: 1 | 2 | null; joined: boolean }[]`.
- [ ] **Step 1: Write the failing tests:**
  - `"sharing a juz' makes two halves that rotate together"`: on khatma 2 both have juz' `s+1`.
  - `"a day's read carries both readers"`.
  - `"removing one half makes the other whole from the next khatma, and today keeps both"`.
  - `"the same person cannot hold both halves"`.
  - `"rotaSharedSlotsOn off refuses sharing, and shared slots carry on"`.
  - `"a half counts toward the slot cap unless rotaHalfCountsAsSlot is off"`.
  - `"a khatma holds 60 readers"`: share all 30.
- [ ] **Step 2:** Run `bunx vitest run convex/rota.people.test.ts convex/rotaDays.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(rota): let two readers share a juz', one half each`.

### Task 13: WhatsApp for shared ajza': done once

**Files:**
- Modify: `convex/rotaInbound.ts` (`readsOf` :149, `answerDay` :210), `convex/rotaDays.ts` (`sendReminders` :277, juz' enqueue :189, `sendCycleMessages` :378), `convex/rotaOutbox.ts` (`enqueue` :113, `compose` :378, welcome :352), `convex/schema.ts` (`rotaOutbox`: add `halves: v.optional(v.array(v.object({ juz: v.number(), half: v.union(v.literal(1), v.literal(2)) })))`), `convex/lib/noteText.ts` (`juzPhrase` :66, `juzPhraseGenitive` :77), `convex/lib/rotaTemplates.ts`
- Test: `convex/rotaInbound.test.ts`, `convex/rotaDays.test.ts`, `convex/rotaOutbox.test.ts`, `convex/lib/noteText.test.ts`, `convex/lib/rotaTemplates.test.ts`

**Interfaces:**
- Produces:
  - `juzPhrase(juz: readonly number[], halves?: ReadonlyMap<number, 1 | 2>): string` and the genitive form the same way. A half reads «النصف الأول من الجزء ٢٦» or «النصف الثاني من الجزء ٢٦». Without `halves`, the output is unchanged.
  - `enqueue` takes `halves?` and stores it. `compose` passes it to the phrase functions for the kinds `juz`, `reminder`, `assigned`, and welcome.
  - `readsOf` treats a read where `partnerId === participant._id` as theirs too, with the same `reading` and `handedOn` logic.
  - `answerDay` on a read that's already done, for a partner who didn't tap, replies with the same thanks text as a fresh «أتممت» (not `alreadyText`) and changes nothing (§5.2).
  - `sendReminders` reminds both readers of an undone shared read. Neither gets a reminder once it's done.
  - `sendCycleMessages` skips anyone who held a half on any day of the cycle (a read with them as `partnerId`, or as holder while `partnerId` is set).
  - Silence counting is unchanged: replies only (§5.2).
- [ ] **Step 1: Write the failing tests:**
  - `"each reader's juz' message names their half"`.
  - `"either reader's «أتممت» marks the juz' done once, and the other gets no reminder"`.
  - `"the partner's later «أتممت» gets the thanks reply and changes nothing"`.
  - `"typed «تم» from the partner works"`.
  - `"a partner who never replies is still silenced after rotaSilenceStopDays"`.
  - `"a half-holder gets no cycle note"`.
  - `"juzPhrase without halves is unchanged"`.
- [ ] **Step 2:** Run the files under Test. Expected: FAIL.
- [ ] **Step 3:** Implement. One person never holds both halves of one slot, but can hold halves of different slots, which list one after another. Add `"the longest juz' phrase fits a template parameter"` to `convex/lib/rotaTemplates.test.ts`: three halves of different ajza' (the most `rotaMaxSlotsPerPerson` allows by default) stay under Meta's 1024-character parameter limit.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(rota): tell each reader their half, and count a shared juz' done once`.

### Task 14: Today, join requests, starting again, and filling slots

**Files:**
- Modify: `convex/lib/rotaOps/today.ts` (`today` view, `reassign` :154), `convex/rotaDays.ts` (unread list :254), `convex/lib/rotaOps/people.ts` (`acceptJoinRequest` :877, `placeNewParticipant` :254, `spreadFreeJuz` :420), `convex/rota.ts` (`insertAgain` :320, `importMembers` :743)
- Test: `convex/rota.today.test.ts`, `convex/rotaOps.test.ts`, `convex/rota.create.test.ts`, `convex/rota.people.test.ts`

**Interfaces:**
- Produces:
  - The today view's read gets `partnerName: string | null` and `partnerAnswer`.
  - `reassign` on a shared read sets `readerId` to the new person and `partnerId: null`, and enqueues `covered` to both previous readers (§5.4).
  - The unread list names both readers of an unread shared juz'.
  - `acceptJoinRequest` args gain `share?: boolean`, which places the person as half 2 on `juz` through `shareJuz`.
  - `placeNewParticipant` (used by import and the saved list) fills an empty slot first. When all 30 have a reader and `rotaSharedSlotsOn` is on, it shares the lowest-numbered whole slot.
  - `insertAgain` copies `half` on each slot row.
- [ ] **Step 1: Write the failing tests:**
  - `"today shows both readers and their answers"`.
  - `"reassigning a shared juz' covers both readers"`.
  - `"the unread list names both"`.
  - `"a join request can be accepted onto a half"`.
  - `"importing fills empty slots, then shares in order"`.
  - `"starting again keeps shared slots"`.
- [ ] **Step 2:** Run the files under Test. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(rota): show and handle shared ajza' on Today, join requests and imports`.

### Task 15: Participants page for shared ajza'

**Files:**
- Modify: `apps/web/src/features/rota/PeoplePanel.tsx`, `apps/web/src/features/rota/TodayPanel.tsx`, `apps/web/src/features/rota/JoinRequests.tsx`, `apps/web/src/features/rota/backend.tsx` (add `shareJuz`), `apps/web/src/i18n/ar.ts`
- Test: `PeoplePanel.test.tsx`, `TodayPanel.test.tsx`

**Interfaces:**
- Consumes: `rota.shareJuz` and `adminRota.shareJuz` (Task 12), and the view fields from Tasks 12 and 14.
- Produces:
  - A whole row's sheet gets «أضف قارئاً يشاركه الجزء». It picks a new or saved person like the add sheet does, and spells out «يقرأ فلان النصف الأول وفلانة النصف الثاني من الجزء ٧ في الختمة ١٢، ثم الجزء ٨ في الختمة ١٣».
  - A shared row shows both names with their halves.
  - Removing or moving one reader asks first, with «سيقرأ فلان الجزء كاملاً».
  - Today's sheet shows both readers and answers.
  - Join requests offer free halves.
  - The share action is hidden when the view says shared slots are off. Add `sharedSlotsOn: boolean` to the people view.
- [ ] **Step 1: Write the failing tests:** `"adding a second reader spells out both halves"`, `"a shared row shows both names"`, `"removing one half warns the other reads it all"`, and `"no share action when shared slots are off"`.
- [ ] **Step 2:** Run `bunx vitest run apps/web/src/features/rota`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run typecheck && bun run lint && bun run test`. Expected: PASS.
- [ ] **Step 5:** Run the web app, share a juz' in a dev rota khatma, and screenshot the participants page and Today for the PR.
- [ ] **Step 6:** Commit: `feat(web): add a second reader to a rota juz'`. Open the PR for Part 3, run `/code-review`, and fix confirmed findings.

---

## After all three parts

- [ ] Deploy to staging and run spec §8's five checks with Ali's number only.
- [ ] Linear: one issue per part in the Wirdak project, linked from each PR. Add a `[You]` task for the privacy wording (Task 8), blocking Part 1's merge.

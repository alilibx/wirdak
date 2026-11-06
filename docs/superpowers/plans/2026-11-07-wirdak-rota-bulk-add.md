# Rota bulk add and organizer people counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tick several saved participants and add them to a rota khatma in one call, and show a people count on the home cards of khatmas the viewer organizes.

**Architecture:** A new op module `convex/lib/rotaOps/bulk.ts` holds `addSavedMany` and the `active` lookup; `rota.ts` and `adminRota.ts` wrap it. `SavedPicker` grows a checklist mode used wherever it opens without a `juz`. `khatmas.mine` gains `peopleCount` from the existing `memberCount`.

**Tech Stack:** Convex, convex-test, React 19, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-wirdak-rota-bulk-add-design.md`

## Global Constraints

- No AI attribution in commits, PR text, or code (`CLAUDE.md`).
- All copy Arabic, in `apps/web/src/i18n/ar.ts` under `t.rota` / `t.home`; counts through `counted` (`convex/lib/arabicCount.ts`) or the existing `toArabicDigits`.
- Co-organizers (#65): adding saved people needs the `"people"` need; the saved list is the caller's own (`savedOwner(khatma, actor)`).
- A contact with `phone === null` never returns a number to any client.
- Touch targets `min-h-14`, as the rest of the rota screens.
- Branch `feat/ada-250-rota-bulk-add`; commits reference `ADA-250`.

## Review Focus

1. A batch where some ticked people are already in the khatma (added meanwhile in another tab): they count as `alreadyIn`, the rest still go in. Pinned in Task 1.
2. More ticks than free ajza' reach the server (stale client): the extra count as `noRoom`, nothing is dropped silently. Pinned in Task 1.
3. Late in the day, the question comes back before any row is written, and the answer applies to the batch. Pinned in Task 1.
4. The same contact id twice in one call adds them once. Pinned in Task 1.
5. A co-organizer without People can't bulk add. Pinned in Task 1.

---

### Task 1: `addSavedMany` on the server

**Files:**
- Create: `convex/lib/rotaOps/bulk.ts`; export it from `convex/lib/rotaOps.ts`
- Modify: `convex/lib/rotaOps/people.ts` (export a `lateFor(ctx, khatma, slot): Promise<boolean>` built from `lateInTheDay` with `joined = false`, plus `freeJuzOrder(ctx, khatma): Promise<number[]>` the lowest-first free juz' of the target day)
- Modify: `convex/rota.ts` (`addSavedMany` beside `addSaved`, need `"people"`), `convex/adminRota.ts` (`addSavedMany` beside `addSaved`, `audited(ctx, args, "addSavedMany", result)`)
- Test: `convex/rota.saved.test.ts`, `convex/rotaInbound.test.ts` (late case), `convex/adminRota.test.ts` (audit)

**Interfaces:**
- Produces: `addSavedMany(ctx, khatma, rota, args: { contactIds: Id<"rotaContacts">[]; readsToday?: boolean }, actor: Actor): Promise<{ ok: true; added: number; alreadyIn: number; noRoom: number; notFound: number } | { error: "ask_today" }>`
- Produces: public `api.rota.addSavedMany` `{ inviteCode, contactIds, readsToday? }` and `api.adminRota.addSavedMany` `{ khatmaId, contactIds, readsToday? }`, same result.

Rules: over 30 ids → `ConvexError({ code: "too_many" })`; duplicates dropped keeping first; each id checked as `addSaved` checks it; resolve all first, take the free juz' list, assign in order; if `readsToday` is undefined and any assigned slot `lateFor` → return `ask_today` before any insert; then call `placeNewParticipant(ctx, khatma, who, juz, undefined, { readsToday })` per person.

- [ ] **Step 1: Write the failing tests** in `rota.saved.test.ts`:
  - `addSavedMany adds the ticked contacts on the lowest free ajza' in order` → `{ ok: true, added: 3, alreadyIn: 0, noRoom: 0, notFound: 0 }`, participants hold juz' 1, 2, 3 in the given order.
  - `addSavedMany counts people already in, removed or foreign contacts, and the ones that don't fit`: khatma with 28 ajza' taken, ids = [in-khatma, removed, other owner's, a, b, c] → `alreadyIn: 1, notFound: 2, added: 2, noRoom: 1`.
  - `addSavedMany adds a repeated id once`.
  - `addSavedMany keeps an imported contact's number hidden` → row `phoneHidden: true`.
  - `addSavedMany refuses more than 30 ids` → rejects with `too_many`.
  - `a co-organizer without People can't addSavedMany` → `forbidden` (follow `coOrganizers.permissions.test.ts` helpers if simpler there).
  - In `rotaInbound.test.ts`: `addSavedMany asks once late in the day, before anyone is added` → at 18:00 `{ error: "ask_today" }` and participants unchanged; with `readsToday: false` → ok and the free-today juz' stays free.
  - In `adminRota.test.ts`: `admin addSavedMany writes one audit row`.
- [ ] **Step 2: Run** `bunx vitest run convex/rota.saved.test.ts convex/rotaInbound.test.ts convex/adminRota.test.ts` → the new tests fail (`addSavedMany` undefined).
- [ ] **Step 3: Implement** the op, the helpers, both wrappers.
- [ ] **Step 4: Run** the same command → PASS; `bunx tsc --noEmit -p convex` clean.
- [ ] **Step 5: Commit** `feat(rota): add several saved participants in one call` with `Refs ADA-250`.

### Task 2: `active` on saved contacts

**Files:**
- Modify: `convex/lib/rotaOps/people.ts` (`SavedContact.active: boolean`; `saved` sorts active first, then name)
- Test: `convex/rota.saved.test.ts`

Active: the contact's phone (or, for `phone === null`, the linked person's phone) has a `rotaParticipants` row (`by_phone`) in another khatma whose `creatorPersonId` is the list owner, that is `kind === "rota"`, not archived, `rota.setupDoneAt !== null`, and the row `reachable()` (`rotaOutbox.ts`) and holds a `rotaSlots` row (`by_participant`). Only the boolean leaves the server.

- [ ] **Step 1: Write the failing test** `saved marks people who read in the organizer's other live khatmas and lists them first`: contacts A (joined + holds a juz' in another set-up khatma), B (joined but holds nothing), C (stopped), D (only in an archived khatma), E (not in any) → order `[A, then B..E by name]`, `active` true only for A.
- [ ] **Step 2: Run** `bunx vitest run convex/rota.saved.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; existing `saved lists contacts by name` still passes (no actives there).
- [ ] **Step 5: Commit** `feat(rota): mark saved participants who read with the organizer now`.

### Task 3: Checklist picker and People banner

**Files:**
- Modify: `apps/web/src/features/rota/SavedPicker.tsx` (checklist when `juz === undefined`), `backend.tsx` (`addSavedMany` in `organizerFunctions`), the admin backend that builds a `RotaBackend` (find with `grep -rn "addSaved:" apps/admin/src`), `PeoplePanel.tsx` (leftover banner button + result line), `RotaPeopleSetup.tsx` (show the result line), `apps/web/src/i18n/ar.ts`, `apps/web/src/test/fixtures.ts` if saved fixtures need `active`
- Test: `SavedPicker.test.tsx`, `PeoplePanel.test.tsx`, `RotaPeopleSetup.test.tsx`

**Interfaces:**
- Consumes: `api.rota.addSavedMany`, `SavedContact.active`.
- Produces: `SavedPicker` prop `room?: number` (free ajza'; required in checklist mode) and `onAddedMany?: (line: string) => void` for the result line.

Copy (exact): tag «يقرأ معك الآن»; button «اختر من يقرأ معك الآن»; room line `t.rota.savedRoom(n)` «بقي لهم n من الأجزاء» via `counted`; add button `t.rota.savedAddMany(n)` «أضِف (n)»; result `t.rota.savedManyResult(added, noRoom)` like «أُضيف ٣.» plus «لم يتّسع لِـ ١.» when `noRoom > 0`, then «ليصلهم وِردهم، يرسل كلٌّ منهم رسالة الانضمام من رابط المجموعة.»; banner button reuses `t.rota.savedFrom`.

- [ ] **Step 1: Write the failing tests** in `SavedPicker.test.tsx`: ticking two and pressing «أضِف (٢)» calls `addSavedMany` with both ids in list order; with `room={1}` the second unticked row is disabled; «اختر من يقرأ معك الآن» ticks the active rows up to room; in-khatma rows can't be ticked; with `juz` a tap still calls `addSaved` once; an `ask_today` answer resends with `readsToday`. In `PeoplePanel.test.tsx`: the banner shows «من ختمات سابقة» only when free ajza' and an addable contact exist, and the result line shows after adding.
- [ ] **Step 2: Run** `bunx vitest run apps/web/src/features/rota` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `bun run typecheck` and `bun run lint` clean.
- [ ] **Step 5: Commit** `feat(web): pick several saved participants at once`.

### Task 4: People count on the organizer's home cards

**Files:**
- Modify: `convex/khatmas.ts` (`mine` cards gain `peopleCount: number | null`: `memberCount(ctx, khatma)` when `roleIn(ctx, khatma, ctx.person) !== null`, else null), `apps/web/src/pages/HomePage.tsx` (`KhatmaCard` pill), `apps/web/src/i18n/ar.ts` (`t.home.peopleCount(n)` via `counted` with شخص / أشخاص / شخصاً; 1 «شخص واحد», 2 «شخصان»)
- Test: `convex/khatmas.test.ts`, `apps/web/src/pages/HomePage.test.tsx`

If importing `memberCount` from `convex/adminLookup.ts` into `khatmas.ts` makes an import cycle, move `memberCount` to `convex/lib/khatma.ts` and re-export it from `adminLookup`.

- [ ] **Step 1: Write the failing tests**: `mine gives the organizer a people count and members none` (pool with 3 active + 1 left → 3 for owner, null for a member; rota with 2 on list + 1 removed → 2). Home: the pill «٣ أشخاص» shows on an organized card, not on a member card; 1 → «شخص واحد», 2 → «شخصان», 11 → «١١ شخصاً».
- [ ] **Step 2: Run** `bunx vitest run convex/khatmas.test.ts apps/web/src/pages/HomePage.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): show the people count on khatmas you organize`.

### Task 5: e2e and wrap-up

**Files:**
- Modify: `e2e/rota.spec.ts`

- [ ] **Step 1:** Add `an organizer adds three saved people to a new khatma in one press`: organizer with a first rota holding three typed people creates a second rota, opens People, opens «من ختمات سابقة», ticks three, presses «أضِف (٣)», sees the three names on juz' 1–3 and the result line.
- [ ] **Step 2: Run** `bunx playwright test e2e/rota.spec.ts` (local Convex per `docs/deploy.md` / the repo's e2e setup) → PASS.
- [ ] **Step 3:** Full `bun run typecheck && bun run lint && bun run test` → clean.
- [ ] **Step 4: Commit** `test(e2e): bulk add saved participants`, plus the spec and plan docs.

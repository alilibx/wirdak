# Wirdak (وِردك) admin console design

**Status:** builder-checked draft for Ali's review
**Linear:** ARQ-292 (parent), ARQ-293 to ARQ-298, ARQ-301 to ARQ-304
**Prototype:** https://claude.ai/artifact/7nfQzShZZHPyiH8vVvzkCJ (source in `prototypes/admin-console`)

This document replaces the design of `apps/admin` from the plan 3 spec (`2026-10-28-wirdak-plan3-design.md`, sections 4 to 10) where the two disagree. Everything plan 3 says that this document doesn't change still holds.

Anything marked **[builder's call]** was decided while writing this, not by Ali, and a builder may change it with a reason. Everything unmarked is what Ali asked for or approved in the prototype.

## 1. Why

`apps/admin` was built as a small phone tool for one person. It's a `max-w-3xl` column with a bottom nav, it imports the website's theme, and it can't browse anything: you need an exact phone number to find a person and a name to find a khatma.

Wirdak now needs a real admin console, because more people will help run it. Ali wants to answer a support question from one screen, see and change everything a normal app admin can, give other people narrower access, and run the same work from Claude.

The prototype settled the shape. This document is how to build it for real.

## 2. Goals, non-goals, and anti-goals

### Goals

1. A shadcn-style console with a desktop layout and a real phone layout, in Arabic and right-to-left.
2. Browsable lists with search, filters, sorting, and paging for people and khatmas.
3. Full create, read, update, and delete for what an admin should manage.
4. Everything `apps/admin` does today, with nothing lost.
5. One view of a person for support, including their reading.
6. Three roles with different pages and actions, enforced on the server.
7. One search box across all admin data, tolerant of Arabic spelling and typos.
8. An agent chat inside the panel, and an MCP server so Claude can do the same work.
9. A WhatsApp message log that says what was sent and why something failed.

### Non-goals

- Running admin tasks from WhatsApp (ARQ-298). The tool layer here makes it possible later.
- An English interface. The panel stays Arabic, as it is today.
- A public Claude directory listing. Wirdak's MCP server is added as a custom connector by its own admins.
- Rewriting rotating khatma logic. `convex/lib/rotaOps.ts` stays the one source of those rules.
- New member-facing features.

### Anti-goals

- **Ranking people.** The panel never ranks or compares people or khatmas, and no leaderboard is ever added. The plan 3 rule against this stands. So no list sorts by how much someone reads, organizes, or completes, and the agent must refuse to do it too.
- **A member's words running a tool.** Help messages, names, and notes reach the model. Nothing they say may cause a change without an admin approving it.
- **Admin power without a record.** Every change is in the audit log, with who did it and through what.
- **Hiding a button and calling it access control.** A role is only real if the server refuses.
- **A regression presented as a redesign.** If the old panel could do it, the new one can.

## 3. What changes from plan 3

| Plan 3 said | Now |
| --- | --- |
| "Every admin can do everything" | Three roles (section 9) |
| The panel never lists one person's reading | Owners and support can see one person's reading on that person's page. Every view is audited. Decided by Ali on 2026-10-30. |
| Phone first, shared look with the website | Its own console design, desktop and phone equally |
| Admins don't edit people's reading | Unchanged for pool khatmas. Rotating khatma tools already let admins mark and reassign, and those stay. |
| Reading the audit log isn't logged | Unchanged. Viewing a person's reading is logged, because the privacy policy limits access to "when needed only". |
| Help replies aren't audit rows | Unchanged in the panel, where the conversation is the record. A reply sent through a proposal does write an audit row, and `helpMessages` gains an optional `adminId`, because replies need an author once several people answer **[builder's call]**. |

## 4. Rules that must hold

- Every admin change writes an audit row in the same transaction. Panel help replies are the one exception, as in plan 3.
- Admin sessions stay separate from member sessions and end after 12 hours.
- Every admin sign-in sends the WhatsApp alert.
- `phoneHidden` numbers stay hidden in every rotating khatma screen, for admins too. `personState` returns `null` for them, and the schema says nothing returns them to a client. Someone with an account still has a number on their person page.
- The last owner can't be removed or demoted.
- Help replies are signed "فريق وِردك", never with an admin's name.
- Refused values are refused, never clamped (`validateSetting`).
- Rotating khatma changes go through `rotaOps`, with `audited()` in `convex/adminRota.ts`.
- `CLAUDE.md` applies: nothing in the repo names Claude as an author. Claude as a product feature is fine in code and copy.

## 5. Console shell

Replace `apps/admin/src/components/Layout.tsx` and stop importing the website's theme.

- **Design system:** shadcn/ui on Tailwind 4 with right-to-left components, and Radix's direction set to `rtl`. Copy the generated components from the prototype, which already fixed the imports and sheet directions.
- **Theme:** the prototype's tokens in `prototypes/admin-console/src/styles.css`: deep green sidebar, near-white work area, saffron for attention, Readex Pro, and Aref Ruqaa for the wordmark. Light and dark, following the system with a toggle.
- **Desktop:** collapsible sidebar on the right, top bar with search, the assistant button, and the theme toggle.
- **Phone:** bottom bar with up to 4 tabs and "المزيد" when a role has more pages. Tables become card lists. Side sheets become bottom sheets. The assistant opens full screen.
- **Routing:** keep `react-router` and real URLs. Each page, person, khatma, and help request has its own link. The prototype's in-memory router was only for the artifact.
- **Shared code:** keep `@web` imports only for logic and `RotaBackend`. Anything visible gets a console version.

Sign-in, the sign-out-by-alert page, and the admin push service worker keep working as they are, restyled.

## 6. Data, lists, and CRUD

Convex can only sort and filter along an index, and the current tables have few. The lists need these additions, all optional fields with a backfill.

### People and readers

Two kinds of record reach support, and the console must handle both:

- **People** have a `people` row. Most came from a WhatsApp sign-in. Some were created by an admin setting up a rotating khatma for an organizer (`organizerFor`), with `verifiedAt: 0` and `lastSeenAt: 0`, so `0` means "never signed in".
- **Readers** read in a rotating khatma on WhatsApp and may have no account. They're `rotaParticipants` rows with `personId: null`. `personId` is only set by their join message, and signing in later doesn't link it.

Everything about someone is therefore looked up **by phone as well as by person**, using `rotaParticipants.by_phone`, so a signed-in reader's page still shows their rotating khatmas and reading.

**New on `people`:** `organizesCount`, `memberOfCount` (pool memberships plus rota participations, by phone), `listTab` (`organizers`, `members`, or `noKhatma`, from the two counts), and `searchName` (folded). **New indexes:** `by_lastSeenAt`, `by_verifiedAt`, `by_searchName`, and one per sort order on `listTab` **[builder's call: an index range on a count pages in count order, the ranking this section forbids, and can't page a tab by name or last seen. An equality on `listTab` can.]**

**New table `readerDirectory`:** one row per phone that reads in a rotating khatma and has no account, with a name, khatma count, and last reply. It exists because the reader list needs paging by distinct phone **[builder's call]**.

The tabs are **All**, **Organizers** (`organizesCount > 0`), **Members** (`organizesCount = 0`, `memberOfCount > 0`), **No khatma**, and **WhatsApp readers** (from `readerDirectory`). Update the counts and the directory with one helper (`refreshPhone`), wherever `members`, `khatmas.creatorPersonId`, or `rotaParticipants` change, and repair drift in a nightly cron **[builder's call]**. The same run, `internal.directory.repair`, is the backfill.

**Sorting.** Name, last seen, joined, and created. Counts can show, and filters can use them, but no column sorts by organizing, membership, or completions, because that's a leaderboard one click away. The prototype's count sorts don't carry over.

Blocked isn't a `people` field. It comes from `blockedPhones`, so the Blocked filter pages through that table instead.

The Organizers tab shows their khatmas, total members, the rotating khatma switch, an absence flag, and masked numbers. Total members and the flag are new: `adminLookup.organizers` returns neither, so add them, using `organizerInactiveMs` for the flag. A full number shows on the person's page.

| Operation | Rule |
| --- | --- |
| Create | **No "add person" [builder's call].** An admin can't prove a number on WhatsApp, and a row made by hand would only widen the unverified case. Unverified accounts keep coming from one place, `organizerFor`, and show a "لم ينضمّ بعد" status. The prototype's add button is dropped. |
| Read | Section 7 |
| Update | Name, time zone, WhatsApp notes, rotating khatma permission, an internal note |
| Move to a new number | Section 6.2 |
| Delete | Section 6.3 |
| Bulk | End sessions, block, and CSV export. Export is owner-only, needs a reason, and is audited. |

Admin notes live in a new `adminNotes` table, keyed by person, so they never travel to member queries **[builder's call]**.

A reader's page is read-only apart from deletion: their khatmas, slots, reading, join status, and WhatsApp messages. Rotating khatma changes happen on the khatma.

### Khatmas

**New on `khatmas`:** `searchName`, and `completedDays` for a rotating khatma, because counting its reading days on every list row reads too much **[builder's call]**. Use the default `_creationTime` order, or `by_kind` for the kind filter.

Pool khatmas gain edit name, edit schedule and grace, archive, restore, and delete. `archive` and `remove` already exist as `sessionMutation`s in `convex/khatmaLifecycle.ts`, so move their logic to shared functions and add `adminMutation` versions. Admin creation of a pool khatma takes an existing person as organizer. Reset invite and hand over stay as they are.

**Restore is pool only.** Archiving a pool khatma clears its notes and sets `archivedAt`, so restoring clears `archivedAt`, a deliberate exception to "An archived khatma can only be read, and deleted". The builder must test holds whose grace ended during the archive. Archiving a rotating khatma closes its day, skips its messages, and declines its join requests, so that stays final, and the prototype's restore on those is dropped.

The list shows kind («بالحجز» or «بالتناوب»), status, organizer, members, today's progress for rotating khatmas, and completed count, none of them sortable except name and created date, with a filter for pending join requests.

### 6.2 Moving to a new number

The person sends a one-time code from the new number on WhatsApp, reusing the verification flow, and only then does the admin's move complete **[builder's call: moving a number on someone's word alone is an account takeover path]**.

- **Refused** if the new number has an account, is blocked, or is an admin. Accounts are never merged.
- **Moves with it:** `people.phone`, their `rotaParticipants`, `rotaContacts` holding that number, and open `rotaJoinRequests`. `waContacts` for the old number is deleted, because the 24-hour window belongs to a number.
- **Ends** all their sessions.
- **Tells the old number** by a new Meta-approved template, because a free-form message won't arrive outside the 24-hour window. This step of the build waits for that template (ARQ-306).

The same flow works for a reader with no account.

### 6.3 Deleting an account

No delete exists today, and the privacy policy promises one: "When we delete your account, we delete your name, number, devices, and notification subscriptions."

Add `adminPeople.deleteAccount`, open to any admin (see the decision in section 9), with a typed confirmation and a reason. The same function handles a reader with no account.

- **Blocked until resolved:** it's refused while the person organizes an active rotating khatma. Rotating khatmas have no successor ("a rota khatma keeps its organizer"), and archiving one stops messages to every reader, so an admin must archive or delete it as a deliberate step. It lists those khatmas. A rotating handover is a later feature **[builder's call]**.
- **Their pool khatmas:** hand over with the existing successor rules. With no successor, archive.
- **Removed:** `sessions`, `pushSubscriptions`, `handoffTokens`, `notes`, `waContacts`, the `rotaContacts` they own, `adminNotes`, and their help requests with files.
- **Rotating participation:** `rotaOps.removeParticipant` is a soft delete that keeps the name and number, so also blank both on the row. Keep the row, because today's reads point to it.
- **Reading history:** `assignments` stay so a khatma's totals stay true, with `personId` pointing to a tombstone `people` row (`displayName: "حساب محذوف"`, a random unmatchable phone) **[builder's call: schemas require a `personId`, and a tombstone avoids rewriting them]**.
- **Audit log:** rows stay, because they record what admins did, but the person's name and number are scrubbed from them. New rows must stop holding raw numbers: `phone.block` uses a number as `targetId`, and `rota.adminCreate` and `addParticipant` store them. Old rows need one batched scan on each deletion, since `before` and `after` have no phone index.
- **A block survives deletion.** `blockedPhones` keeps a keyed hash of the number instead of the number, and `isBlocked` also checks hashes. Otherwise deleting an account would clear a block. The privacy wording must say so (ARQ-304).
- **Other organizers' saved lists stay.** The privacy page says "each person stays on it until the organizer removes them".
- **WhatsApp log and chats:** their rows are deleted.

Run it in batches through the scheduler if a person has many rows. The builder must walk every table in `schema.ts` that holds a `personId` or a phone, and test each one.

### 6.4 Other lists

Help inbox, audit log, and admins keep their existing queries. The audit list adds a filter by source, and gains a by-person view through a new `by_target_at` index on `targetId`.

## 7. Support view of a person

Header: name, number, role pill, status, and actions. A reader's page has the same layout with fewer actions (section 6). Tabs: Summary, Khatmas, Reading, Help, WhatsApp, and Audit, each shown only if the role allows it.

**Reading.** Juz' taken, finished, and left, usual time per juz', and last reading, from `assignments`, and from `rotaReads` through every participant row with that phone. Read only.

`get reading` is a **mutation**, not a query, so the data and its audit row commit together. Convex queries can't write, and this is what makes "every view is audited" true. The client calls it when the tab opens and holds the result, so it isn't live **[builder's call]**. New audit action: `person.readingView`.

**Help inbox.** Three panes on wide screens: list, conversation, and context (the person, their khatma, recent failed messages, and the device). Saved replies live in a new `helpReplies` table that owners edit **[builder's call]**. The prototype's four are starter data.

## 8. Rotating khatmas, settings, and today's pages

**Rotating khatmas.** No change to rota logic. Rebuild the website's panels in console components on top of the existing `RotaBackend` and `AdminRotaProvider`, so `useRotaBackend` keeps pointing at `api.adminRota.*`. Those functions do gain role checks and role-shaped numbers (section 9).

That covers today's grid, assign, mark done and undo, people and slots, move and swap, extra ajza', join link, join requests, saved participants, message times, pause and pause dates, reading days, time zone, archive, delete, and setup on an organizer's behalf. Reading-days editing after creation must come from the real panel, because the prototype doesn't have it.

Import from a pool khatma and "start again" stay organizer-only, as they are today (`OrganizerOnly` in `backend.tsx`). The panel doesn't have them now, and import is how hidden numbers enter a khatma.

**Settings.** Keep `adminSettings.list`, `set`, and `reset`, `SETTING_LAYOUT`, `formatSetting`, and the Arabic help text. Rebuild the look only. The 58 settings, the 7 groups, the changed tab, search, and the why notes stay, plus the one new setting from section 11. Copy the prototype's `SettingsPage.tsx` shape.

**Overview.** Keep `adminStats.overview` and `trend`. Show what needs attention first, then the numbers, the 30-day chart, and recent changes.

**Notifications.** The push card moves from the home page to a new personal page (section 9).

## 9. Roles

Add `role` to `admins`: `owner`, `support`, or `viewer`. Existing admins become `owner` in the backfill, and `bootstrap` creates an owner.

| Page | Owner | Support | Viewer |
| --- | --- | --- | --- |
| Overview, people, khatmas | yes | yes | yes |
| Help, WhatsApp messages, audit log | yes | yes | no |
| Settings, team, assistant and Claude access | yes | no | no |
| My account (`/me`) | yes | yes | yes |
| Approvals (`/approvals`) | yes | yes | no |

| Action | Owner | Support | Viewer |
| --- | --- | --- | --- |
| Reply to help, full phone numbers, see reading | yes | yes | no |
| Edit people, block, edit khatmas, rotating khatma tools | yes | yes | no |
| Delete an account or khatma, export, change settings, manage team | yes | no | no |

**Decision, 2026-11-01:** Ali decided that an admin can edit, delete, and do anything on all records. Delete and export aren't owner-only, so `adminKhatmas.remove` and the planned `adminPeople.deleteAccount` take any admin. ARQ-297 must not narrow this without asking him. Every change stays in the audit log.
| Use the assistant | yes | yes | yes, read only |
| Connect Claude | yes | yes | no |

Permissions live in one table, `convex/lib/adminPermissions.ts`. Each admin function declares what it needs, through a `requirePermission(ctx, "person.block")` call at the top or a `withPermission` wrapper **[builder's call]**. A missing permission throws `ConvexError({ code: "forbidden" })`, and the client shows the no-access page.

The client reads the same table for navigation, tabs, and buttons. That table is the only list.

Server responses must be shaped by role, not only hidden: a viewer's query returns masked numbers, and search can't match a number the role can't see.

**My account** is new and open to everyone: their own notifications and their own Claude connections with revoke. The owner-only access page sees everyone's connections. `/connect` refuses a viewer.

**Pushes follow pages.** Help pushes go only to roles with the help page. `adminPush.deliveryPlan` sends them to every admin today.

Roles come before the agent in the build order, even though Ali first called them "later", because every tool depends on them.

## 10. Global search

The prototype's search can't move to the server as it is. It loads all data into the browser, which real data can't do, and Convex search differs in ways that matter. From the Convex docs: "Search has no typo tolerance", only the last term matches by prefix, a query takes up to 16 terms and scans up to 1024 results, and search "works best with English or other Latin-script languages".

So build this:

- **A `searchEntries` table.** One row per searchable thing: `kind`, `targetId`, `title`, `subtitle`, `text` (folded words), `grams` (folded trigrams), `phoneDigits`, `phoneReversed`, and `updatedAt`. Written by a helper in the same mutations that change the source row, with a backfill and a nightly repair.
- **Two search indexes on it:** `search_text` on `text` and `search_grams` on `grams`, each filterable by `kind`.
- **Folding at write and query time.** One function in `convex/lib/searchFold.ts`, moved from the prototype's `src/lib/search.ts`: marks removed, «أإآ» to «ا», «ى» to «ي», «ة» to «ه», «ؤ» to «و», «ئ» to «ي», and Arabic digits to Latin.
- **Phones.** Prefix lookups on `phoneDigits` and suffix lookups on `phoneReversed`, by index range. Normalize `+971`, `00971`, and a leading `0` first. Skipped entirely for a role without `phone.view`.
- **Typos.** Try `search_text` first. If it finds fewer than 3 hits, search `search_grams`, which matches on shared trigrams, then rerank with the prototype's edit-distance scorer. That keeps typo matches from burying exact ones, the same rule the prototype settled on **[builder's call]**.
- **Readers.** Rows for `readerDirectory` too, so a reader with no account is findable by name or number.
- **Words.** The prototype's English-to-Arabic word map (`blocked` to «محظور») runs at query time.
- **Settings, pages, and team** are few, so the client searches them locally.
- **Messages.** Index failed and skipped messages only. Delivered ones add noise and volume.

**Test Arabic first.** The docs don't describe Arabic tokenizing, so the first task is a spike on staging proving that folded Arabic text is matched by `search_text` and that trigrams work. If Arabic trigrams tokenize badly, store them as ASCII hashes.

`adminSearch.all` returns results grouped by kind, filtered by role. The agent's search tool calls the same function.

## 11. WhatsApp message log

Today nothing records this. `postMessage` in `convex/whatsapp.ts` knows `sent`, `refused`, or `failed` and returns only that, and the webhook ignores delivery statuses (`parseIncoming` skips them).

- **New table `whatsappLog`:** `phone`, `personId`, `khatmaId`, `template`, `kind`, `status` (`sent`, `delivered`, `read`, `failed`, `refused`, `skipped`), `reason`, `waMessageId`, `source` (the outbox row, if any), `at`, and `updatedAt`. Indexes by `waMessageId`, by person, by status and time, and by time.
- **Writing it.** `postMessage` is the one send point, so it records each attempt, taking the message id from Meta's response. Outbox and note skips record `skipped` with their reason. Never store message bodies or codes, only the template name.
- **Statuses.** Extend the webhook to read `statuses` entries and update the row by `waMessageId`, keeping Meta's error text as `reason`.
- **Staging.** Meta sends webhooks only to production, so production must ignore a status for an unknown `waMessageId`, without error, and staging rows stay at `sent`. Don't extend the relay **[builder's call]**. Test the parsing with signed fixtures, and check real statuses right after the release that ships it.
- **Retention:** 30 days by a new setting `whatsappLogRetentionMs`, purged by cron **[builder's call]**.
- **Resend.** Only a failed `rotaOutbox` message for a day that's still open. Rows are marked sent before sending, and a note or an old day's juz' is stale by the time anyone retries it. Everything else shows no button **[builder's call]**. The prototype's resend-anything button doesn't carry over.

## 12. Tool layer

One set of tools for the panel chat, MCP, and later WhatsApp, in `convex/adminTools/`.

Each tool declares its name, description, input schema, permission, tier, and handler. Handlers reuse the same functions the admin mutations call. Extract those where they're inline, so no rule exists twice.

| Tier | Behavior |
| --- | --- |
| Read | Runs at once |
| Approval | Creates a proposal. Nothing changes until an admin approves. |
| Panel only | Not a tool at all: delete account, delete khatma, export, team management, move a number |

**Read tools:** `search_everything`, `get_person`, `get_person_reading`, `get_khatma`, `get_rota_today`, `get_help`, `get_overview`, `get_setting`, `list_failed_messages`, `reveal_phone`.

**Approval tools:** block, unblock, end sessions, rotating khatma permission, rename person, reply to help, close help, archive, restore (pool only), hand over, set setting, rota mark done, rota reassign, rota pause.

**Proposals.** New table `adminProposals`: `adminId`, `source` (`agent` or `mcp`), `tool`, `args`, `summary`, `status`, `createdAt`, `expiresAt`, `decidedAt`, and `result`.

- `approve` is an `adminMutation` that rechecks the permission, the tool switch, and the target, then runs the handler and writes the audit row in one transaction.
- Only the admin who started it can approve it **[builder's call]**. A proposal is single use and expires after 1 hour **[builder's call]**.
- The summary shown on the card comes from the server's own reading of the args, never from the model's text, so what the admin sees is what runs.

**Audit.** Add optional `via` (`agent` or `mcp`) and `proposalId` to `auditLog`. Add the new actions to `auditActionValidator`.

**Safety.**

- Each call resolves the admin and role fresh.
- Tools return masked numbers for every caller, in chat and over MCP, and a separate audited `reveal_phone` read tool returns a full one for roles that may see it **[builder's call: both routes share these tools, and it keeps the privacy statement single]**.
- A tool result that contains member-written text wraps it as data. The agent's instructions say it's data.
- The server enforces the rules. The prompt is a second layer, not the protection.
- `get_person_reading` writes the audit row with `via`.
- Reply-to-help text is always shown in full on the card.
- Owner switches per tool live in a new `adminToolSwitches` table.

## 13. Agent chat in the panel

The prototype runs on the viewer's own Claude account through the artifact page. Production can't, so it runs from Convex with Wirdak's API key.

- **Loop.** A Convex action (`"use node"`) using `@anthropic-ai/sdk` runs the tool loop and calls tools through internal functions that take the admin's id. The action must confirm the session before starting, because `adminToken` isn't available to internal calls.
- **Streaming.** The action writes text to `adminChatMessages` as it arrives, batched a few times a second, and the panel subscribes with a normal Convex query **[builder's call: it survives a reload and needs no streaming endpoint]**.
- **Storage.** `adminChats` and `adminChatMessages`, with raw content blocks stored unchanged and history append-only, which current models require for thinking blocks. Purge after 30 days **[builder's call]**. These tables hold personal data, so include them in account deletion.
- **Model.** `claude-opus-5-5`, with `output_config.effort` set per route and measured, starting at `low` for chat. Use `tool_choice: auto` with `strict: true` tools, prompt caching on the stable prefix, and the server-side fallback. Read the `claude-api` skill before writing this.
- **Limits.** One run at a time per chat, a turn limit per run, Stop, and a monthly spend limit that disables the chat with a clear message. Ali sets the number.
- **Interface.** The prototype's `AgentPanel.tsx`: side panel, activity lines, approval cards, suggestions by page, and entry from search.
- **Data paths.** Panel chat sends data to Anthropic on Wirdak's API key. MCP sends tool results into each admin's own Claude account. The privacy wording must cover both (ARQ-304).

Before building, read ARQ-82 and ARQ-125 from Fastlane Founder, which built an admin agent on Convex Agents. If that component suits this tool layer, use it instead of a hand-written loop **[builder's call]**.

## 14. MCP server

Admins add Wirdak to Claude as a custom connector. The same requirements cover claude.ai, Desktop, mobile, and Claude Code.

**Endpoint.** `https://admin.wirdak.app/mcp`, and `https://stg-admin.wirdak.app/mcp` on staging, through a Vercel rewrite to the Convex HTTP route, so the URL stays stable and `/.well-known/*` can be served **[builder's call]**.

**Transport.** Streamable HTTP, stateless, answering POST with plain `application/json`, which the spec allows. No session id. GET returns 405. Notifications return 202. Validate `Origin` and return 403 if it's present and invalid. Check `MCP-Protocol-Version`.

Convex HTTP actions run in the Convex runtime without Node APIs, so a small hand-written JSON-RPC handler for `initialize`, `tools/list`, and `tools/call` is likely simpler than the SDK **[builder's call]**.

**OAuth.** Claude supports DCR or CIMD, and needs:

- A `401` with `WWW-Authenticate: Bearer resource_metadata="..."` on unauthenticated requests. Claude ignores that header on a `200`.
- Protected resource metadata whose `resource` equals the MCP URL exactly, and whose first `authorization_servers` entry is ours.
- Authorization server metadata with `code_challenge_methods_supported: ["S256"]`.
- A registration endpoint, or `client_id_metadata_document_supported: true` with `none` in `token_endpoint_auth_methods_supported`. Support both **[builder's call]**.
- Redirect URIs `https://claude.ai/api/mcp/auth_callback`, plus loopback for Claude Code on any port, for both `localhost` and `127.0.0.1`. Reject everything else.
- A token endpoint that accepts `application/x-www-form-urlencoded`, returns `invalid_grant` for a dead refresh token, rotates refresh tokens, and answers within 10 seconds.
- Tokens bound to this resource, and never accepted from a query string.

**Sign-in.** `/oauth/authorize` sends the browser to a panel page, `/connect`. The admin signs in with the normal WhatsApp code, then sees a consent screen with the client's name and redirect hostname. Connecting sends a WhatsApp alert, like any sign-in.

**Tokens.** New tables `oauthClients`, `oauthCodes`, and `mcpConnections`, storing hashes only. Access tokens last 1 hour, and refresh tokens last 30 days **[builder's call]**. Each request resolves the connection to its admin, so removing an admin or changing a role takes effect at once. The 12-hour session rule doesn't apply to a connection, which is why it's revocable, listed, and alerted **[builder's call]**.

**Approvals.** Approval tools create a proposal and return "waiting for approval in the admin panel", and the admin approves there. A new `/approvals` page lists them, with a badge and a push. Claude's own tool prompt isn't enough, because a client's "always allow" setting would bypass it **[builder's call]**.

**Access page.** The prototype's **المساعد وClaude**: connection steps, connections with revoke, tool switches, and activity.

**Rate limits.** Per connection, using the existing `rateLimits` table.

## 15. Build order

Each step is one or more pull requests through staging. The panel keeps working after every merge.

| # | Work | Linear |
| --- | --- | --- |
| 1 | Shell, theme, and shadcn. Every existing page restyled with no behavior change. | ARQ-294 |
| 2 | Lists: counts, indexes, backfills, and people and khatma tables, including the organizer tab | ARQ-295 |
| 3 | Roles, permissions, and role-shaped responses | ARQ-297 |
| 4 | CRUD: edit, archive, restore, delete, move number, and delete account | ARQ-295, ARQ-306 |
| 5 | Support view, reading, and help inbox | ARQ-296 |
| 6 | WhatsApp log | ARQ-296 |
| 7 | Global search, starting with the Arabic spike | ARQ-303 |
| 8 | Tool layer and proposals | ARQ-301 |
| 9 | Privacy policy update and the API key, Ali's steps | ARQ-304, ARQ-305 |
| 10 | Agent chat | ARQ-301 |
| 11 | MCP server and access page | ARQ-302 |

Steps 1 to 7 are useful without any AI. Step 9 must land before 10 or 11 touch production data.

Step 1 is the riskiest for regressions, so it changes no behavior and keeps the existing tests passing. It also needs `prototypes/admin-console` committed or carried over, because it copies the generated components from there.

## 16. Decisions to confirm

Ali's standing preference is to go with the recommendation, so these are the defaults unless he says otherwise. Each changes something he saw in the prototype, or a promise to members:

1. **No "add person" button.** Accounts come from sign-in, or from setting up a rotating khatma for an organizer.
2. **WhatsApp readers get their own tab and page,** because they often have no account.
3. **Moving a number needs a code from the new number,** never merges accounts, and waits for a new Meta template.
4. **Deleting an organizer of a rotating khatma is refused** until an admin archives or deletes that khatma. No rotating handover yet.
5. **After deletion, a keyed hash of a blocked number stays** so a block can't be cleared, and the audit log keeps the action without the name or number.
6. **No sorting by counts or completions,** to hold the no-ranking rule. The prototype had these.
7. **A rotating khatma's archive stays final,** and restore is pool only. The prototype showed restore on both.
8. **Support has no settings page,** and a viewer has no audit log, approvals, or Claude connection.
9. **Changes from Claude are approved in the panel,** so they need a trip there.
10. **Admins can't import from a pool khatma or start again.** Those stay organizer-only, as today.

## 17. Testing

- **Permissions.** A table-driven `convex-test` suite that calls every admin function as every role. A new function with no declared permission fails the test.
- **Account deletion.** Fixtures with a person in every table, then a check that their name and number remain only where section 6.3 says: other organizers' saved lists. Cover a reader with no account, an unverified organizer, and a refused delete.
- **Moving a number.** Each refusal, and each table that moves.
- **Search.** Arabic folding, digits, phone formats, role filtering, and typo fallback, using the prototype's cases as a start.
- **Tools.** Each tool's permission, proposal lifecycle, expiry, double approval, and a target that changed between proposal and approval.
- **Prompt injection.** An eval with help messages that give instructions. Pass means no proposal the admin didn't ask for.
- **MCP.** Protocol and OAuth tests, including wrong audience, reused code, reused refresh token, and bad redirect. Then connect real Claude and Claude Code on staging.
- **End to end.** Keep `e2e/admin-rota.spec.ts` passing, and add sign-in, a role check, and one CRUD flow.
- **Layout.** Playwright at 375px and desktop in light and dark, asserting no sideways scroll. The prototype hit this bug twice, from grid children that needed `minmax(0, 1fr)`.

## 18. Left to the builder

File layout inside `apps/admin` and `convex`, how readers and people share page components, the exact shape of the permission wrapper, whether counts move to Convex triggers, how chat text is batched, table page sizes, and how much of the prototype's code to copy. Treat `prototypes/admin-console` as a reference for behavior and look, not as production code, and delete it when the console ships.

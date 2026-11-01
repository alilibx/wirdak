/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAuth from "../adminAuth.js";
import type * as adminHelp from "../adminHelp.js";
import type * as adminKhatmas from "../adminKhatmas.js";
import type * as adminLists from "../adminLists.js";
import type * as adminLookup from "../adminLookup.js";
import type * as adminOps from "../adminOps.js";
import type * as adminPeople from "../adminPeople.js";
import type * as adminPush from "../adminPush.js";
import type * as adminRota from "../adminRota.js";
import type * as adminSettings from "../adminSettings.js";
import type * as adminStats from "../adminStats.js";
import type * as admins from "../admins.js";
import type * as audit from "../audit.js";
import type * as cheers from "../cheers.js";
import type * as crons from "../crons.js";
import type * as dev from "../dev.js";
import type * as directory from "../directory.js";
import type * as grace from "../grace.js";
import type * as handoff from "../handoff.js";
import type * as help from "../help.js";
import type * as hooks from "../hooks.js";
import type * as http from "../http.js";
import type * as khatmaLifecycle from "../khatmaLifecycle.js";
import type * as khatmas from "../khatmas.js";
import type * as lib_adminSession from "../lib/adminSession.js";
import type * as lib_arabicCount from "../lib/arabicCount.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_blocked from "../lib/blocked.js";
import type * as lib_cheer from "../lib/cheer.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_digits from "../lib/digits.js";
import type * as lib_directory from "../lib/directory.js";
import type * as lib_duas from "../lib/duas.js";
import type * as lib_grace from "../lib/grace.js";
import type * as lib_help from "../lib/help.js";
import type * as lib_helpFiles from "../lib/helpFiles.js";
import type * as lib_juz from "../lib/juz.js";
import type * as lib_khatma from "../lib/khatma.js";
import type * as lib_milestones from "../lib/milestones.js";
import type * as lib_noteText from "../lib/noteText.js";
import type * as lib_pace from "../lib/pace.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_rota from "../lib/rota.js";
import type * as lib_rotaJoin from "../lib/rotaJoin.js";
import type * as lib_rotaOps from "../lib/rotaOps.js";
import type * as lib_rotaOps_people from "../lib/rotaOps/people.js";
import type * as lib_rotaOps_settings from "../lib/rotaOps/settings.js";
import type * as lib_rotaOps_today from "../lib/rotaOps/today.js";
import type * as lib_rotaPayload from "../lib/rotaPayload.js";
import type * as lib_rotaPlace from "../lib/rotaPlace.js";
import type * as lib_rotaReplies from "../lib/rotaReplies.js";
import type * as lib_rotaTemplates from "../lib/rotaTemplates.js";
import type * as lib_schedule from "../lib/schedule.js";
import type * as lib_searchFold from "../lib/searchFold.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_settingSpecs from "../lib/settingSpecs.js";
import type * as lib_settings from "../lib/settings.js";
import type * as lib_stats from "../lib/stats.js";
import type * as lib_text from "../lib/text.js";
import type * as lib_wakingTime from "../lib/wakingTime.js";
import type * as lib_whatsappTemplates from "../lib/whatsappTemplates.js";
import type * as maintenance from "../maintenance.js";
import type * as notes from "../notes.js";
import type * as nudges from "../nudges.js";
import type * as organizer from "../organizer.js";
import type * as people from "../people.js";
import type * as pool from "../pool.js";
import type * as preview from "../preview.js";
import type * as publicSettings from "../publicSettings.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as rota from "../rota.js";
import type * as rotaDays from "../rotaDays.js";
import type * as rotaInbound from "../rotaInbound.js";
import type * as rotaOutbox from "../rotaOutbox.js";
import type * as rounds from "../rounds.js";
import type * as sessions from "../sessions.js";
import type * as stats from "../stats.js";
import type * as verification from "../verification.js";
import type * as whatsapp from "../whatsapp.js";
import type * as whatsappNotes from "../whatsappNotes.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAuth: typeof adminAuth;
  adminHelp: typeof adminHelp;
  adminKhatmas: typeof adminKhatmas;
  adminLists: typeof adminLists;
  adminLookup: typeof adminLookup;
  adminOps: typeof adminOps;
  adminPeople: typeof adminPeople;
  adminPush: typeof adminPush;
  adminRota: typeof adminRota;
  adminSettings: typeof adminSettings;
  adminStats: typeof adminStats;
  admins: typeof admins;
  audit: typeof audit;
  cheers: typeof cheers;
  crons: typeof crons;
  dev: typeof dev;
  directory: typeof directory;
  grace: typeof grace;
  handoff: typeof handoff;
  help: typeof help;
  hooks: typeof hooks;
  http: typeof http;
  khatmaLifecycle: typeof khatmaLifecycle;
  khatmas: typeof khatmas;
  "lib/adminSession": typeof lib_adminSession;
  "lib/arabicCount": typeof lib_arabicCount;
  "lib/audit": typeof lib_audit;
  "lib/blocked": typeof lib_blocked;
  "lib/cheer": typeof lib_cheer;
  "lib/crypto": typeof lib_crypto;
  "lib/digits": typeof lib_digits;
  "lib/directory": typeof lib_directory;
  "lib/duas": typeof lib_duas;
  "lib/grace": typeof lib_grace;
  "lib/help": typeof lib_help;
  "lib/helpFiles": typeof lib_helpFiles;
  "lib/juz": typeof lib_juz;
  "lib/khatma": typeof lib_khatma;
  "lib/milestones": typeof lib_milestones;
  "lib/noteText": typeof lib_noteText;
  "lib/pace": typeof lib_pace;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/rota": typeof lib_rota;
  "lib/rotaJoin": typeof lib_rotaJoin;
  "lib/rotaOps": typeof lib_rotaOps;
  "lib/rotaOps/people": typeof lib_rotaOps_people;
  "lib/rotaOps/settings": typeof lib_rotaOps_settings;
  "lib/rotaOps/today": typeof lib_rotaOps_today;
  "lib/rotaPayload": typeof lib_rotaPayload;
  "lib/rotaPlace": typeof lib_rotaPlace;
  "lib/rotaReplies": typeof lib_rotaReplies;
  "lib/rotaTemplates": typeof lib_rotaTemplates;
  "lib/schedule": typeof lib_schedule;
  "lib/searchFold": typeof lib_searchFold;
  "lib/session": typeof lib_session;
  "lib/settingSpecs": typeof lib_settingSpecs;
  "lib/settings": typeof lib_settings;
  "lib/stats": typeof lib_stats;
  "lib/text": typeof lib_text;
  "lib/wakingTime": typeof lib_wakingTime;
  "lib/whatsappTemplates": typeof lib_whatsappTemplates;
  maintenance: typeof maintenance;
  notes: typeof notes;
  nudges: typeof nudges;
  organizer: typeof organizer;
  people: typeof people;
  pool: typeof pool;
  preview: typeof preview;
  publicSettings: typeof publicSettings;
  push: typeof push;
  pushNode: typeof pushNode;
  rota: typeof rota;
  rotaDays: typeof rotaDays;
  rotaInbound: typeof rotaInbound;
  rotaOutbox: typeof rotaOutbox;
  rounds: typeof rounds;
  sessions: typeof sessions;
  stats: typeof stats;
  verification: typeof verification;
  whatsapp: typeof whatsapp;
  whatsappNotes: typeof whatsappNotes;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

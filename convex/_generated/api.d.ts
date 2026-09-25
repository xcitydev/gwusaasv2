/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as ai from "../ai.js";
import type * as billing from "../billing.js";
import type * as carouselTemplates from "../carouselTemplates.js";
import type * as carousels from "../carousels.js";
import type * as config from "../config.js";
import type * as createActions from "../createActions.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as files from "../files.js";
import type * as forms from "../forms.js";
import type * as generations from "../generations.js";
import type * as http from "../http.js";
import type * as hub from "../hub.js";
import type * as igAi from "../igAi.js";
import type * as igDms from "../igDms.js";
import type * as igDmsActions from "../igDmsActions.js";
import type * as inviteCodes from "../inviteCodes.js";
import type * as leadProviders from "../leadProviders.js";
import type * as leadSearches from "../leadSearches.js";
import type * as leads from "../leads.js";
import type * as lib_apify from "../lib/apify.js";
import type * as lib_audio from "../lib/audio.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bland from "../lib/bland.js";
import type * as lib_calcom from "../lib/calcom.js";
import type * as lib_credits from "../lib/credits.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_elevenlabs from "../lib/elevenlabs.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_explorium from "../lib/explorium.js";
import type * as lib_fal from "../lib/fal.js";
import type * as lib_ghl from "../lib/ghl.js";
import type * as lib_higgsfield from "../lib/higgsfield.js";
import type * as lib_instantly from "../lib/instantly.js";
import type * as lib_mp4 from "../lib/mp4.js";
import type * as lib_recall from "../lib/recall.js";
import type * as lib_transcript from "../lib/transcript.js";
import type * as lib_youtube from "../lib/youtube.js";
import type * as noteTaker from "../noteTaker.js";
import type * as noteTakerActions from "../noteTakerActions.js";
import type * as noteTakerAi from "../noteTakerAi.js";
import type * as notifications from "../notifications.js";
import type * as outreach from "../outreach.js";
import type * as outreachActions from "../outreachActions.js";
import type * as referrals from "../referrals.js";
import type * as studioActions from "../studioActions.js";
import type * as team from "../team.js";
import type * as tickets from "../tickets.js";
import type * as tools from "../tools.js";
import type * as users from "../users.js";
import type * as voice from "../voice.js";
import type * as voiceActions from "../voiceActions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  ai: typeof ai;
  billing: typeof billing;
  carouselTemplates: typeof carouselTemplates;
  carousels: typeof carousels;
  config: typeof config;
  createActions: typeof createActions;
  crons: typeof crons;
  dashboard: typeof dashboard;
  files: typeof files;
  forms: typeof forms;
  generations: typeof generations;
  http: typeof http;
  hub: typeof hub;
  igAi: typeof igAi;
  igDms: typeof igDms;
  igDmsActions: typeof igDmsActions;
  inviteCodes: typeof inviteCodes;
  leadProviders: typeof leadProviders;
  leadSearches: typeof leadSearches;
  leads: typeof leads;
  "lib/apify": typeof lib_apify;
  "lib/audio": typeof lib_audio;
  "lib/auth": typeof lib_auth;
  "lib/bland": typeof lib_bland;
  "lib/calcom": typeof lib_calcom;
  "lib/credits": typeof lib_credits;
  "lib/crypto": typeof lib_crypto;
  "lib/elevenlabs": typeof lib_elevenlabs;
  "lib/email": typeof lib_email;
  "lib/explorium": typeof lib_explorium;
  "lib/fal": typeof lib_fal;
  "lib/ghl": typeof lib_ghl;
  "lib/higgsfield": typeof lib_higgsfield;
  "lib/instantly": typeof lib_instantly;
  "lib/mp4": typeof lib_mp4;
  "lib/recall": typeof lib_recall;
  "lib/transcript": typeof lib_transcript;
  "lib/youtube": typeof lib_youtube;
  noteTaker: typeof noteTaker;
  noteTakerActions: typeof noteTakerActions;
  noteTakerAi: typeof noteTakerAi;
  notifications: typeof notifications;
  outreach: typeof outreach;
  outreachActions: typeof outreachActions;
  referrals: typeof referrals;
  studioActions: typeof studioActions;
  team: typeof team;
  tickets: typeof tickets;
  tools: typeof tools;
  users: typeof users;
  voice: typeof voice;
  voiceActions: typeof voiceActions;
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

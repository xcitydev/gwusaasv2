import type { TourDefinition } from "./tour";

/**
 * Tour step lists. Targets are data-tour attributes on the real controls —
 * a step whose target isn't on screen falls back to a centered card, so
 * tours stay safe when a page is in an empty or unusual state.
 */

export const WELCOME_TOUR: TourDefinition = {
  id: "welcome",
  steps: [
    {
      title: "Welcome to Creatily 👋",
      body: "Your whole growth team, run by AI. Here's a quick lay of the land — takes half a minute.",
    },
    {
      target: "dash-stats",
      title: "Your workspace at a glance",
      body: "Live numbers from everything running — credits left, campaigns, replies, leads found.",
    },
    {
      target: "dash-aihub",
      title: "Create with AI",
      body: "Images, video, motion control and the Studio models — describe what you want, see the exact credit price, then render.",
    },
    {
      target: "dash-shortcuts",
      title: "Every tool, one click away",
      body: "GROW is your pipeline — outreach, leads, calls, DMs, meetings. CREATE is your content. Each page has its own “Show me around” walkthrough like this one.",
    },
  ],
};

export const LEADS_TOUR: TourDefinition = {
  id: "leads",
  steps: [
    {
      title: "Find your customers",
      body: "Describe who you want in plain English — the AI searches Google Maps, LinkedIn and B2B databases, dedupes everything and verifies emails. Leads cost a few credits each, priced by source before you import.",
    },
    {
      target: "leads-search",
      title: "Just ask",
      body: "Type something like “med spas in Miami”, pick a source (or let the AI choose), set how many, and hit Search.",
    },
    {
      target: "leads-tab-leads",
      title: "Your lead list",
      body: "See where every lead lands.",
      advance: "click",
    },
    {
      title: "One deduped list 🎯",
      body: "Every search adds to this list — export CSV, import your own, and feed leads straight into Outreach campaigns or AI Cold Calling.",
    },
  ],
};

export const RECEPTIONIST_TOUR: TourDefinition = {
  id: "receptionist",
  steps: [
    {
      title: "Your AI Receptionist",
      body: "It answers your business line 24/7 — in your own cloned voice if you want — books meetings, and hands you the transcript. Talk time bills per second in credits.",
    },
    {
      target: "receptionist-setup",
      title: "Set it up here",
      body: "Give it a name and greeting, write the prompt that tells it how to answer, and pick a voice — including your own clone from Clone Your Voice.",
    },
    {
      target: "receptionist-test",
      title: "Try it before going live",
      body: "Talk to it right in the browser, like a caller would. Tweak the prompt until it sounds right.",
    },
    {
      target: "receptionist-bookings",
      title: "It books meetings too",
      body: "Paste a free Cal.com link (no API key needed) and the AI books callers straight onto your calendar mid-call, with a confirmation email.",
    },
    {
      target: "receptionist-buy-number",
      title: "Go live 🎉",
      body: "Buy a phone number and connect it — from then on the AI answers for real. Every call shows up below with its transcript and summary.",
    },
  ],
};

export const QUALIFIER_TOUR: TourDefinition = {
  id: "qualifier",
  steps: [
    {
      title: "AI Cold Calling",
      body: "The AI calls your leads, asks your qualification questions, and tells you exactly who is worth your time — in your cloned voice if you like.",
    },
    {
      target: "qualifier-new",
      title: "Create a qualifier",
      body: "Pick leads (from Find Leads or a CSV), write your questions, choose the voice and caller name, and launch. Calls bill per second in credits.",
    },
    {
      title: "Then read the verdicts 🎯",
      body: "Each campaign lists every call with its transcript and outcome, so you only spend your own time on the leads that qualified.",
    },
  ],
};

export const VOICES_TOUR: TourDefinition = {
  id: "voices",
  steps: [
    {
      title: "Clone Your Voice",
      body: "Record once, use it everywhere — the receptionist, cold calling and Instagram voice notes can all speak as you.",
    },
    {
      target: "voices-clone",
      title: "15 seconds is all it takes",
      body: "Hit this, read the prompt naturally for about 15 seconds, and your clone appears in every voice dropdown across the platform. You get 10 slots.",
    },
    {
      target: "voices-owned",
      title: "Your clones live here",
      body: "Play previews with a shared test line so you can compare engines fairly, and delete the ones you don't need.",
    },
    {
      title: "Plus a studio library 🎙️",
      body: "Below your clones: 200+ curated studio voices, all previewable and usable anywhere a voice dropdown appears.",
    },
  ],
};

export const IG_DMS_TOUR: TourDefinition = {
  id: "ig-dms",
  steps: [
    {
      title: "IG DMs & AI Voice",
      body: "Every Instagram DM in one inbox — with AI triage, a copilot that writes in your tone, and voice notes in your cloned voice.",
    },
    {
      target: "igdms-enable",
      title: "Switch it on",
      body: "Enable the feature, then connect your Instagram — a Professional account linked to a Facebook Page, one Meta authorization click. No other setup.",
    },
    {
      title: "Then it's one inbox 📥",
      body: "Conversations on the left, chat on the right. AI sorts hot / warm / cold, drafts replies you approve, can run on autopilot with guardrails — and sends voice notes that sound like you.",
    },
  ],
};

export const NOTE_TAKER_TOUR: TourDefinition = {
  id: "note-taker",
  steps: [
    {
      title: "Never take notes again",
      body: "A bot joins your Zoom, Google Meet or Teams call, records, and writes the notes — summary, decisions, action items, follow-up email.",
    },
    {
      target: "notetaker-record",
      title: "Record a meeting",
      body: "Paste the invite link and the bot joins now or at a set time. For Zoom, use “Copy invite link” so the link has its passcode (?pwd=…).",
    },
    {
      title: "Minutes after the call ✍️",
      body: "The write-up lands here: summary, decisions, action items filed to Trello or Asana automatically, a searchable transcript, and an “ask this meeting” chat.",
    },
    {
      target: "notetaker-search",
      title: "Find anything ever said",
      body: "Search every meeting — titles, notes, and the actual words spoken, with a jump to the exact moment.",
    },
    {
      target: "notetaker-tab-coach",
      title: "One more thing",
      body: "See the live meeting coach.",
      advance: "click",
    },
    {
      title: "The Agenda Coach 🧭",
      body: "Set an agenda with minute budgets. During the call it flags drift and overruns, nudges the meeting chat, and can even show a live agenda card as the bot's camera.",
    },
  ],
};

export const CREATE_TOUR: TourDefinition = {
  id: "create",
  steps: [
    {
      title: "Create with AI",
      body: "One place for images, video, motion control and Higgsfield Studio — 20+ models, one credit balance, every price shown before you render.",
    },
    {
      target: "create-tab-hub",
      title: "The AI Hub",
      body: "Just chat: describe what you want, attach reference images if you have them. The AI picks the right model, shows a plan with the exact price, and renders only after you tap Run.",
    },
    {
      target: "create-tab-image",
      title: "Want manual control?",
      body: "Click Image to see the advanced tabs.",
      advance: "click",
    },
    {
      title: "Every knob, every model 🎛️",
      body: "Image, Video, Motion and Studio tabs give you full manual control — model, size, duration, references. Same credit pricing per generation.",
    },
    {
      target: "create-tab-library",
      title: "Your renders",
      body: "Click Library.",
      advance: "click",
    },
    {
      title: "Everything you make lives here",
      body: "Download, copy the link, or reuse the prompt. Renders are kept for you — nothing disappears.",
    },
  ],
};

export const REFERRALS_TOUR: TourDefinition = {
  id: "referrals",
  steps: [
    {
      title: "Earn 15% for life",
      body: "Share your link — when someone subscribes, 15% of every payment they ever make is yours, for as long as they stay.",
    },
    {
      target: "referrals-copy",
      title: "Copy your link",
      body: "This is your personal referral link. Drop it in your bio, DMs, or anywhere your audience is.",
    },
    {
      title: "Watch it add up",
      body: "Sign-ups, active referrals, each renewal and your payouts are all tracked below in real time.",
    },
  ],
};

export const SETTINGS_TOUR: TourDefinition = {
  id: "settings",
  steps: [
    {
      target: "settings-tab-billing",
      title: "Plan & Credits",
      body: "Your plan, credit balance and full credit history live here — upgrade or top up any time.",
    },
    {
      target: "settings-tab-account",
      title: "Your account",
      body: "Click Account.",
      advance: "click",
    },
    {
      title: "Profile & access",
      body: "Your profile, workspace details, and the invite code entry for Creatily Onboarding Forms.",
    },
    {
      target: "settings-tab-integrations",
      title: "Connect your tools",
      body: "Click Integrations.",
      advance: "click",
    },
    {
      title: "Tasks, filed for you ✅",
      body: "Connect Trello, Asana or a webhook — after every meeting, the AI Note Taker files the action items there as tasks automatically.",
    },
  ],
};

export const GET_FOUND_TOUR: TourDefinition = {
  id: "get-found",
  steps: [
    {
      title: "Get Found by AI",
      body: "Customers ask ChatGPT and Google who to buy from. This audits what the AI assistants actually say about your business — and who they recommend instead.",
    },
    {
      target: "getfound-run",
      title: "Run your audit",
      body: "Enter your website — or just describe the business — add any context, and run. The AI checks how assistants see you, your visibility gaps, and your competitors.",
    },
    {
      title: "Then get it fixed 🔧",
      body: "The audit lands below with findings and fixes, and every audit is saved. Want the issues handled for you? Hit “Request a quote” on the result and our team takes it from there.",
    },
  ],
};

export const CAROUSELS_TOUR: TourDefinition = {
  id: "carousels",
  steps: [
    {
      title: "IG Carousels",
      body: "Scroll-stopping Instagram carousels — pick a design, the AI writes the slides, you export ready-to-post PNGs.",
    },
    {
      target: "carousels-run",
      title: "Pick a style, give it a topic",
      body: "Choose a design template above, drop in your topic, handle and colors, then run. Writing the slides is free — credits are only charged when the designs render.",
    },
    {
      title: "Edit anything, then download 📲",
      body: "Review the slides first and click any line of text to rewrite it. When you like it, render and download the PNGs — sized for Instagram.",
    },
  ],
};

export const TRANSCRIBE_TOUR: TourDefinition = {
  id: "audio-to-text",
  steps: [
    {
      title: "Audio to Text",
      body: "Turn any audio into a transcript — links or uploads, saved forever.",
    },
    {
      target: "transcribe-link",
      title: "Paste a link",
      body: "YouTube, Instagram, TikTok or a direct audio URL, then hit Transcribe. YouTube links use the video's own captions — if a video has none, upload the audio instead.",
    },
    {
      target: "transcribe-upload",
      title: "Or upload a file",
      body: "Any audio file (or an mp4) straight from your device.",
    },
    {
      title: "Saved forever 📝",
      body: "Every transcript lands below and stays there — open one any time to copy or reuse it.",
    },
  ],
};

export const OUTREACH_TOUR: TourDefinition = {
  id: "outreach",
  steps: [
    {
      title: "Welcome to Outreach",
      body: "This is your cold-email engine: sending inboxes, campaigns that run themselves, and one inbox for every reply. The tour takes about a minute.",
    },
    {
      target: "outreach-add-inboxes",
      title: "Add sending inboxes",
      body: "Everything starts here. Buy prewarmed domains from us, connect Gmail or Outlook, use any provider over IMAP, or bulk-import a CSV. Warmed inboxes keep your emails out of spam.",
    },
    {
      target: "outreach-tab-campaigns",
      title: "Now the campaigns",
      body: "This is where the sending happens.",
      advance: "click",
    },
    {
      target: "outreach-new-campaign",
      title: "Create a campaign",
      body: "The wizard walks you through it: import leads, write the sequence with A/B variations, set the schedule, pick which inboxes send, then publish. From there the emails send themselves.",
    },
    {
      target: "outreach-tab-master-inbox",
      title: "Where replies land",
      body: "See what happens when people write back.",
      advance: "click",
    },
    {
      title: "One inbox for every reply",
      body: "Replies from all your sending inboxes land here together. AI drafts an answer in your tone — approve it, tweak it, or write your own.",
    },
    {
      target: "outreach-tab-analytics",
      title: "Check the numbers",
      body: "See how your campaigns perform.",
      advance: "click",
    },
    {
      title: "Know what's working",
      body: "Opens, replies and bounces per campaign, plus the health of every sending inbox — so you know what to scale and what to fix.",
    },
    {
      target: "outreach-tab-settings",
      title: "One last stop",
      body: "A couple of switches worth knowing.",
      advance: "click",
    },
    {
      title: "You're ready 🎉",
      body: "Here you can auto-forward positive replies to your real email and set domain redirects. That's the whole loop: add inboxes → publish a campaign → answer replies in the Master Inbox. Start by adding your first inboxes.",
    },
  ],
};

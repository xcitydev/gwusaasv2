/**
 * Company facts used by the legal pages, the sign-up clickwrap and the
 * CAN-SPAM footer. Fill in every "[…]" placeholder before launch — the pages
 * render them verbatim. Bump TERMS_VERSION whenever the Terms or Privacy
 * Policy change materially: signed-in users who accepted an older version
 * are asked to accept again.
 */
import { BRAND } from "./brand";

export const LEGAL = {
  /** Registered legal entity that operates the service. */
  companyName: "[COMPANY LEGAL NAME]",
  /** Trading name shown to users. */
  productName: BRAND.fullName,
  /** Full postal address (also required in our own marketing emails). */
  postalAddress: "[STREET ADDRESS, CITY, STATE ZIP, COUNTRY]",
  /** US state whose law governs the Terms and where arbitration is seated. */
  governingLawState: "[STATE]",
  /** County/city for any court proceedings that escape arbitration. */
  venue: "[COUNTY], [STATE]",
  /** General legal / privacy contact. */
  contactEmail: "[legal@yourdomain.com]",
  /** Privacy requests (access, deletion, opt-out). Can equal contactEmail. */
  privacyEmail: "[privacy@yourdomain.com]",
  /** Abuse, takedown and AI-content reports. */
  abuseEmail: "[abuse@yourdomain.com]",
  /** Public site origin, used in printed links. */
  siteUrl: "[https://yourdomain.com]",
} as const;

/** Stored on users.termsVersion when they accept. Date-shaped for humans. */
export const TERMS_VERSION = "2026-10-28";
/** Shown as "Last updated" on every legal page. */
export const LEGAL_UPDATED = "October 28, 2026";

export const LEGAL_LINKS = {
  privacy: "/privacy",
  terms: "/terms",
  acceptableUse: "/acceptable-use",
  optOut: "/opt-out",
  credits: "/terms#credits",
  referrals: "/terms#referrals",
  cancel: "/terms#subscriptions",
} as const;

/**
 * Where a subscriber manages or cancels their membership. Whop hosts the
 * billing portal for every customer; the link opens their own memberships.
 */
export const WHOP_MANAGE_URL = "https://whop.com/@me/settings/memberships/";

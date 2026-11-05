/**
 * Single place to edit platform branding.
 */
export const BRAND = {
  name: "Creatily",
  fullName: "Creatily.ai",
  tagline: "Your full service, done for you.",
  /** creatily.ai artwork (public/brand): transparent PNGs keyed from the logo files. */
  logo: {
    /** Bars inside the glowing ring, square. */
    mark: "/brand/creatily-mark.png",
    /** Bars + "creatily.ai", 867×192. */
    wordmark: "/brand/creatily-wordmark.png",
    /** Cache-busted blue artwork for the landing header and SaaS shell. */
    headerWordmark: "/brand/creatily-wordmark-header-blue.png",
    /** Wordmark with the "by Grow With Us Agency" byline, 867×246. */
    wordmarkFull: "/brand/creatily-wordmark-full.png",
    /** Cache-busted blue artwork for the landing footer. */
    footerWordmarkFull: "/brand/creatily-wordmark-full-footer-blue.png",
    /** Bars only, 232×192. */
    bars: "/brand/creatily-bars.png",
  },
} as const;

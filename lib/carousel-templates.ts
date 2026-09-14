/**
 * Carousel template library.
 *
 * A template is a full design system: fonts, palette, and an art-direction
 * brief for the AI background images. The image model paints ONLY the
 * cinematic scene (no text — models butcher typography); the slide renderer
 * overlays real, razor-sharp type on top and exports 1080×1350 PNGs.
 *
 * The sentinel id "ai-art" is NOT in this list — it's the classic mode where
 * Ideogram draws the whole slide including the text.
 */

export type CarouselDeckSlide = {
  type: string; // cover | point | stat | quote | cta
  kicker?: string;
  headline?: string;
  dek?: string;
  items?: { title: string; body: string }[];
  stat?: string;
  statLabel?: string;
  quote?: string;
  attribution?: string;
  keyword?: string;
  keywordLabel?: string;
  cta?: string;
  imagePrompt: string;
  bgUrl?: string;
};

export type CarouselTemplate = {
  id: string;
  name: string;
  tagline: string;
  /** Google Fonts stylesheet for this template */
  fontsUrl: string;
  display: {
    family: string;
    weight: number;
    transform: "uppercase" | "none";
    letterSpacing: string;
    /** multiplier on the base headline size (condensed fonts run bigger) */
    sizeFactor: number;
  };
  bodyFamily: string;
  monoFamily: string;
  /** dark slide (black gradient + light text) vs light (cream gradient + ink text) */
  dark: boolean;
  colors: {
    ink: string; // slide background
    surface: string;
    line: string;
    text: string; // primary copy color
    muted: string;
    accent: string;
    accentBright: string; // headline highlight
    accentDeep: string;
    accent2: string; // rare second accent
  };
  /** appended to every background-image prompt for a consistent world */
  artDirection: string;
  /** fal image model used for the backgrounds */
  bgModelId: string;
};

export const CLASSIC_TEMPLATE_ID = "ai-art";

export const CAROUSEL_TEMPLATES: CarouselTemplate[] = [
  {
    id: "gold-editorial",
    name: "Gold Editorial",
    tagline: "Cinematic dark scenes, molten gold, poster type",
    fontsUrl:
      "https://fonts.googleapis.com/css2?family=Anton&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap",
    display: {
      family: '"Anton","Arial Narrow",Impact,sans-serif',
      weight: 400,
      transform: "uppercase",
      letterSpacing: "0.005em",
      sizeFactor: 1,
    },
    bodyFamily: '"Inter",-apple-system,"Segoe UI",sans-serif',
    monoFamily: '"JetBrains Mono",ui-monospace,Consolas,monospace',
    dark: true,
    colors: {
      ink: "#08080A",
      surface: "#1A171D",
      line: "#2A2530",
      text: "#F2EDE3",
      muted: "#A39D96",
      accent: "#E3B341",
      accentBright: "#FFD979",
      accentDeep: "#8E6A1C",
      accent2: "#7FD4E8",
    },
    artDirection:
      "cinematic 3D render, dark moody industrial-fantasy scene, deep teal " +
      "shadows with warm golden light, glowing molten-gold elements, floating " +
      "embers and sparks, volumetric fog, photorealistic detail, dramatic rim lighting",
    bgModelId: "flux-pro-1.1",
  },
  {
    id: "neon-grid",
    name: "Neon Grid",
    tagline: "Electric cyan-violet tech, glossy and futuristic",
    fontsUrl:
      "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap",
    display: {
      family: '"Space Grotesk","Inter",sans-serif',
      weight: 700,
      transform: "uppercase",
      letterSpacing: "-0.01em",
      sizeFactor: 0.86,
    },
    bodyFamily: '"Inter",-apple-system,"Segoe UI",sans-serif',
    monoFamily: '"JetBrains Mono",ui-monospace,Consolas,monospace',
    dark: true,
    colors: {
      ink: "#060810",
      surface: "#10141F",
      line: "#1E2433",
      text: "#EDF2FA",
      muted: "#8B96AE",
      accent: "#22D3EE",
      accentBright: "#7DF3FF",
      accentDeep: "#0E7490",
      accent2: "#C084FC",
    },
    artDirection:
      "sleek futuristic cinematic 3D render, deep navy-black environment lit " +
      "by electric cyan and violet neon, glossy wet reflections, holographic " +
      "light trails, thin glowing grid lines, volumetric haze, high contrast",
    bgModelId: "flux-pro-1.1",
  },
  {
    id: "paper-press",
    name: "Paper Press",
    tagline: "Bright editorial, cream paper, terracotta pop",
    fontsUrl:
      "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap",
    display: {
      family: '"Archivo Black",Impact,sans-serif',
      weight: 400,
      transform: "uppercase",
      letterSpacing: "-0.005em",
      sizeFactor: 0.76,
    },
    bodyFamily: '"Inter",-apple-system,"Segoe UI",sans-serif',
    monoFamily: '"JetBrains Mono",ui-monospace,Consolas,monospace',
    dark: false,
    colors: {
      ink: "#F4EFE6",
      surface: "#EAE3D4",
      line: "#D9D0BC",
      text: "#17140E",
      muted: "#6E675B",
      accent: "#D6482B",
      accentBright: "#C2401F",
      accentDeep: "#8C2C17",
      accent2: "#1F6F5C",
    },
    artDirection:
      "warm editorial still-life photography on a cream paper background, " +
      "terracotta and burnt-orange props, soft daylight, gentle shadows, " +
      "minimalist art direction, bright airy negative space, matte textures",
    bgModelId: "flux-pro-1.1",
  },
  {
    id: "onyx-luxe",
    name: "Onyx Luxe",
    tagline: "Black silk, champagne gold, serif elegance",
    fontsUrl:
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&family=JetBrains+Mono:wght@400;500;700&display=swap",
    display: {
      family: '"Playfair Display",Georgia,serif',
      weight: 900,
      transform: "uppercase",
      letterSpacing: "0.01em",
      sizeFactor: 0.78,
    },
    bodyFamily: '"Inter",-apple-system,"Segoe UI",sans-serif',
    monoFamily: '"JetBrains Mono",ui-monospace,Consolas,monospace',
    dark: true,
    colors: {
      ink: "#0B0A0C",
      surface: "#171419",
      line: "#2B2530",
      text: "#F5F1E8",
      muted: "#A79E92",
      accent: "#D9BD8E",
      accentBright: "#F1DFB4",
      accentDeep: "#8A7444",
      accent2: "#C9A9B4",
    },
    artDirection:
      "ultra-luxury macro photography, black silk fabric and dark marble, " +
      "champagne-gold objects and liquid gold accents, soft cinematic studio " +
      "light, shallow depth of field, rich shadows, elegant minimal composition",
    bgModelId: "flux-pro-1.1",
  },
];

export function findCarouselTemplate(
  id: string | undefined,
): CarouselTemplate | undefined {
  return CAROUSEL_TEMPLATES.find((t) => t.id === id);
}

/** The token fields an admin-curated template stores (Convex doc shape). */
export type DbCarouselTemplateFields = {
  name: string;
  tagline: string;
  fontsUrl: string;
  display: CarouselTemplate["display"];
  bodyFamily: string;
  monoFamily: string;
  dark: boolean;
  colors: CarouselTemplate["colors"];
  artDirection: string;
  bgModelId: string;
};

/** Admin templates live in the DB — their doc id doubles as the template id. */
export function dbToTemplate(
  doc: DbCarouselTemplateFields & { _id: string },
): CarouselTemplate {
  return {
    id: doc._id,
    name: doc.name,
    tagline: doc.tagline,
    fontsUrl: doc.fontsUrl,
    display: doc.display,
    bodyFamily: doc.bodyFamily,
    monoFamily: doc.monoFamily,
    dark: doc.dark,
    colors: doc.colors,
    artDirection: doc.artDirection,
    bgModelId: doc.bgModelId,
  };
}

export function hexToRgb(hex: string): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Sample cover used for the template picker previews. */
export const TEMPLATE_SAMPLE_SLIDE: CarouselDeckSlide = {
  type: "cover",
  kicker: "The playbook",
  headline: "STOP [[LOSING]]\nCUSTOMERS",
  dek: "Five quiet leaks in your funnel — and where to look first.",
  cta: "Swipe for the fixes",
  imagePrompt: "",
};

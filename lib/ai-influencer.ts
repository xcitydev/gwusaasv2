/**
 * AI Influencer trait catalog (Higgsfield `higgsfield/ai-influencer`).
 * Option ids copied from Higgsfield's option list on 2026-11-05. Human tiers
 * see every group; animal tiers see only the groups not marked humanOnly.
 */

export type InfluencerTier =
  | "normal"
  | "freak"
  | "total"
  | "insects"
  | "frogs"
  | "cats"
  | "dogs"
  | "capybaras"
  | "birds";

// Animal tiers also need an "animal_variant" object we haven't mapped yet,
// so only the three human tiers are offered for now.
export const INFLUENCER_TIERS: { value: InfluencerTier; label: string; human: boolean }[] = [
  { value: "normal", label: "Natural", human: true },
  { value: "freak", label: "Bold", human: true },
  { value: "total", label: "Extreme", human: true },
];

export type InfluencerGroup = {
  id: string;
  label: string;
  max: number;
  humanOnly?: boolean;
  options: [id: string, label: string][];
};

export const INFLUENCER_GROUPS: InfluencerGroup[] = [
  {
    id: "gender",
    label: "Gender",
    max: 1,
    options: [
      ["female", "Female"],
      ["male", "Male"],
      ["trans_man", "Trans man"],
      ["trans_woman", "Trans woman"],
      ["non_binary", "Non-binary"],
    ],
  },
  {
    id: "ethnicity_origin_base",
    label: "Ethnicity",
    max: 1,
    humanOnly: true,
    options: [
      ["african", "African"],
      ["east_asian", "Asian"],
      ["european", "European"],
      ["indian", "Indian"],
      ["middle_eastern", "Middle Eastern"],
      ["latin_american", "Mixed"],
    ],
  },
  {
    id: "age",
    label: "Age",
    max: 1,
    humanOnly: true,
    options: [
      ["adult", "Adult"],
      ["mature", "Mature"],
      ["senior", "Senior"],
    ],
  },
  {
    id: "skin_tone",
    label: "Skin color",
    max: 1,
    humanOnly: true,
    options: [
      ["st_porcelain", "Porcelain"],
      ["st_fair", "Fair"],
      ["st_light", "Light"],
      ["st_olive", "Olive"],
      ["st_tan", "Tan"],
      ["st_brown", "Brown"],
      ["st_deep", "Deep brown"],
      ["st_ebony", "Ebony"],
    ],
  },
  {
    id: "body_type",
    label: "Build",
    max: 1,
    options: [
      ["body_slim", "Slim"],
      ["body_athletic", "Athletic"],
      ["body_muscular", "Muscular"],
      ["body_curvy", "Curvy"],
      ["body_heavy", "Heavy"],
      ["body_ultra", "Ultra muscular"],
    ],
  },
  {
    id: "height",
    label: "Height",
    max: 1,
    options: [
      ["h_average", "Average"],
      ["h_tall", "Tall"],
      ["h_very_tall", "Very tall"],
    ],
  },
  {
    id: "proportions",
    label: "Proportions",
    max: 2,
    options: [
      ["pr_longlimbs", "Long limbs"],
      ["pr_shortlegs", "Short legs"],
      ["pr_shoulders", "Broad shoulders"],
      ["pr_waist", "Tiny waist"],
    ],
  },
  {
    id: "hair",
    label: "Hairstyle",
    max: 1,
    options: [
      ["hair_bald", "Bald"],
      ["hair_buzz", "Buzz cut"],
      ["hair_bowl", "Bowl cut"],
      ["hair_mullet", "Mullet"],
      ["hair_braids", "Braids"],
      ["hair_pigtails", "Pigtails"],
      ["hair_afro", "Afro"],
      ["hair_punk", "Mohawk"],
      ["hair_long", "Long hair"],
      ["hair_short", "Short hair"],
    ],
  },
  {
    id: "hair_colour",
    label: "Hair color",
    max: 1,
    options: [
      ["hc_black", "Jet black"],
      ["hc_darkbrown", "Dark brown"],
      ["hc_chestnut", "Chestnut"],
      ["hc_ginger", "Ginger"],
      ["hc_red", "Red"],
      ["hc_blonde", "Blonde"],
      ["hc_platinum", "Platinum"],
      ["hc_grey", "Grey"],
      ["hc_white", "White"],
      ["hc_pink", "Pastel pink"],
      ["hc_lilac", "Lilac"],
      ["hc_blue", "Blue"],
      ["hc_green", "Green"],
    ],
  },
  {
    id: "facial_hair",
    label: "Facial hair",
    max: 1,
    options: [
      ["fh_none", "Clean"],
      ["fh_stubble", "Stubble"],
      ["fh_beard", "Full beard"],
      ["fh_goatee", "Goatee"],
      ["fh_moustache", "Moustache"],
      ["fh_pencil", "Pencil"],
    ],
  },
  {
    id: "freak_head",
    label: "Head shape",
    max: 1,
    humanOnly: true,
    options: [
      ["head_oval", "Standard"],
      ["head_long", "Long"],
      ["head_round", "Round"],
      ["head_square", "Square"],
      ["head_heart", "Heart"],
    ],
  },
  {
    id: "freak_neck",
    label: "Neck",
    max: 1,
    humanOnly: true,
    options: [
      ["neck_normal", "Standard"],
      ["neck_short", "Short"],
    ],
  },
  {
    id: "eye_shape",
    label: "Eye shape",
    max: 1,
    humanOnly: true,
    options: [
      ["es_almond", "Almond"],
      ["es_round", "Round"],
      ["es_monolid", "Monolid"],
      ["es_large", "Large"],
      ["es_hooded", "Hooded"],
      ["es_upturned", "Upturned"],
      ["es_downturned", "Downturned"],
    ],
  },
  {
    id: "eye_color",
    label: "Eye color",
    max: 1,
    humanOnly: true,
    options: [
      ["eye_black", "Black"],
      ["eye_brown", "Brown"],
      ["eye_hazel", "Hazel"],
      ["eye_green", "Green"],
      ["eye_blue", "Blue"],
      ["eye_ice_blue", "Ice blue"],
      ["eye_amber", "Amber"],
      ["eye_grey", "Grey"],
    ],
  },
  {
    id: "freak_face",
    label: "Facial features",
    max: 4,
    humanOnly: true,
    options: [
      ["fn_freckles", "Freckles"],
      ["fn_dimples", "Dimples"],
      ["fn_eyebags", "Heavy eye bags"],
      ["fn_cheekbones", "High cheekbones"],
      ["fn_fulllips", "Full lips"],
      ["fn_thickbrows", "Thick brows"],
      ["fn_mole", "Beauty mark"],
      ["fn_tinynose", "Tiny nose"],
      ["fn_widemouth", "Wide mouth"],
      ["fn_pointychin", "Pointy chin"],
    ],
  },
  {
    id: "distinctive",
    label: "Distinctive features",
    max: 2,
    options: [
      ["df_hetero", "Odd eyes"],
      ["df_facetattoo", "Face tattoo"],
      ["df_septum", "Piercing"],
      ["df_ears", "Ear piercing"],
      ["df_slits", "Brow slits"],
      ["df_bleached", "Bleached"],
      ["df_nobrows", "No brows"],
      ["df_grill", "Gold grill"],
      ["df_braces", "Braces"],
      ["df_scar", "Brow scar"],
      ["df_gems", "Face gems"],
      ["df_elf", "Elf ears"],
      ["df_lashes", "Big lashes"],
      ["df_bandage", "Nose tape"],
    ],
  },
  {
    id: "aesthetic",
    label: "Style",
    max: 1,
    options: [
      ["retro", "Retro"],
      ["sporty", "Sporty"],
      ["y2k", "Y2K"],
      ["theatrical", "Theatre"],
      ["goth", "Goth"],
      ["suits", "Suits"],
      ["streetstyle", "Streetstyle"],
      ["casual", "Casual"],
    ],
  },
  {
    id: "accessory",
    label: "Accessories",
    max: 3,
    options: [
      ["acc_none", "None"],
      ["acc_glasses", "Glasses"],
      ["acc_headphones", "Headphones"],
      ["acc_jewelry", "Jewelry"],
      ["acc_hat", "Hat"],
      ["acc_bag", "Bag"],
    ],
  },
];

export function isHumanTier(tier: InfluencerTier): boolean {
  return INFLUENCER_TIERS.find((t) => t.value === tier)?.human ?? true;
}

export function groupsForTier(tier: InfluencerTier): InfluencerGroup[] {
  const human = isHumanTier(tier);
  return INFLUENCER_GROUPS.filter((g) => human || !g.humanOnly);
}

/** Keeps only known option ids, per-group caps, and groups valid for the tier. */
export function cleanSelection(
  tier: InfluencerTier,
  raw: Record<string, unknown>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const group of groupsForTier(tier)) {
    const value = raw[group.id];
    const picked = (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === "string")
      .filter((v) => group.options.some(([id]) => id === v))
      .slice(0, group.max);
    if (picked.length) out[group.id] = picked;
  }
  return out;
}

export const INFLUENCER_PATH = "/higgsfield/ai-influencer";
/** Higgsfield list price per sheet (docs: $0.05). */
export const INFLUENCER_LIST_USD = 0.05;

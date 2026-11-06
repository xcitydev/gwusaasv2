"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LayoutTemplate, Loader2, Megaphone, Package, ShoppingBag, Sofa, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { StudioTab, chipClass } from "./studio-tab";

type Preset = { id: string; name: string; group: string; aspectRatio?: string; coverUrl?: string };

/**
 * Workflows = recipes that run several steps for you. Ad presets and Ads
 * Studio are Higgsfield's own; the three product recipes are ours, built on
 * Marketing Studio Image with a fixed art direction and prompt enhancement.
 */
const MODES = [
  {
    id: "presets",
    label: "Ad presets",
    icon: LayoutTemplate,
    blurb: "Pick a proven ad layout, add your product photo, describe it — the preset handles the design.",
    model: "marketing-studio-image",
  },
  {
    id: "ads-studio",
    label: "Ads Studio",
    icon: Megaphone,
    blurb: "Write a short brief (product, offer, audience) and get up to 8 ad concepts in one go.",
    model: "ads-studio",
  },
  {
    id: "product",
    label: "Product shot",
    icon: Package,
    blurb: "Hero shots for your site or ads from one product photo.",
    model: "marketing-studio-image",
    recipe:
      "Professional studio product photograph of the product in the reference image, hero composition, clean seamless backdrop, soft key light with crisp shadows, label clearly readable, commercial catalogue quality",
  },
  {
    id: "marketplace",
    label: "Marketplace listing",
    icon: ShoppingBag,
    blurb: "Clean listing images for Amazon, Shopify or Etsy.",
    model: "marketing-studio-image",
    recipe:
      "E-commerce marketplace listing photo of the product in the reference image on a pure white background, centered, evenly lit, true-to-life colours, no props, no text, sharp focus",
  },
  {
    id: "lifestyle",
    label: "Lifestyle",
    icon: Sofa,
    blurb: "Your product in a real-life scene that sells the feeling.",
    model: "marketing-studio-image",
    recipe:
      "Lifestyle advertising photo showing the product from the reference image in natural use in a real, aspirational setting, natural light, shallow depth of field, authentic and warm",
  },
] as const;

type ModeId = (typeof MODES)[number]["id"];

function PresetPicker({
  presets,
  loading,
  value,
  onChange,
}: {
  presets: Preset[];
  loading: boolean;
  value: Preset | null;
  onChange: (preset: Preset | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => [...new Set(presets.map((p) => p.group))], [presets]);
  const [group, setGroup] = useState<string | null>(null);
  const shown = group ? presets.filter((p) => p.group === group) : presets;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={chipClass}>
            {value?.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.coverUrl} alt="" className="size-5 rounded object-cover" />
            ) : (
              <LayoutTemplate className="size-3.5" />
            )}
            {value ? value.name : loading ? "Loading presets…" : "Choose an ad preset"}
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[min(44rem,calc(100vw-2rem))] p-3">
          <div className="flex flex-wrap gap-1">
            {[null, ...groups].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                onClick={() => setGroup(g)}
                className={cn(
                  "rounded-md border px-2 py-1 text-xs transition-colors",
                  group === g ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {g ?? "All"}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
          ) : (
            <div className="grid max-h-[min(28rem,55dvh)] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-5">
              {shown.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onChange(p);
                    setOpen(false);
                  }}
                  className={cn(
                    "group overflow-hidden rounded-lg border text-left transition-colors",
                    value?.id === p.id ? "border-primary" : "border-border hover:border-primary/50",
                  )}
                >
                  {p.coverUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.coverUrl} alt={p.name} loading="lazy" className="aspect-[3/4] w-full object-cover" />
                  )}
                  <span className="block truncate px-1.5 py-1 text-[11px]">{p.name}</span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {value && (
        <button type="button" className={cn(chipClass, "px-2.5")} onClick={() => onChange(null)} aria-label="Clear preset">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function AdsTab() {
  const [mode, setMode] = useState<ModeId>("presets");
  const current = MODES.find((m) => m.id === mode)!;
  const listPresets = useAction(api.studioActions.marketingPresets);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [preset, setPreset] = useState<Preset | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPresets({})
      .then((items) => {
        if (!cancelled) setPresets(items);
      })
      .catch(() => {
        // The picker just stays empty; the other modes still work.
      })
      .finally(() => {
        if (!cancelled) setLoadingPresets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listPresets]);

  const extraOptions = useMemo(() => {
    if (current.model !== "marketing-studio-image") return undefined;
    // A preset applies through prompt enhancement at high quality; the API
    // rejects enhancement without a preset, so the recipes send it off.
    const withPreset = mode === "presets" && preset;
    return {
      quality: "high",
      enhance_prompt: Boolean(withPreset),
      ...(withPreset ? { preset_id: preset.id } : {}),
    };
  }, [current.model, mode, preset]);

  const top = (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto pb-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={cn(
              chipClass,
              mode === m.id && "border-primary/50 bg-primary/15 text-primary hover:bg-primary/20",
            )}
          >
            <m.icon className="size-3.5" /> {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{current.blurb}</p>
      {mode === "presets" && (
        <PresetPicker presets={presets} loading={loadingPresets} value={preset} onChange={setPreset} />
      )}
    </div>
  );

  return (
    <StudioTab
      // Remount per mode so each recipe starts from its own defaults.
      key={mode}
      models={["marketing-studio-image", "ads-studio"].filter((id) => id === current.model)}
      extraOptions={extraOptions}
      promptSuffix={"recipe" in current ? current.recipe : undefined}
      composerTop={top}
      placeholder={
        mode === "ads-studio"
          ? "Your brief — product, offer and message, e.g. 'Vitamin C serum, 20% off launch week, glow in 7 days'"
          : mode === "presets"
            ? "What's the product and the message? e.g. 'Matte black water bottle, keeps drinks cold 24h'"
            : "Name the product and anything special, e.g. 'rose-gold wireless earbuds with charging case'"
      }
      emptyTitle="Your ads and product images appear here"
      emptyBody="Add your product photo with the + button, pick a mode above, and Generate."
    />
  );
}

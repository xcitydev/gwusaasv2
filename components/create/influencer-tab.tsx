"use client";

import { useMemo, useState } from "react";
import { Dices, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  INFLUENCER_TIERS,
  groupsForTier,
  type InfluencerTier,
} from "@/lib/ai-influencer";
import { cn } from "@/lib/utils";
import { StudioTab, chipClass } from "./studio-tab";

// Groups a random roll fills (the rest stay up to the model).
const RANDOM_GROUPS = [
  "gender",
  "ethnicity_origin_base",
  "age",
  "skin_tone",
  "body_type",
  "hair",
  "hair_colour",
  "eye_color",
  "aesthetic",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * AI Influencer: pick traits (or upload a face), describe extras, and get a
 * character sheet. Runs on the shared Studio composer, limited to this model.
 */
export function InfluencerTab() {
  const [tier, setTier] = useState<InfluencerTier>("normal");
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const groups = groupsForTier(tier);

  const toggle = (groupId: string, optionId: string, max: number) =>
    setSelection((current) => {
      const picked = current[groupId] ?? [];
      let next: string[];
      if (picked.includes(optionId)) next = picked.filter((id) => id !== optionId);
      else if (max === 1) next = [optionId];
      else if (picked.length >= max) next = [...picked.slice(1), optionId];
      else next = [...picked, optionId];
      const copy = { ...current };
      if (next.length) copy[groupId] = next;
      else delete copy[groupId];
      return copy;
    });

  const randomize = () => {
    const next: Record<string, string[]> = {};
    for (const group of groups) {
      if (RANDOM_GROUPS.includes(group.id)) next[group.id] = [pick(group.options)[0]];
    }
    setSelection(next);
  };

  const chosen = useMemo(
    () =>
      groups.flatMap((group) =>
        (selection[group.id] ?? []).map((id) => ({
          groupId: group.id,
          id,
          label: group.options.find(([o]) => o === id)?.[1] ?? id,
          max: group.max,
        })),
      ),
    [groups, selection],
  );

  const extraOptions = useMemo(() => ({ tier, selection }), [tier, selection]);

  const traitsBar = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="inline-flex h-9 items-center rounded-lg border border-border bg-secondary/50 p-0.5" role="radiogroup" aria-label="Look">
          {INFLUENCER_TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={tier === t.value}
              onClick={() => setTier(t.value)}
              className={cn(
                "h-full rounded-md px-3 text-sm transition-colors",
                tier === t.value
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className={chipClass}>
              <SlidersHorizontal className="size-3.5" /> Traits
              {chosen.length > 0 && (
                <span className="rounded-full bg-primary/20 px-1.5 text-[11px] text-primary">{chosen.length}</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-[min(36rem,calc(100vw-2rem))] p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Pick what you want — leave a group empty and the AI decides.</p>
              {chosen.length > 0 && (
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelection({})}>
                  Clear all
                </button>
              )}
            </div>
            <div className="max-h-[min(30rem,60dvh)] space-y-3 overflow-y-auto pr-1">
              {groups.map((group) => (
                <div key={group.id}>
                  <p className="mb-1.5 text-xs font-medium">
                    {group.label}
                    {group.max > 1 && <span className="ml-1 font-normal text-muted-foreground">(up to {group.max})</span>}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {group.options.map(([id, label]) => {
                      const selected = (selection[group.id] ?? []).includes(id);
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggle(group.id, id, group.max)}
                          aria-pressed={selected}
                          className={cn(
                            "rounded-md border px-2 py-1 text-xs transition-colors",
                            selected
                              ? "border-primary/50 bg-primary/15 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <button type="button" className={chipClass} onClick={randomize}>
          <Dices className="size-3.5" /> Randomize
        </button>
        {chosen.length > 0 && (
          <button type="button" className={cn(chipClass, "px-2.5")} onClick={() => setSelection({})} aria-label="Clear traits" title="Clear traits">
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chosen.map((c) => (
            <span key={`${c.groupId}:${c.id}`} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] text-primary">
              {c.label}
              <button type="button" onClick={() => toggle(c.groupId, c.id, c.max)} aria-label={`Remove ${c.label}`} className="rounded-full p-0.5 hover:bg-primary/20">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <StudioTab
      models={["ai-influencer"]}
      extraOptions={extraOptions}
      composerTop={traitsBar}
      placeholder="Anything else? e.g. 'fitness coach, warm smile, wears gold hoops' (optional)"
      emptyTitle="Your AI influencers appear here"
      emptyBody="Pick traits or hit Randomize, add a photo if you want to base it on someone, then Generate. Save the ones you like as Elements, then type @ in any prompt to reuse them."
    />
  );
}


"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AUTO_JOIN_MODES, type AutoJoinMode } from "@/lib/note-taker";

const ORDER: AutoJoinMode[] = ["hosting", "all", "manual"];

/** Which calendar meetings the bot joins on its own (Read-style radios). */
export function AutoJoinPicker({
  value,
  onChange,
  idPrefix = "nt-autojoin",
}: {
  value: AutoJoinMode;
  onChange: (value: AutoJoinMode) => void;
  idPrefix?: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as AutoJoinMode)}
      className="gap-2"
    >
      {ORDER.map((mode) => (
        <Label
          key={mode}
          htmlFor={`${idPrefix}-${mode}`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-primary/5"
        >
          <RadioGroupItem id={`${idPrefix}-${mode}`} value={mode} className="mt-0.5" />
          <span className="space-y-0.5 text-left">
            <span className="block text-sm font-medium">
              {AUTO_JOIN_MODES[mode].label}
              {mode === "hosting" && (
                <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  Recommended
                </span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground">
              {AUTO_JOIN_MODES[mode].hint}
            </span>
          </span>
        </Label>
      ))}
    </RadioGroup>
  );
}

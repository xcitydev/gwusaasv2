"use client";

import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { MapPin, Package, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type MentionElement = {
  id: string;
  handle: string;
  name: string;
  imageUrl: string;
  kind: "character" | "location" | "prop";
  trained?: boolean;
  /** Trained (Soul ID) characters: picked as a face on matching Soul models. */
  soulRefId?: string;
  soulVersion?: "v1" | "v2" | "cinema";
  description?: string;
  /** More angles, attached alongside the main image when the model has room. */
  extraImageUrls?: string[];
};

const KIND_ICON = { character: UserRound, location: MapPin, prop: Package } as const;

/** Every @handle in the text that matches a saved element, in order of first use. */
export function findMentions(text: string, elements: MentionElement[]): MentionElement[] {
  const byHandle = new Map(elements.map((e) => [e.handle.toLowerCase(), e]));
  const seen = new Set<string>();
  const out: MentionElement[] = [];
  for (const match of text.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) {
    const el = byHandle.get(match[1].toLowerCase());
    if (el && !seen.has(el.id)) {
      seen.add(el.id);
      out.push(el);
    }
  }
  return out;
}

/** The "@partial" right before the caret, if the user is typing a mention. */
function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|\s)@([a-z0-9_-]*)$/i);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2].toLowerCase() };
}

const SHARED =
  "w-full whitespace-pre-wrap break-words px-1 py-1 text-base md:text-sm leading-relaxed";

/**
 * A prompt box where typing @ lists your saved elements. Picking one writes
 * @handle (highlighted) and tells the composer to attach its image.
 */
export const MentionTextarea = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (next: string) => void;
    elements: MentionElement[];
    onMention: (element: MentionElement) => void;
    onSubmit?: () => void;
    placeholder?: string;
  }
>(function MentionTextarea({ value, onChange, elements, onMention, onSubmit, placeholder }, ref) {
  const inner = useRef<HTMLTextAreaElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => inner.current!, []);
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    if (!query) return [];
    return elements
      .filter(
        (e) =>
          e.handle.toLowerCase().startsWith(query.query) ||
          e.name.toLowerCase().includes(query.query),
      )
      .slice(0, 8);
  }, [elements, query]);

  const known = useMemo(() => new Set(elements.map((e) => e.handle.toLowerCase())), [elements]);

  // Same text as the textarea, with known @handles wrapped so they show as chips.
  const highlighted = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const m of value.matchAll(/@([a-z0-9][a-z0-9_-]*)/gi)) {
      if (!known.has(m[1].toLowerCase())) continue;
      const at = m.index ?? 0;
      parts.push(value.slice(last, at));
      parts.push(
        <mark key={at} className="rounded bg-primary/30 text-transparent ring-1 ring-primary/40">
          {m[0]}
        </mark>,
      );
      last = at + m[0].length;
    }
    parts.push(value.slice(last));
    // A trailing newline needs a character after it to take up height.
    parts.push(" ");
    return parts;
  }, [value, known]);

  const refreshQuery = (text: string, caret: number) => {
    const q = activeQuery(text, caret);
    setQuery(q);
    setHighlight(0);
  };

  const choose = (el: MentionElement) => {
    const textarea = inner.current;
    if (!textarea || !query) return;
    const caret = textarea.selectionStart;
    const next = `${value.slice(0, query.start)}@${el.handle} ${value.slice(caret)}`;
    onChange(next);
    onMention(el);
    setQuery(null);
    const pos = query.start + el.handle.length + 2;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="relative">
      {query && (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl">
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-muted-foreground">
            {matches.length ? "Your elements" : elements.length ? "No element matches" : "No saved elements yet — save images in the Elements tab"}
          </p>
          {matches.map((el, i) => {
            const Icon = KIND_ICON[el.kind];
            return (
              <button
                key={el.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(el);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  i === highlight && "bg-muted",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={el.imageUrl} alt="" className="size-7 shrink-0 rounded-md object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">@{el.handle}</span>
                  <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    <Icon className="size-3" /> {el.name}
                    {el.trained ? " · trained" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        ref={backdrop}
        aria-hidden
        className={cn(SHARED, "pointer-events-none absolute inset-0 overflow-hidden text-transparent")}
      >
        {highlighted}
      </div>
      <textarea
        ref={inner}
        rows={2}
        value={value}
        aria-label="Prompt"
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          refreshQuery(e.target.value, e.target.selectionStart);
        }}
        onSelect={(e) => refreshQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setQuery(null)}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if (query && matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h + 1) % matches.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h - 1 + matches.length) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              choose(matches[highlight]);
              return;
            }
          }
          if (e.key === "Escape" && query) {
            setQuery(null);
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        className={cn(
          SHARED,
          "relative field-sizing-content max-h-48 min-h-14 resize-none bg-transparent outline-none placeholder:text-muted-foreground",
        )}
      />
    </div>
  );
});

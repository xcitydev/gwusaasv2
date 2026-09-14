import { cn } from "@/lib/utils";

type Turn = { speaker: "ai" | "caller" | "action"; text: string };

/**
 * Bland transcripts arrive as one string with speaker prefixes
 * ("assistant: … user: …", browser tests use "Receptionist:/Caller:").
 * Parse into turns, merging consecutive lines from the same speaker.
 */
function parseTranscript(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split(/\n+/)) {
    const match = line.match(
      /^\s*(assistant|receptionist|agent-action|agent|user|caller|human)\s*:\s*(.*)$/i,
    );
    if (!match) {
      const text = line.trim();
      if (!text) continue;
      if (turns.length > 0) turns[turns.length - 1].text += ` ${text}`;
      else turns.push({ speaker: "caller", text });
      continue;
    }
    const role = match[1].toLowerCase();
    const speaker: Turn["speaker"] =
      role === "agent-action"
        ? "action"
        : role === "user" || role === "caller" || role === "human"
          ? "caller"
          : "ai";
    const text = match[2].trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) last.text += ` ${text}`;
    else turns.push({ speaker, text });
  }
  return turns;
}

/** Chat-bubble rendering of a call transcript — AI left (gold), caller right. */
export function CallTranscript({
  transcript,
  aiLabel = "AI",
  callerLabel = "Caller",
  className,
}: {
  transcript: string;
  aiLabel?: string;
  callerLabel?: string;
  className?: string;
}) {
  const turns = parseTranscript(transcript);
  if (turns.length === 0) return null;
  return (
    <div
      className={cn(
        "max-h-[45vh] space-y-2.5 overflow-y-auto overscroll-contain rounded-lg border bg-secondary/20 p-3",
        className,
      )}
    >
      {turns.map((turn, i) =>
        turn.speaker === "action" ? (
          <p
            key={i}
            className="text-center text-[11px] italic text-muted-foreground/70"
          >
            {turn.text}
          </p>
        ) : (
          <div
            key={i}
            className={cn(
              "flex",
              turn.speaker === "ai" ? "justify-start" : "justify-end",
            )}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-xl px-3 py-2",
                turn.speaker === "ai"
                  ? "rounded-tl-sm bg-primary/10"
                  : "rounded-tr-sm bg-secondary",
              )}
            >
              <p
                className={cn(
                  "mb-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  turn.speaker === "ai"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                {turn.speaker === "ai" ? aiLabel : callerLabel}
              </p>
              <p className="text-sm leading-relaxed">{turn.text}</p>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

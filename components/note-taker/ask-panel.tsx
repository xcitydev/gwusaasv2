"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Bot, History, Loader2, MessageSquarePlus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/note-taker";
import { MEETING_TEMPLATES, isMeetingType } from "@/lib/meeting-templates";
import { ASK_PROMPTS, splitCitations, type AskScope } from "@/lib/note-ask";
import { friendlyError, whenLabel } from "./shared";

type Citation = {
  ref: string;
  meetingId: Id<"meetings">;
  title: string;
  atSec?: number;
};

function scopeKey(scope: AskScope): string {
  return scope.kind === "all" ? "all" : `${scope.kind}:${scope.id}`;
}

function scopeFromKey(key: string): AskScope {
  if (key === "all") return { kind: "all" };
  const [kind, ...rest] = key.split(":");
  return { kind: kind as "type" | "folder" | "meeting", id: rest.join(":") };
}

function citationHref(citation: Citation): string {
  return `/note-taker?meeting=${citation.meetingId}${
    citation.atSec !== undefined ? `&t=${Math.floor(citation.atSec)}` : ""
  }`;
}

/** An answer with [M3 12:04] marks turned into links to the exact moment. */
function AnswerText({
  text,
  citations,
  onNavigate,
}: {
  text: string;
  citations: Citation[];
  onNavigate?: () => void;
}) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {splitCitations(text).map((part, index) => {
        if (typeof part === "string") return <span key={index}>{part}</span>;
        const citation = byRef.get(part.ref);
        if (!citation) return null;
        return (
          <Link
            key={index}
            href={citationHref(citation)}
            onClick={onNavigate}
            title={citation.title}
            className="mx-0.5 inline-flex max-w-48 items-center gap-1 truncate rounded bg-primary/15 px-1.5 py-0.5 align-baseline text-[11px] text-primary hover:bg-primary/25"
          >
            {citation.atSec !== undefined && (
              <span className="shrink-0 font-mono">{formatClock(citation.atSec)}</span>
            )}
            <span className="truncate">{citation.title}</span>
          </Link>
        );
      })}
    </p>
  );
}

/**
 * Ask across meetings. Used in the header sheet (compact) and as the Note
 * Taker "Ask" tab. `lockedScope` pins it to one meeting / folder.
 */
export function AskPanel({
  compact = false,
  lockedScope,
  onNavigate,
}: {
  compact?: boolean;
  lockedScope?: AskScope;
  /** Called when a citation link is followed (closes the header sheet). */
  onNavigate?: () => void;
}) {
  const ask = useAction(api.noteTakerAsk.ask);
  const removeThread = useMutation(api.noteTakerAskData.deleteThread);
  const threads = useQuery(api.noteTakerAskData.listThreads);
  const folders = useQuery(api.noteTaker.folderSummary);
  const [threadId, setThreadId] = useState<Id<"noteAskThreads"> | null>(null);
  const thread = useQuery(api.noteTakerAskData.getThread, threadId ? { threadId } : "skip");
  const [scope, setScope] = useState<AskScope>(lockedScope ?? { kind: "all" });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(!compact);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const messages = thread?.messages ?? [];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  // An existing thread keeps the scope it was asked in.
  const activeScope: AskScope =
    lockedScope ?? (thread?.thread.scope as AskScope | undefined) ?? scope;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || sending) return;
    setSending(true);
    setPending(question);
    setDraft("");
    try {
      const result = await ask({
        threadId: threadId ?? undefined,
        scope:
          activeScope.kind === "all" ? { kind: "all" } : { kind: activeScope.kind, id: activeScope.id },
        question,
      });
      setThreadId(result.threadId);
    } catch (e) {
      setDraft(question);
      toast.error(friendlyError(e, "Couldn't get an answer right now."));
    } finally {
      setSending(false);
      setPending(null);
    }
  };

  /** Insert a starter prompt; select its first {slot} for typing over. */
  const applyPrompt = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const start = prompt.indexOf("{");
      const end = prompt.indexOf("}", start);
      if (start >= 0 && end > start) el.setSelectionRange(start, end + 1);
      else el.setSelectionRange(prompt.length, prompt.length);
    });
  };

  const scopeLabel = (s: AskScope) => {
    if (s.kind === "all") return "All meetings";
    if (s.kind === "type") return isMeetingType(s.id) ? MEETING_TEMPLATES[s.id].label : "Type";
    if (s.kind === "folder") return folders?.folders.find((f) => f._id === s.id)?.name ?? "Folder";
    return "This meeting";
  };

  const history = (
    <div className="space-y-1">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => {
          setThreadId(null);
          setDraft("");
        }}
      >
        <MessageSquarePlus className="size-4" /> New chat
      </Button>
      {(threads ?? []).length === 0 ? (
        <p className="px-2 py-4 text-center text-xs text-muted-foreground">No chats yet.</p>
      ) : (
        (threads ?? []).map((t) => (
          <div
            key={t._id}
            className={cn(
              "group flex items-center gap-1 rounded-md pr-1 hover:bg-accent",
              t._id === threadId && "bg-accent",
            )}
          >
            <button
              className="min-w-0 flex-1 px-2 py-1.5 text-left"
              onClick={() => {
                setThreadId(t._id);
                if (compact) setShowHistory(false);
              }}
            >
              <p className="truncate text-xs">{t.title}</p>
              <p className="text-[10px] text-muted-foreground">{whenLabel(t.updatedAt)}</p>
            </button>
            <button
              aria-label="Delete chat"
              className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              onClick={async () => {
                try {
                  await removeThread({ threadId: t._id });
                  if (t._id === threadId) setThreadId(null);
                } catch (e) {
                  toast.error(friendlyError(e, "Couldn't delete that chat."));
                }
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className={cn("flex min-h-0 gap-4", compact ? "h-full flex-col" : "h-[70vh]")}>
      {!compact && <aside className="hidden w-56 shrink-0 overflow-y-auto sm:block">{history}</aside>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          {lockedScope || threadId ? (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              {scopeLabel(activeScope)}
            </span>
          ) : (
            <Select value={scopeKey(scope)} onValueChange={(key) => setScope(scopeFromKey(key))}>
              <SelectTrigger size="sm" className="w-48" aria-label="Search in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All meetings</SelectItem>
                {(folders?.types ?? []).some((t) => t.type !== "general") && (
                  <SelectGroup>
                    <SelectLabel>Meeting type</SelectLabel>
                    {(folders?.types ?? [])
                      .filter((t) => isMeetingType(t.type) && t.type !== "general")
                      .map((t) => (
                        <SelectItem key={t.type} value={`type:${t.type}`}>
                          {MEETING_TEMPLATES[t.type as keyof typeof MEETING_TEMPLATES].label}
                        </SelectItem>
                      ))}
                  </SelectGroup>
                )}
                {(folders?.folders ?? []).length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Folders</SelectLabel>
                    {(folders?.folders ?? []).map((f) => (
                      <SelectItem key={f._id} value={`folder:${f._id}`}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          )}
          {compact && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="size-4" /> {showHistory ? "Back" : "History"}
            </Button>
          )}
        </div>

        {compact && showHistory ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{history}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 && !pending ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Sparkles className="size-5" />
                </span>
                <div className="space-y-1">
                  <p className="font-medium">Ask anything about your meetings</p>
                  <p className="text-xs text-muted-foreground">
                    Answers cite the meeting and the exact moment it was said.
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-2">
                  {ASK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => applyPrompt(prompt)}
                      className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {prompt.split(/(\{[^}]+\})/).map((piece, i) =>
                        piece.startsWith("{") ? (
                          <span key={i} className="text-primary">
                            {piece}
                          </span>
                        ) : (
                          piece
                        ),
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <div key={message._id} className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {message.content}
                      </p>
                    </div>
                  ) : (
                    <div key={message._id} className="flex gap-2.5">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Bot className="size-3.5" />
                      </span>
                      <AnswerText
                        text={message.content}
                        citations={(message.citations ?? []) as Citation[]}
                        onNavigate={onNavigate}
                      />
                    </div>
                  ),
                )}
                {pending && (
                  <>
                    {!messages.some((m) => m.role === "user" && m.content === pending) && (
                      <div className="flex justify-end">
                        <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/70 px-3 py-2 text-sm text-primary-foreground">
                          {pending}
                        </p>
                      </div>
                    )}
                    <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> Reading your meetings…
                    </p>
                  </>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border p-2">
          <div className="flex items-end gap-2">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              placeholder="Ask about decisions, action items, clients…"
              className="max-h-32 min-h-10 resize-none"
              aria-label="Ask your meetings"
            />
            <Button
              size="icon"
              onClick={() => void send(draft)}
              disabled={!draft.trim() || sending}
              aria-label="Send"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "How do I start a cold email campaign?",
  "What does a plan cost?",
  "I want IG outreach for my business",
];

export function AiSupportWidget() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, addToolResult } = useChat({
    transport: new DefaultChatTransport({ api: "/api/support-chat" }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName === "navigate") {
        const { path } = toolCall.input as { path: string };
        router.push(path);
        void addToolResult({
          tool: "navigate",
          toolCallId: toolCall.toolCallId,
          output: `Navigated to ${path}`,
        });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Keep the view pinned to the newest text as the reply streams in. We drive
  // the Radix ScrollArea viewport's scrollTop directly (scrollIntoView is
  // unreliable inside it) and re-pin on a short timer while streaming.
  const endRef = useRef<HTMLDivElement>(null);
  const pinToBottom = (force: boolean) => {
    const viewport = endRef.current?.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    // Don't yank the view if the user deliberately scrolled up to read.
    if (force || distanceFromBottom < 160) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  };
  useEffect(() => {
    pinToBottom(true);
  }, [messages.length, open]);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => pinToBottom(false), 120);
    return () => clearInterval(id);
  }, [busy]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        className="fixed bottom-5 right-5 z-40 flex size-13 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:scale-105"
      >
        {open ? <X className="size-5" /> : <MessageCircle className="size-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-20 right-5 z-40 flex h-[min(560px,calc(100dvh-8rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-2 border-b bg-sidebar px-4 py-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <p className="text-sm font-medium">Assistant</p>
              <p className="text-[11px] text-muted-foreground">
                Knows the whole platform — can take you anywhere
              </p>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 px-4 py-3">
            <div className="flex flex-col gap-2.5">
              {messages.length === 0 && (
                <div className="py-4">
                  <p className="text-sm text-muted-foreground">
                    Hi! Ask me anything about the platform — pricing, features,
                    or where to find something.
                  </p>
                  <div className="mt-3 flex flex-col items-start gap-1.5">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => submit(suggestion)}
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[85%] rounded-xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                    message.role === "user"
                      ? "self-end bg-primary/15"
                      : "self-start bg-secondary",
                  )}
                >
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <span key={i}>{part.text}</span>;
                    }
                    if (part.type === "tool-navigate") {
                      return (
                        <span key={i} className="block text-xs italic text-primary">
                          → taking you there…
                        </span>
                      );
                    }
                    return null;
                  })}
                </div>
              ))}
              {busy && (
                <div className="self-start rounded-xl bg-secondary px-3.5 py-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {status === "error" && (
                <p className="self-start rounded-xl bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
                  The assistant isn&apos;t available right now — please open a
                  ticket on the Support page instead.
                </p>
              )}
              <div ref={endRef} />
            </div>
          </ScrollArea>

          <form
            className="flex items-center gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything…"
              className="h-9"
            />
            <Button type="submit" size="icon" className="size-9 shrink-0" disabled={busy || !input.trim()}>
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}

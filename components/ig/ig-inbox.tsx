"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Bot,
  Check,
  Flag,
  Loader2,
  MessageCircle,
  Mic,
  Play,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListSkeleton } from "@/components/list-skeleton";
import { VoicePicker } from "@/components/voice/voice-picker";
import {
  AMBIANCE_OPTIONS,
  IG_PRIORITIES,
  IG_STAGES,
  PRIORITY_RANK,
  VOICE_NOTE_MAX_CHARS,
  type IgPriority,
  type IgStage,
} from "@/lib/ig-dms";
import { cn } from "@/lib/utils";
import { CopilotSettings } from "./ig-copilot-settings";

export type IgAccount = Exclude<
  NonNullable<FunctionReturnType<typeof api.igDms.myAccount>>,
  { status: "none" }
>;

type Conversation = Doc<"igConversations">;
type Member = FunctionReturnType<typeof api.igDms.assignableMembers>[number];
type Message = FunctionReturnType<typeof api.igDms.listMessages>[number];

type Tab = "needs_reply" | "qualified" | "mine" | "all";

function serverMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : "";
  return raw.split("Uncaught Error: ").pop() || fallback;
}

/** Conversations per page; "Load more" appends the next page. */
const PAGE_SIZE = 50;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Flagged threads first, then hottest, then most recent. */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if ((a.needsHuman ? 0 : 1) !== (b.needsHuman ? 0 : 1)) {
      return a.needsHuman ? -1 : 1;
    }
    const ra = a.priority ? PRIORITY_RANK[a.priority] : 3;
    const rb = b.priority ? PRIORITY_RANK[b.priority] : 3;
    if (ra !== rb) return ra - rb;
    return b.lastMessageAt - a.lastMessageAt;
  });
}

function initials(name: string): string {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function timeLabel(ms: number): string {
  const date = new Date(ms);
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StageBadge({ stage }: { stage: IgStage | undefined }) {
  const meta = IG_STAGES[stage ?? "new"];
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        meta.className,
      )}
    >
      {meta.label}
    </span>
  );
}

function PriorityDot({ priority }: { priority: IgPriority | undefined }) {
  const meta = priority ? IG_PRIORITIES[priority] : null;
  return (
    <span
      title={meta ? `${meta.label} lead` : "Not triaged yet"}
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        meta ? meta.dot : "bg-border",
      )}
    />
  );
}

export function Inbox({ account }: { account: IgAccount }) {
  const members = useQuery(api.igDms.assignableMembers) ?? [];
  const counts = useQuery(api.igDms.conversationCounts);
  const markRead = useMutation(api.igDms.markRead);
  const syncNow = useAction(api.igDmsActions.syncMyAccount);
  const [tab, setTab] = useState<Tab>("needs_reply");
  const [openId, setOpenId] = useState<Id<"igConversations"> | null>(null);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const term = useDebounced(search.trim(), 300);
  const searching = term.length >= 2;

  const { results, status, loadMore } = usePaginatedQuery(
    api.igDms.listConversations,
    searching ? "skip" : { tab },
    { initialNumItems: PAGE_SIZE },
  );
  const searchResults = useQuery(
    api.igDms.searchConversations,
    searching ? { q: term } : "skip",
  );

  const visible = useMemo(() => sortConversations(results), [results]);
  const memberById = new Map(members.map((m) => [m.userId, m]));

  const doSync = async () => {
    setSyncing(true);
    try {
      const { messagesAdded } = await syncNow({});
      toast.success(
        messagesAdded > 0
          ? `Synced — ${messagesAdded} new message${messagesAdded === 1 ? "" : "s"}`
          : "Synced — nothing new.",
      );
    } catch (e) {
      toast.error(serverMessage(e, "Sync failed."));
    } finally {
      setSyncing(false);
    }
  };

  const openConversation = (c: Conversation) => {
    setOpenId(c._id);
    if (c.unread) void markRead({ conversationId: c._id });
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: "needs_reply", label: "Needs reply" },
    { value: "qualified", label: "Qualified" },
    { value: "mine", label: "Mine" },
    { value: "all", label: "All" },
  ];

  const rows: { conversation: Conversation; snippet: string | null }[] =
    searching
      ? (searchResults ?? [])
      : visible.map((conversation) => ({ conversation, snippet: null }));
  const listLoading = searching
    ? searchResults === undefined
    : status === "LoadingFirstPage";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                <span className="ml-1 rounded-full bg-background/60 px-1.5 text-[10px] tabular-nums text-muted-foreground">
                  {counts?.[t.value] ?? "–"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names and messages…"
            className="pl-8 pr-8"
            aria-label="Search conversations"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {account.igUsername && (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              @{account.igUsername}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={doSync}
            disabled={syncing}
            title="Pull the latest DMs from Instagram now"
          >
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            Sync
          </Button>
          <CopilotSettings account={account} />
        </div>
      </div>

      {counts && counts.all === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <MessageCircle className="size-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connected — DMs appear here the moment someone messages your
              Instagram.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardContent className="flex max-h-[72vh] flex-col overflow-y-auto p-0">
              {searching && (
                <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  {searchResults === undefined
                    ? "Searching…"
                    : `${searchResults.length} result${searchResults.length === 1 ? "" : "s"} for “${term}”`}
                </p>
              )}
              {listLoading ? (
                <div className="p-4">
                  <ListSkeleton rows={4} />
                </div>
              ) : rows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {searching
                    ? "No names or messages match."
                    : tab === "needs_reply"
                      ? "Inbox zero — nobody's waiting on you."
                      : "Nothing here yet."}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {rows.map(({ conversation: c, snippet }) => (
                    <ConversationRow
                      key={c._id}
                      conversation={c}
                      snippet={snippet}
                      assignee={
                        c.assigneeId ? memberById.get(c.assigneeId) : undefined
                      }
                      active={openId === c._id}
                      onOpen={() => openConversation(c)}
                    />
                  ))}
                </div>
              )}
              {!searching && status === "CanLoadMore" && (
                <div className="border-t border-border p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => loadMore(PAGE_SIZE)}
                  >
                    Load {PAGE_SIZE} more
                  </Button>
                </div>
              )}
              {!searching && status === "LoadingMore" && (
                <div className="flex justify-center border-t border-border p-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardContent className="flex h-[72vh] flex-col p-0">
              {!openId ? (
                <p className="m-auto text-sm text-muted-foreground">
                  Pick a conversation
                </p>
              ) : (
                <Thread
                  key={openId}
                  conversationId={openId}
                  members={members}
                  account={account}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  conversation: c,
  snippet,
  assignee,
  active,
  onOpen,
}: {
  conversation: Conversation;
  snippet: string | null;
  assignee: Member | undefined;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={cn(
        "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-accent",
        active && "bg-primary/5",
      )}
    >
      <PriorityDot priority={c.priority} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-sm",
              c.unread ? "font-semibold" : "font-medium",
            )}
          >
            {c.contactName ?? "Instagram user"}
          </p>
          {c.needsHuman && <Flag className="size-3 shrink-0 text-amber-400" />}
          <StageBadge stage={c.stage} />
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {snippet ? (
            <span className="text-foreground/80">{snippet}</span>
          ) : (
            <>
              {c.lastDirection === "outbound" && (
                <span className="text-muted-foreground/70">You: </span>
              )}
              {c.lastPreview}
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[10px] text-muted-foreground">
          {timeLabel(c.lastMessageAt)}
        </span>
        <div className="flex items-center gap-1">
          {assignee && (
            <span
              title={assignee.name}
              className="flex size-4 items-center justify-center rounded-full bg-secondary text-[8px] font-semibold text-muted-foreground"
            >
              {initials(assignee.name)}
            </span>
          )}
          {c.unread && <span className="size-2 rounded-full bg-primary" />}
        </div>
      </div>
    </button>
  );
}

function Thread({
  conversationId,
  members,
  account,
}: {
  conversationId: Id<"igConversations">;
  members: Member[];
  account: IgAccount;
}) {
  const conversation = useQuery(api.igDms.getConversation, { conversationId });
  const messages = useQuery(api.igDms.listMessages, { conversationId }) ?? [];
  const assign = useMutation(api.igDms.assignConversation);
  const setMeta = useMutation(api.igDms.setConversationMeta);

  if (conversation === undefined) {
    return (
      <div className="p-4">
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (conversation === null) {
    return (
      <p className="m-auto text-sm text-muted-foreground">
        This conversation is no longer available.
      </p>
    );
  }

  const update = async (fn: () => Promise<unknown>, failure: string) => {
    try {
      await fn();
    } catch (e) {
      toast.error(serverMessage(e, failure));
    }
  };

  return (
    <>
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-medium">
            {conversation.contactName ?? "Instagram user"}
          </p>
          <Select
            value={conversation.priority ?? "unset"}
            onValueChange={(value) =>
              value !== "unset" &&
              void update(
                () =>
                  setMeta({
                    conversationId: conversation._id,
                    priority: value as IgPriority,
                  }),
                "Couldn't update priority.",
              )
            }
          >
            <SelectTrigger size="sm" className="h-7 w-[92px] text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              {!conversation.priority && (
                <SelectItem value="unset" disabled>
                  Priority
                </SelectItem>
              )}
              {(Object.keys(IG_PRIORITIES) as IgPriority[]).map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn("size-2 rounded-full", IG_PRIORITIES[p].dot)}
                    />
                    {IG_PRIORITIES[p].label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={conversation.stage ?? "new"}
            onValueChange={(value) =>
              void update(
                () =>
                  setMeta({
                    conversationId: conversation._id,
                    stage: value as IgStage,
                  }),
                "Couldn't update stage.",
              )
            }
          >
            <SelectTrigger size="sm" className="h-7 w-[132px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(IG_STAGES) as IgStage[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {IG_STAGES[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={conversation.assigneeId ?? "unassigned"}
            onValueChange={(value) =>
              void update(
                () =>
                  assign({
                    conversationId: conversation._id,
                    assigneeId:
                      value === "unassigned"
                        ? undefined
                        : (value as Id<"users">),
                  }),
                "Couldn't assign that conversation.",
              )
            }
          >
            <SelectTrigger size="sm" className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="Assign to…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {conversation.nextAction && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3 text-primary" />
            Next: <span className="text-foreground">{conversation.nextAction}</span>
          </p>
        )}
        {conversation.needsHuman && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            <p className="text-amber-200">
              <Flag className="mr-1 inline size-3 -translate-y-px" />
              Autopilot paused — {conversation.needsHumanReason ?? "needs a human"}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() =>
                void update(
                  () =>
                    setMeta({
                      conversationId: conversation._id,
                      needsHuman: false,
                    }),
                  "Couldn't clear the flag.",
                )
              }
            >
              <Check className="size-3" /> Handled
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m._id} message={m} />
        ))}
      </div>

      <Composer conversation={conversation} account={account} />
    </>
  );
}

function MessageBubble({ message: m }: { message: Message }) {
  const outbound = m.direction === "outbound";
  const isVoice = m.kind === "voice";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed",
          outbound ? "rounded-tr-sm bg-primary/15" : "rounded-tl-sm bg-secondary",
        )}
      >
        {isVoice && m.audioUrl ? (
          <>
            <audio
              controls
              preload="none"
              src={m.audioUrl}
              className="h-9 w-60 max-w-full"
            />
            <p className="mt-1 text-xs italic text-muted-foreground">
              “{m.body}”
            </p>
          </>
        ) : (
          <p className="whitespace-pre-wrap">{m.body}</p>
        )}
        {outbound && (
          <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
            {m.sentBy === "ai" ? (
              <>
                <Bot className="size-3 text-primary" /> AI autopilot
              </>
            ) : isVoice ? (
              <>
                <Mic className="size-3" /> Voice note
              </>
            ) : (
              "You"
            )}
            <span>· {timeLabel(m.sentAt)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function Composer({
  conversation,
  account,
}: {
  conversation: Conversation;
  account: IgAccount;
}) {
  const sendReply = useAction(api.igDmsActions.sendReply);
  const sendVoiceNote = useAction(api.igDmsActions.sendVoiceNote);
  const previewVoiceNote = useAction(api.igDmsActions.previewVoiceNote);
  const suggest = useAction(api.igAi.suggestDmReply);
  const config = useQuery(api.config.getAll);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [voiceId, setVoiceId] = useState(account.voiceId ?? "");
  const [ambiance, setAmbiance] = useState(account.ambiance ?? "room");
  const [busy, setBusy] = useState<
    "send" | "suggest" | "voice" | "preview" | null
  >(null);
  // The last rendering — reused by Send when nothing changed since.
  const [preview, setPreview] = useState<{
    storageId: Id<"_storage">;
    audioUrl: string;
    text: string;
    voiceId: string;
    ambiance: string;
  } | null>(null);

  const chars = draft.trim().length;
  const rate = config?.voiceNoteCreditsPer1kChars ?? 5;
  const estimate = chars ? Math.max(1, Math.ceil((chars / 1000) * rate)) : 0;
  const tooLong = chars > VOICE_NOTE_MAX_CHARS;
  const previewCurrent =
    preview !== null &&
    preview.text === draft.trim() &&
    preview.voiceId === voiceId &&
    preview.ambiance === ambiance;

  const doPreview = async () => {
    if (!draft.trim() || !voiceId || tooLong) return;
    setBusy("preview");
    try {
      const result = await previewVoiceNote({ text: draft, voiceId, ambiance });
      setPreview({ ...result, text: draft.trim(), voiceId, ambiance });
    } catch (e) {
      const msg = serverMessage(e, "Couldn't render the voice note.");
      toast.error(
        msg.includes("INSUFFICIENT_CREDITS")
          ? "Not enough credits to render this voice note."
          : msg,
      );
    } finally {
      setBusy(null);
    }
  };

  const doSuggest = async () => {
    setBusy("suggest");
    try {
      setDraft(await suggest({ conversationId: conversation._id }));
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't draft a reply."));
    } finally {
      setBusy(null);
    }
  };

  const doSend = async () => {
    if (!draft.trim()) return;
    setBusy("send");
    try {
      await sendReply({ conversationId: conversation._id, text: draft });
      setDraft("");
    } catch (e) {
      toast.error(serverMessage(e, "Couldn't send the reply."));
    } finally {
      setBusy(null);
    }
  };

  const doVoice = async () => {
    if (!draft.trim() || !voiceId || tooLong) return;
    setBusy("voice");
    try {
      const { credits } = await sendVoiceNote({
        conversationId: conversation._id,
        text: draft,
        voiceId,
        ambiance,
        renderedStorageId: previewCurrent ? preview.storageId : undefined,
      });
      setDraft("");
      setPreview(null);
      setMode("text");
      toast.success(
        credits > 0
          ? `Voice note sent · ${credits} credit${credits === 1 ? "" : "s"}`
          : "Voice note sent.",
      );
    } catch (e) {
      const msg = serverMessage(e, "Couldn't send the voice note.");
      toast.error(
        msg.includes("INSUFFICIENT_CREDITS")
          ? "Not enough credits for this voice note."
          : msg,
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 border-t border-border p-3">
      {mode === "voice" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Voice
            </p>
            <VoicePicker value={voiceId} onChange={setVoiceId} />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground">
              Background
            </p>
            <Select value={ambiance} onValueChange={setAmbiance}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AMBIANCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {mode === "voice" && previewCurrent && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <audio controls autoPlay src={preview.audioUrl} className="h-8 flex-1" />
          <span className="text-[11px] text-muted-foreground">
            Rendered — sending reuses it
          </span>
        </div>
      )}
      <Textarea
        className="h-16"
        placeholder={
          mode === "voice"
            ? "What should the note say? It's spoken in your cloned voice…"
            : "Write a reply…"
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && mode === "text") {
            e.preventDefault();
            void doSend();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={doSuggest}
          disabled={busy !== null}
        >
          {busy === "suggest" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4 text-primary" />
          )}
          AI suggest
        </Button>
        <Button
          variant={mode === "voice" ? "secondary" : "outline"}
          size="sm"
          title={mode === "voice" ? "Back to text" : "Send as a voice note"}
          onClick={() => setMode(mode === "voice" ? "text" : "voice")}
          disabled={busy !== null}
        >
          {mode === "voice" ? <X className="size-4" /> : <Mic className="size-4" />}
          {mode === "voice" ? "Cancel" : "Voice note"}
        </Button>
        <span className="mr-auto text-[11px] text-muted-foreground">
          {mode === "voice" && chars > 0 && (
            <span className={cn(tooLong && "text-destructive")}>
              {chars}/{VOICE_NOTE_MAX_CHARS} chars · ~{estimate} credit
              {estimate === 1 ? "" : "s"}
            </span>
          )}
        </span>
        {mode === "voice" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={doPreview}
              disabled={busy !== null || !draft.trim() || !voiceId || tooLong}
              title="Render it and listen before sending"
            >
              {busy === "preview" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Preview
            </Button>
            <Button
              size="sm"
              onClick={doVoice}
              disabled={busy !== null || !draft.trim() || !voiceId || tooLong}
            >
              {busy === "voice" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mic className="size-4" />
              )}
              {previewCurrent ? "Send this note" : "Send voice note"}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={doSend}
            disabled={busy !== null || !draft.trim()}
          >
            {busy === "send" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type FileUIPart,
} from "ai";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  Bot,
  Check,
  Download,
  ExternalLink,
  Film,
  ImagePlus,
  Loader2,
  Paperclip,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import {
  costInCredits,
  findImageModel,
  findMotionModel,
  findVideoModel,
} from "@/lib/ai-models";
import {
  HUB_MODES,
  type HubEstimateInput,
  type HubEstimateOutput,
  type HubMode,
  type HubPlan,
  type HubProposeOutput,
  type HubUIMessage,
} from "@/lib/hub-tools";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  cleanErrorMessage,
  handleGenerateError,
  probeVideoDuration,
} from "@/components/create/generate-helpers";
import { modelLabel } from "./generations-rail";

type Generation = FunctionReturnType<typeof api.generations.list>[number];

type Attachment = { url: string; kind: "image" | "video"; mime: string; name: string };

type RunState =
  | { status: "running" }
  | { status: "done"; generationId: string }
  | { status: "failed"; error: string };

const STARTERS = [
  "A cinematic 5-second vertical clip of a gold watch on black marble for Reels",
  "A photoreal portrait of a barista laughing in a sunlit cafe",
  "Turn my logo into a glossy 3D gold render on a dark background",
  "A short ad video with voiceover for a dental clinic, warm and friendly",
];

const MODE_LABEL: Record<HubMode, string> = {
  auto: "Auto",
  fast: "Fast",
  quality: "Quality",
};

/** Studio knobs: the plan's top-level aspect/resolution merge into options. */
function studioOptions(input: {
  options?: Record<string, string | number | boolean>;
  aspectRatio?: string;
  resolution?: string;
}) {
  return {
    ...(input.options ?? {}),
    ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
  };
}

function studioImages(input: { imageUrls?: string[]; referenceUrl?: string }): string[] {
  if (input.imageUrls && input.imageUrls.length > 0) return input.imageUrls;
  return input.referenceUrl ? [input.referenceUrl] : [];
}

/** Hides the "[Attached …: url]" lines the agent reads; the chips show them. */
function visibleText(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\[Attached (image|video): /.test(line))
    .join("\n")
    .trim();
}

function attachedVideos(text: string): string[] {
  return [...text.matchAll(/^\[Attached video: (\S+)\]/gm)].map((m) => m[1]);
}

export function HubChat({
  initialMessages,
  initialJobs,
  onOpenLibrary,
}: {
  initialMessages: unknown[];
  initialJobs: Record<string, string>;
  onOpenLibrary: () => void;
}) {
  const me = useQuery(api.users.me);
  const pricing = useQuery(api.generations.pricing);
  const generationsQuery = useQuery(api.generations.list);
  const generations = useMemo(() => generationsQuery ?? [], [generationsQuery]);
  const estimateStudio = useAction(api.studioActions.estimateCost);
  const generateStudio = useAction(api.studioActions.generate);
  const generateFal = useAction(api.createActions.generate);
  const cancelStudio = useAction(api.studioActions.cancelGeneration);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const getPublicUrl = useMutation(api.files.getPublicUrl);
  const saveThread = useMutation(api.hub.saveThread);

  const [input, setInput] = useState("");
  const [mode, setMode] = useState<HubMode>("auto");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [jobs, setJobs] = useState<Record<string, string>>(initialJobs);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const balance = me?.workspace?.credits ?? 0;

  // Tool handlers read live data through refs: useChat captures its callbacks once.
  const liveRef = useRef({ pricing, balance, generations });
  useEffect(() => {
    liveRef.current = { pricing, balance, generations };
  }, [pricing, balance, generations]);

  const runEstimate = async (req: HubEstimateInput): Promise<HubEstimateOutput> => {
    const { pricing: price, balance: bal } = liveRef.current;
    if (req.kind === "studio") {
      try {
        const quote = await estimateStudio({
          modelId: req.modelId,
          prompt: "(pricing)",
          options: studioOptions(req),
          imageUrls: studioImages(req),
          videoUrl: req.videoUrl,
          durationSec: req.durationSec,
          batch: req.batch,
        });
        return {
          credits: quote.credits,
          usd: quote.usd,
          exact: quote.exact,
          balance: bal,
          enough: bal >= quote.credits,
        };
      } catch (e) {
        return { balance: bal, error: cleanErrorMessage(e, "Could not price this Studio job") };
      }
    }
    if (!price) return { balance: bal, error: "Pricing is still loading — try again" };
    const base = { markup: price.markup, creditPriceUsd: price.creditPriceUsd };
    if (req.kind === "image") {
      if (!findImageModel(req.modelId)) return { balance: bal, error: `Unknown image model ${req.modelId}` };
      const credits = costInCredits({ kind: "image", modelId: req.modelId, ...base });
      return { credits, balance: bal, enough: bal >= credits };
    }
    if (req.kind === "video") {
      const model = findVideoModel(req.modelId);
      if (!model) return { balance: bal, error: `Unknown video model ${req.modelId}` };
      const wanted = req.durationSec;
      const durationSec =
        wanted && model.durations.includes(wanted) ? wanted : model.durations[0];
      const credits = costInCredits({ kind: "video", modelId: req.modelId, durationSec, ...base });
      return {
        credits,
        balance: bal,
        enough: bal >= credits,
        note:
          wanted && wanted !== durationSec
            ? `This model only does ${model.durations.join("/")} s — priced at ${durationSec} s`
            : undefined,
      };
    }
    const model = findMotionModel(req.modelId);
    if (!model || !model.available) return { balance: bal, error: `Unknown motion model ${req.modelId}` };
    if (!req.referenceUrl) return { balance: bal, error: "Motion control needs the character image (referenceUrl)" };
    if (!req.videoUrl) return { balance: bal, error: "Motion control needs the driving video (videoUrl)" };
    let seconds = req.durationSec ?? null;
    let note: string | undefined;
    if (!seconds) seconds = await probeVideoDuration(req.videoUrl);
    if (!seconds) {
      seconds = 10;
      note = "Could not read the video length — priced at 10 s";
    }
    const credits = costInCredits({
      kind: "motion",
      modelId: req.modelId,
      durationSec: Math.ceil(seconds),
      ...base,
    });
    return { credits, balance: bal, enough: bal >= credits, note };
  };
  const estimateRef = useRef(runEstimate);
  useEffect(() => {
    estimateRef.current = runEstimate;
  });

  const { messages, sendMessage, status, addToolResult, setMessages, stop, error } =
    useChat<HubUIMessage>({
      id: "ai-hub",
      messages: initialMessages as HubUIMessage[],
      transport: new DefaultChatTransport({ api: "/api/hub-chat" }),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
      onToolCall: async ({ toolCall }) => {
        if (toolCall.toolName === "estimate") {
          const output = await estimateRef.current(toolCall.input as HubEstimateInput);
          void addToolResult({ tool: "estimate", toolCallId: toolCall.toolCallId, output });
        } else if (toolCall.toolName === "recentGenerations") {
          const { limit } = toolCall.input as { limit?: number };
          const output = liveRef.current.generations.slice(0, limit ?? 8).map((g) => ({
            id: g._id,
            kind: g.kind,
            model: g.model,
            prompt: g.prompt.slice(0, 140),
            status: g.status,
            url: g.resultUrl ?? null,
          }));
          void addToolResult({ tool: "recentGenerations", toolCallId: toolCall.toolCallId, output });
        }
        // `propose` waits for the user: the plan card answers it.
      },
    });

  const busy = status === "submitted" || status === "streaming";

  // Persist the thread (last 40 messages + card → generation map) once idle.
  const lastSavedRef = useRef(JSON.stringify({ messages: initialMessages, jobs: initialJobs }));
  useEffect(() => {
    if (status !== "ready") return;
    const trimmed = messages.slice(-40);
    const payload = JSON.stringify({ messages: trimmed, jobs });
    if (payload === lastSavedRef.current) return;
    const timer = setTimeout(() => {
      lastSavedRef.current = payload;
      saveThread({ messages: trimmed, jobs }).catch(() => {
        // Best effort — the chat still works without persistence.
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [messages, jobs, status, saveThread]);

  // Keep the newest message in view while replies stream.
  const endRef = useRef<HTMLDivElement>(null);
  const pinToBottom = (force: boolean) => {
    const viewport = endRef.current?.closest(
      "[data-radix-scroll-area-viewport]",
    ) as HTMLElement | null;
    if (!viewport) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (force || distance < 200) viewport.scrollTop = viewport.scrollHeight;
  };
  useEffect(() => {
    pinToBottom(true);
  }, [messages.length]);
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => pinToBottom(false), 150);
    return () => clearInterval(id);
  }, [busy]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || busy) return;
    const lines = attachments.map((a) => `[Attached ${a.kind}: ${a.url}]`);
    const files: FileUIPart[] = attachments
      .filter((a) => a.kind === "image")
      .map((a) => ({ type: "file", mediaType: a.mime, url: a.url, filename: a.name }));
    void sendMessage(
      { text: [trimmed || "Use the attachments.", ...lines].join("\n"), files },
      { body: { mode } },
    );
    setInput("");
    setAttachments([]);
  };

  const upload = async (fileList: FileList) => {
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const kind = file.type.startsWith("video/") ? "video" : "image";
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = await res.json();
        const url = await getPublicUrl({ storageId });
        setAttachments((prev) => [...prev, { url, kind, mime: file.type, name: file.name }]);
      }
    } catch {
      toast.error("Upload failed — try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const decide = (toolCallId: string, output: HubProposeOutput) =>
    addToolResult({ tool: "propose", toolCallId, output });

  const runPlan = async (toolCallId: string, plan: HubPlan) => {
    setRuns((prev) => ({ ...prev, [toolCallId]: { status: "running" } }));
    void decide(toolCallId, { decision: "run" });
    try {
      let id: Id<"generations">;
      if (plan.kind === "studio") {
        id = await generateStudio({
          modelId: plan.modelId,
          prompt: plan.prompt,
          options: studioOptions(plan),
          imageUrls: studioImages(plan),
          videoUrl: plan.videoUrl,
          durationSec: plan.durationSec,
          batch: plan.batch,
        });
        toast.success("Rendering — the card updates when it lands.");
      } else {
        let durationSec = plan.durationSec;
        let resolution = plan.resolution;
        if (plan.kind === "image") {
          const model = findImageModel(plan.modelId);
          if (!model) throw new Error("Unknown model");
          if (!resolution || !model.resolutions.includes(resolution)) resolution = model.resolutions[0];
        } else if (plan.kind === "video") {
          const model = findVideoModel(plan.modelId);
          if (!model) throw new Error("Unknown model");
          if (!durationSec || !model.durations.includes(durationSec)) durationSec = model.durations[0];
          if (!resolution || !model.resolutions.includes(resolution)) resolution = model.resolutions[0];
        } else {
          if (!plan.referenceUrl || !plan.videoUrl) {
            throw new Error("Motion control needs both the character image and the driving video");
          }
          durationSec = (await probeVideoDuration(plan.videoUrl)) ?? durationSec;
          if (!durationSec) throw new Error("Could not read the driving video length");
          resolution = "auto";
        }
        id = await generateFal({
          kind: plan.kind,
          modelId: plan.modelId,
          prompt: plan.prompt,
          resolution: resolution ?? "auto",
          durationSec,
          referenceUrl: plan.referenceUrl,
          videoUrl: plan.videoUrl,
          characterOrientation: plan.characterOrientation,
        });
        toast.success("Done — it is in your Library too.");
      }
      setRuns((prev) => ({ ...prev, [toolCallId]: { status: "done", generationId: id } }));
      setJobs((prev) => ({ ...prev, [toolCallId]: id }));
    } catch (e) {
      const message = cleanErrorMessage(e, "Generation failed");
      setRuns((prev) => ({ ...prev, [toolCallId]: { status: "failed", error: message } }));
      handleGenerateError(e);
    }
  };

  const newChat = () => {
    if (busy) stop();
    setMessages([]);
    setRuns({});
    setJobs({});
  };

  const useAsReference = (url: string, kind: "image" | "video") => {
    setAttachments((prev) =>
      prev.some((a) => a.url === url)
        ? prev
        : [...prev, { url, kind, mime: kind === "image" ? "image/png" : "video/mp4", name: "reference" }],
    );
    textareaRef.current?.focus();
    toast.success(kind === "image" ? "Image attached as a reference." : "Video attached.");
  };

  return (
    <Card className="flex h-[min(78dvh,860px)] min-h-[560px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-sidebar/60 px-4 py-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Bot className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">AI Hub</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Describe it. I pick the model, show the price, you tap Run.
          </p>
        </div>
        <Badge variant="outline" className="hidden font-mono text-xs sm:inline-flex">
          {balance.toLocaleString()} credits
        </Badge>
        <Button variant="ghost" size="sm" onClick={newChat} disabled={messages.length === 0}>
          <RotateCcw className="size-3.5" /> New chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-4 py-4">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="py-6">
              <p className="text-sm text-muted-foreground">
                Tell me what to make — an image, a video, a vertical clip, a motion transfer
                from a photo and a video, or a directed Cinema Studio shot. Attach files
                with the paperclip.
              </p>
              <div className="mt-3 flex flex-col items-start gap-1.5">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    onClick={() => submit(starter)}
                    className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              runs={runs}
              jobs={jobs}
              generations={generations}
              balance={balance}
              busy={busy}
              onRun={runPlan}
              onDecide={decide}
              onCancelStudio={async (generationId) => {
                try {
                  await cancelStudio({ generationId: generationId as Id<"generations"> });
                  toast.success("Canceled — credits refunded.");
                } catch (e) {
                  toast.error(cleanErrorMessage(e, "Could not cancel."));
                }
              }}
              onUseAsReference={useAsReference}
              onOpenLibrary={onOpenLibrary}
            />
          ))}

          {busy && (
            <div className="flex items-center gap-2 self-start rounded-xl bg-secondary px-3.5 py-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Thinking…
            </div>
          )}
          {error && (
            <p className="self-start rounded-xl bg-destructive/10 px-3.5 py-2 text-xs text-destructive">
              The hub could not answer just now — send that again in a moment.
            </p>
          )}
          <div ref={endRef} />
        </div>
      </ScrollArea>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
      >
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span
                key={a.url}
                className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2 py-1 text-xs"
              >
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.url} alt="" className="size-5 rounded object-cover" />
                ) : (
                  <Film className="size-3.5 text-muted-foreground" />
                )}
                <span className="max-w-32 truncate">{a.name}</span>
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
          rows={2}
          placeholder="What should we make? Attach an image or video if you have one…"
          className="min-h-[60px] resize-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && e.target.files.length > 0 && upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
            Attach
          </Button>
          <div className="flex rounded-md border border-border p-0.5">
            {HUB_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-2 py-1 text-xs transition-colors",
                  mode === m ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {busy ? (
              <Button type="button" variant="outline" size="sm" onClick={() => stop()}>
                <Square className="size-3.5" /> Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim() && attachments.length === 0}>
                <Send className="size-4" /> Send
              </Button>
            )}
          </div>
        </div>
      </form>
    </Card>
  );
}

// ── Messages ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  runs,
  jobs,
  generations,
  balance,
  busy,
  onRun,
  onDecide,
  onCancelStudio,
  onUseAsReference,
  onOpenLibrary,
}: {
  message: HubUIMessage;
  runs: Record<string, RunState>;
  jobs: Record<string, string>;
  generations: Generation[];
  balance: number;
  busy: boolean;
  onRun: (toolCallId: string, plan: HubPlan) => void;
  onDecide: (toolCallId: string, output: HubProposeOutput) => void;
  onCancelStudio: (generationId: string) => void;
  onUseAsReference: (url: string, kind: "image" | "video") => void;
  onOpenLibrary: () => void;
}) {
  const isUser = message.role === "user";
  const parts = message.parts;
  return (
    <div className={cn("flex w-full flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {parts.map((part, i) => {
        if (part.type === "text") {
          const text = isUser ? visibleText(part.text) : part.text;
          const videos = isUser ? attachedVideos(part.text) : [];
          if (!text && videos.length === 0) return null;
          return (
            <div key={i} className={cn("max-w-[92%]", isUser && "flex flex-col items-end gap-1.5")}>
              {text && (
                <div
                  className={cn(
                    "whitespace-pre-wrap rounded-xl px-3.5 py-2 text-sm",
                    isUser ? "bg-primary/15" : "bg-secondary",
                  )}
                >
                  {text}
                </div>
              )}
              {videos.map((url) => (
                <span
                  key={url}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  <Film className="size-3.5" /> video attached
                </span>
              ))}
            </div>
          );
        }
        if (part.type === "file" && part.mediaType.startsWith("image/")) {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={part.url}
              alt=""
              className="max-h-40 rounded-lg border border-border object-cover"
            />
          );
        }
        if (part.type === "tool-estimate") {
          const output = part.state === "output-available" ? part.output : null;
          return (
            <p key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wand2 className="size-3" />
              {output
                ? output.error
                  ? `Needs attention: ${output.error}`
                  : `${output.credits?.toLocaleString()} credits${output.note ? ` · ${output.note}` : ""}`
                : "Pricing…"}
            </p>
          );
        }
        if (part.type === "tool-recentGenerations") {
          return (
            <p key={i} className="text-xs text-muted-foreground">
              Checked your recent results.
            </p>
          );
        }
        if (part.type === "tool-propose") {
          const plan = part.input as HubPlan | undefined;
          if (!plan || part.state === "input-streaming") {
            return (
              <p key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Preparing the plan…
              </p>
            );
          }
          const decision = part.state === "output-available" ? part.output : null;
          const run = runs[part.toolCallId];
          const jobId = run?.status === "done" ? run.generationId : jobs[part.toolCallId];
          return (
            <PlanCard
              key={i}
              plan={plan}
              balance={balance}
              decision={decision}
              run={run}
              generation={jobId ? (generations.find((g) => g._id === jobId) ?? null) : null}
              jobId={jobId}
              busy={busy}
              onRun={() => onRun(part.toolCallId, plan)}
              onDecide={(output) => onDecide(part.toolCallId, output)}
              onCancelStudio={onCancelStudio}
              onUseAsReference={onUseAsReference}
              onOpenLibrary={onOpenLibrary}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

// ── Plan card (human in the loop) ───────────────────────────────────────

function summarize(plan: HubPlan): string[] {
  const chips: string[] = [modelLabel(plan.modelId)];
  if (plan.durationSec) chips.push(`${plan.durationSec} s`);
  if (plan.aspectRatio) chips.push(plan.aspectRatio);
  if (plan.resolution) chips.push(plan.resolution);
  if (plan.referenceUrl || (plan.imageUrls && plan.imageUrls.length > 0)) {
    const count = plan.imageUrls?.length ?? 1;
    chips.push(count > 1 ? `${count} images` : "reference image");
  }
  if (plan.videoUrl) chips.push("source video");
  for (const [key, value] of Object.entries(plan.options ?? {})) {
    if (value === false || value === "" || value === undefined) continue;
    if (key === "aspect_ratio" || key === "resolution") continue;
    chips.push(value === true ? key.replace(/_/g, " ") : `${key.replace(/_/g, " ")}: ${value}`);
  }
  return chips;
}

function PlanCard({
  plan,
  balance,
  decision,
  run,
  generation,
  jobId,
  busy,
  onRun,
  onDecide,
  onCancelStudio,
  onUseAsReference,
  onOpenLibrary,
}: {
  plan: HubPlan;
  balance: number;
  decision: HubProposeOutput | null;
  run: RunState | undefined;
  generation: Generation | null;
  jobId: string | undefined;
  busy: boolean;
  onRun: () => void;
  onDecide: (output: HubProposeOutput) => void;
  onCancelStudio: (generationId: string) => void;
  onUseAsReference: (url: string, kind: "image" | "video") => void;
  onOpenLibrary: () => void;
}) {
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const enough = balance >= plan.credits;
  const pending = decision === null;

  return (
    <Card className="w-full max-w-[92%] border-primary/30">
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium">{plan.title}</p>
            <p className="text-xs text-muted-foreground">{plan.reason}</p>
          </div>
          <Badge variant="outline" className="shrink-0 border-primary/40 font-mono text-xs text-primary">
            {plan.credits.toLocaleString()} credits
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {summarize(plan).map((chip) => (
            <Badge key={chip} variant="outline" className="text-[11px] text-muted-foreground">
              {chip}
            </Badge>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          className="text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <span className={cn(!showPrompt && "line-clamp-2")}>Prompt: {plan.prompt}</span>
        </button>

        {pending && (
          <>
            {!enough && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Needs {plan.credits.toLocaleString()} credits and you have {balance.toLocaleString()}.{" "}
                <Link href="/settings" className="underline">
                  Top up in Settings
                </Link>
                , then run it.
              </p>
            )}
            {changing ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  onDecide({ decision: "change", note: note.trim() });
                }}
              >
                <Input
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What should change? e.g. make it 10 s and warmer"
                  className="h-9"
                />
                <Button type="submit" size="sm" disabled={!note.trim() || busy}>
                  Send
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setChanging(false)}>
                  Back
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={onRun} disabled={!enough || busy}>
                  <Play className="size-3.5" /> Run
                </Button>
                <Button size="sm" variant="outline" onClick={() => setChanging(true)} disabled={busy}>
                  Change…
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDecide({ decision: "cancel" })}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            )}
          </>
        )}

        {decision?.decision === "cancel" && (
          <p className="text-xs text-muted-foreground">Cancelled — nothing was charged.</p>
        )}
        {decision?.decision === "change" && (
          <p className="text-xs text-muted-foreground">Change requested: {decision.note}</p>
        )}
        {decision?.decision === "run" && (
          <JobCard
            plan={plan}
            run={run}
            generation={generation}
            jobId={jobId}
            onCancelStudio={onCancelStudio}
            onUseAsReference={onUseAsReference}
            onOpenLibrary={onOpenLibrary}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ── Job card (the result) ───────────────────────────────────────────────

function JobCard({
  plan,
  run,
  generation,
  jobId,
  onCancelStudio,
  onUseAsReference,
  onOpenLibrary,
}: {
  plan: HubPlan;
  run: RunState | undefined;
  generation: Generation | null;
  jobId: string | undefined;
  onCancelStudio: (generationId: string) => void;
  onUseAsReference: (url: string, kind: "image" | "video") => void;
  onOpenLibrary: () => void;
}) {
  const isVideo = plan.kind === "video" || plan.kind === "motion" || generation?.kind === "video" || generation?.kind === "motion";
  const status = generation?.status ?? (run?.status === "running" ? "running" : run?.status === "failed" ? "failed" : jobId ? "done" : "running");
  const url = generation?.resultUrl;

  if (run?.status === "failed" && !generation) {
    return (
      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Failed: {run.error}. Any credits taken were refunded.
      </p>
    );
  }

  if (status === "pending" || status === "running") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/60 px-3 py-2.5">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm">Rendering…</p>
          <p className="text-xs text-muted-foreground">
            {modelLabel(plan.modelId)} · it lands right here and in your Library
          </p>
        </div>
        {generation?.provider === "higgsfield" && (
          <Button variant="ghost" size="sm" onClick={() => onCancelStudio(generation._id)}>
            Cancel
          </Button>
        )}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
        Failed: {generation?.error ?? "the model rejected it"}. Your credits were refunded.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {url ? (
        isVideo ? (
          <video src={url} controls playsInline className="max-h-80 w-full rounded-lg bg-black" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={plan.title} className="max-h-80 w-full rounded-lg object-contain" />
        )
      ) : (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 text-primary" /> Done — open it from the Library.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {url && (
          <>
            <Button size="sm" variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Download className="size-3.5" /> Download
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onUseAsReference(url, isVideo ? "video" : "image")}
            >
              {isVideo ? <Film className="size-3.5" /> : <ImagePlus className="size-3.5" />}
              {isVideo ? "Use as driving video" : "Use as reference"}
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={onOpenLibrary}>
          <ExternalLink className="size-3.5" /> Library
        </Button>
        {!url && <Sparkles className="hidden" />}
      </div>
    </div>
  );
}

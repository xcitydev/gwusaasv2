"use client";

import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { BlandWebClient } from "bland-client-js-sdk";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Mic, PhoneOutgoing, Plus, Square } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ListSkeleton } from "@/components/list-skeleton";
import { CallTranscript } from "@/components/voice/call-transcript";
import { VoicePicker, BackgroundPicker } from "@/components/voice/voice-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type QualifierCall = FunctionReturnType<typeof api.voice.listCalls>[number];

function callVerdict(call: QualifierCall): boolean | null {
  if (call.result == null || typeof call.result !== "object") return null;
  const result = call.result as { qualified?: boolean | null };
  return typeof result.qualified === "boolean" ? result.qualified : null;
}

function CampaignCalls({ campaignId }: { campaignId: Id<"qualifierCampaigns"> }) {
  const callsQuery = useQuery(api.voice.listCalls, { qualifierCampaignId: campaignId });
  const calls = callsQuery ?? [];
  const [openId, setOpenId] = useState<Id<"calls"> | null>(null);
  const open = calls.find((c) => c._id === openId) ?? null;
  const verdict = open ? callVerdict(open) : null;
  const summary =
    open?.result != null && typeof open.result === "object"
      ? ((open.result as { summary?: string }).summary ?? null)
      : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {callsQuery === undefined ? (
        <ListSkeleton rows={3} inCard={false} className="[&>div]:px-0" />
      ) : calls.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No calls recorded for this campaign.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {calls.map((call) => {
            const v = callVerdict(call);
            return (
              <button
                key={call._id}
                onClick={() => setOpenId(call._id)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {call.isTest ? "Browser rehearsal" : (call.leadName ?? "Unknown lead")}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {call.isTest ? "you played the lead" : call.leadPhone}
                    {call.status === "completed" && (
                      <span className="ml-2">
                        {call.durationSec}s{call.isTest ? " · free" : ` · ${call.costCredits} cr`}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {v !== null && (
                    <span
                      className={
                        v
                          ? "text-xs font-semibold text-emerald-400"
                          : "text-xs font-semibold text-muted-foreground"
                      }
                    >
                      {v ? "✓ Qualified" : "✗ Not qualified"}
                    </span>
                  )}
                  <StatusBadge status={call.status} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{open?.leadName ?? "Call details"}</DialogTitle>
            <DialogDescription className="font-mono">
              {open?.leadPhone}
              {open?.status === "completed" &&
                ` · ${open.durationSec}s · ${open.costCredits} credits`}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {verdict !== null && (
              <div
                className={
                  verdict
                    ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-400"
                    : "rounded-lg border border-border bg-secondary/50 px-4 py-2.5 text-sm font-medium text-muted-foreground"
                }
              >
                {verdict
                  ? "✓ Qualified — worth your time"
                  : "✗ Not qualified by your criteria"}
              </div>
            )}
            {summary && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Summary
                </p>
                <p className="text-sm leading-relaxed">{summary}</p>
              </div>
            )}
            {open?.transcript ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </p>
                <CallTranscript
                  transcript={open.transcript}
                  aiLabel="Qualifier"
                  callerLabel={open.leadName ?? "Lead"}
                  className="max-h-none"
                />
              </div>
            ) : (
              open?.status === "completed" && (
                <p className="text-sm text-muted-foreground">
                  No transcript was captured for this call.
                </p>
              )
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "(305) 456-9336" / "+234 803…" → E.164-ish, or null when unparseable. */
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`; // bare US number
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null; // non-US without a country code — ask for the +
}

export function QualifierClient() {
  const campaignsQuery = useQuery(api.voice.listQualifierCampaigns);
  const campaigns = campaignsQuery ?? [];
  const leads = useQuery(api.leads.list) ?? [];
  const importLeads = useMutation(api.leads.importLeads);
  const create = useMutation(api.voice.createQualifierCampaign);
  const startCampaign = useAction(api.voiceActions.startQualifierCampaign);
  const [startingId, setStartingId] = useState<string | null>(null);

  const doStart = async (campaignId: Id<"qualifierCampaigns">) => {
    setStartingId(campaignId);
    try {
      const { dispatched } = await startCampaign({ campaignId });
      toast.success(
        `Calling ${dispatched} lead${dispatched === 1 ? "" : "s"} now — results land here as calls finish.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "The voice engine isn't connected yet — an admin needs to add the Bland key."
          : msg.split("Uncaught Error: ").pop() || "Couldn't start the campaign.",
      );
    } finally {
      setStartingId(null);
    }
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [callerName, setCallerName] = useState("");
  const [voice, setVoice] = useState("maya");
  const [backgroundTrack, setBackgroundTrack] = useState<string | undefined>(undefined);
  const [prompt, setPrompt] = useState("");
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPhone, setCustomPhone] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);

  const addCustomLead = async () => {
    const name = customName.trim();
    const phone = normalizePhone(customPhone);
    if (!name) {
      toast.error("Give the lead a name.");
      return;
    }
    if (!phone) {
      toast.error(
        "That phone number doesn't look callable — include the country code, e.g. +2348031234567.",
      );
      return;
    }
    setAddingCustom(true);
    try {
      // Manual leads live in the same store — synthesized email keeps the
      // per-workspace dedupe working (same phone twice = same lead).
      const email = `manual-${phone.replace(/\D/g, "")}@lead.manual`;
      const res = await importLeads({
        leads: [{ email, name, phone }],
        source: "manual",
        chargeCredits: false,
        sourceDetail: "Added manually",
      });
      const newId = res.importedIds?.[0];
      if (newId) {
        setSelectedLeads((prev) => new Set(prev).add(newId));
        toast.success(`${name} added and selected.`);
      } else {
        // Deduped — the lead already exists; find and select it.
        const existing = leads.find((l) => l.email === email || l.phone === phone);
        if (existing) {
          setSelectedLeads((prev) => new Set(prev).add(existing._id));
          toast.info(`${name} was already in your leads — selected.`);
        }
      }
      setCustomName("");
      setCustomPhone("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the lead.");
    } finally {
      setAddingCustom(false);
    }
  };
  const [openCampaign, setOpenCampaign] = useState<{
    id: Id<"qualifierCampaigns">;
    name: string;
    prompt: string;
  } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  // ── Browser rehearsal: talk to the campaign's exact agent, you play the lead
  const startBrowserTest = useAction(api.voiceActions.startQualifierBrowserTest);
  const endBrowserTest = useAction(api.voiceActions.endBrowserTest);
  const [testState, setTestState] = useState<"idle" | "connecting" | "live">("idle");
  const testClientRef = useRef<BlandWebClient | null>(null);
  const testSessionRef = useRef<{ callRecordId: Id<"calls">; blandCallId: string } | null>(null);
  const transcriptRef = useRef<{ processId: string; type: string; text: string }[]>([]);
  const testStartRef = useRef(0);

  const captureTranscripts = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const chunk = payload as Record<string, unknown>;
    const text = typeof chunk.text === "string" ? chunk.text : "";
    const processId = String(chunk.processId ?? "");
    if (!text.trim() || !processId) return;
    const type = String(chunk.type ?? "");
    const existing = transcriptRef.current.find(
      (t) => t.processId === processId && t.type === type,
    );
    if (existing) existing.text += ` ${text}`;
    else transcriptRef.current.push({ processId, type, text });
  };

  const stopTest = () => {
    testClientRef.current?.stopConversation();
    testClientRef.current = null;
    setTestState("idle");
    const session = testSessionRef.current;
    testSessionRef.current = null;
    if (session) {
      const clientTranscript = transcriptRef.current
        .map((t) => {
          const speaker = /user|human|caller/i.test(t.type) ? "user" : "assistant";
          return `${speaker}: ${t.text.trim()}`;
        })
        .join("\n");
      const durationSec = testStartRef.current
        ? (Date.now() - testStartRef.current) / 1000
        : 0;
      void endBrowserTest({
        ...session,
        clientTranscript: clientTranscript || undefined,
        durationSec,
      }).catch(() => {});
      toast.success("Rehearsal ended — transcript and verdict appear in the call list shortly.");
    }
    transcriptRef.current = [];
    testStartRef.current = 0;
  };

  const browserTest = async () => {
    if (testState === "live") {
      stopTest();
      return;
    }
    if (!openCampaign) return;
    setTestState("connecting");
    try {
      const { agentId, sessionToken, blandCallId, callRecordId } =
        await startBrowserTest({ campaignId: openCampaign.id });
      testSessionRef.current = { callRecordId: callRecordId as Id<"calls">, blandCallId };
      transcriptRef.current = [];
      const { BlandWebClient } = await import("bland-client-js-sdk");
      const client = new BlandWebClient(agentId, sessionToken);
      (client as unknown as {
        on: (event: string, handler: (payload: unknown) => void) => void;
      }).on("transcripts", captureTranscripts);
      await client.initConversation({
        callId: blandCallId,
        sampleRate: 44100,
        enableUpdate: true,
      });
      testStartRef.current = Date.now();
      testClientRef.current = client;
      setTestState("live");
      toast.success("You're live — you're the lead. Answer the call!");
    } catch (e) {
      setTestState("idle");
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("NOT_CONFIGURED")) {
        toast.error("The voice engine isn't connected yet — an admin needs to add the Bland key.");
      } else if (/permission|notallowed/i.test(msg)) {
        toast.error("Microphone access was blocked — allow it and try again.");
      } else {
        toast.error(msg.split("Uncaught Error: ").pop() || "Couldn't start the rehearsal.");
      }
    }
  };

  const leadsWithPhone = leads.filter((l) => l.phone);

  const doCreate = async () => {
    setCreating(true);
    try {
      await create({
        name,
        prompt,
        callerName: callerName.trim() || undefined,
        voice,
        backgroundTrack,
        leadIds: [...selectedLeads] as Id<"leads">[],
      });
      toast.success("Campaign created — press Start calling when you're ready. Calls bill per-second in credits.");
      setCreateOpen(false);
      setName("");
      setPrompt("");
      setSelectedLeads(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create the campaign.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}
        </p>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New qualifier
        </Button>
      </div>

      {campaignsQuery === undefined ? (
        <ListSkeleton rows={3} />
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <PhoneOutgoing className="size-8 text-muted-foreground" />
            <p className="font-medium">No qualifier campaigns yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              The AI calls your leads with your qualification prompt, then tells
              you which ones are worth your time. Calls bill per-second in credits.
            </p>
            <Button className="mt-1" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create your first qualifier
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {campaigns.map((campaign) => (
              <div
                key={campaign._id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setOpenCampaign({ id: campaign._id, name: campaign.name, prompt: campaign.prompt })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    setOpenCampaign({ id: campaign._id, name: campaign.name, prompt: campaign.prompt });
                }}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{campaign.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.leadCount} lead{campaign.leadCount === 1 ? "" : "s"} ·{" "}
                    {new Date(campaign._creationTime).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {campaign.status === "draft" && (
                    <Button
                      size="sm"
                      disabled={startingId !== null}
                      onClick={(e) => {
                        e.stopPropagation();
                        doStart(campaign._id);
                      }}
                    >
                      {startingId === campaign._id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PhoneOutgoing className="size-4" />
                      )}
                      Start calling
                    </Button>
                  )}
                  <StatusBadge status={campaign.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New qualifier campaign</DialogTitle>
            <DialogDescription>
              Only leads with a phone number can be called ({leadsWithPhone.length} available).
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5">Campaign name *</Label>
                <Input
                  placeholder="March webinar signups"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5">Caller name</Label>
                <Input
                  placeholder="Maya"
                  value={callerName}
                  onChange={(e) => setCallerName(e.target.value)}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  How the AI introduces itself: &ldquo;Hi, this is Maya, calling
                  on behalf of…&rdquo;
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5">Voice</Label>
                <VoicePicker value={voice} onChange={setVoice} />
              </div>
              <div>
                <Label className="mb-1.5">Background sound</Label>
                <BackgroundPicker
                  value={backgroundTrack}
                  onChange={setBackgroundTrack}
                />
              </div>
            </div>
            <div>
              <Label className="mb-1.5">Qualification prompt *</Label>
              <Textarea
                className="h-40 resize-none overflow-y-auto"
                placeholder={
                  "You're calling on behalf of Acme Marketing. Ask if they run " +
                  "paid ads, what their monthly budget is, and whether they'd " +
                  "take a 15-min call. Qualified = budget over $1k/mo and open " +
                  "to a call."
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-2">
                Leads to call ({selectedLeads.size} selected)
              </Label>
              {leadsWithPhone.length === 0 ? (
                <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                  None of your leads have phone numbers yet — import leads with a
                  phone column in Find Customers.
                </p>
              ) : (
                <div className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border">
                  {leadsWithPhone.map((lead) => (
                    <label
                      key={lead._id}
                      className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={selectedLeads.has(lead._id)}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedLeads);
                          if (checked) next.add(lead._id);
                          else next.delete(lead._id);
                          setSelectedLeads(next);
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {lead.name ?? lead.email}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {lead.phone}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <Input
                  placeholder="Name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
                <Input
                  placeholder="+1 305 555 0134"
                  inputMode="tel"
                  className="max-w-[170px] font-mono"
                  value={customPhone}
                  onChange={(e) => setCustomPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addCustomLead();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  onClick={addCustomLead}
                  disabled={addingCustom}
                >
                  {addingCustom ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Add
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Adds the lead to your store and ticks it for this campaign. US
                numbers work without a country code; others need one (+234…).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={doCreate} disabled={creating}>
              {creating && <Loader2 className="size-4 animate-spin" />} Create campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={openCampaign !== null}
        onOpenChange={(o) => {
          if (o) return;
          if (testState === "live") stopTest();
          setOpenCampaign(null);
          setShowPrompt(false);
        }}
      >
        <SheetContent side="right" className="flex w-full flex-col p-5 sm:max-w-lg">
          <SheetTitle>{openCampaign?.name}</SheetTitle>
          {openCampaign && (
            <div className="mb-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <button
                  onClick={() => setShowPrompt((s) => !s)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {showPrompt ? "Hide qualification prompt" : "View qualification prompt"}
                </button>
                <Button
                  size="sm"
                  variant={testState === "live" ? "destructive" : "outline"}
                  onClick={browserTest}
                  disabled={testState === "connecting"}
                >
                  {testState === "connecting" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : testState === "live" ? (
                    <Square className="size-4" />
                  ) : (
                    <Mic className="size-4" />
                  )}
                  {testState === "live"
                    ? "End rehearsal"
                    : testState === "connecting"
                      ? "Connecting…"
                      : "Test in browser"}
                </Button>
              </div>
              {showPrompt && (
                <div className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-secondary/30 p-3 text-xs leading-relaxed text-muted-foreground">
                  {openCampaign.prompt}
                </div>
              )}
            </div>
          )}
          {openCampaign && <CampaignCalls campaignId={openCampaign.id} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

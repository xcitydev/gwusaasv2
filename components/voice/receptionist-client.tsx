"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarCheck,
  ChevronRight,
  Headphones,
  History,
  Loader2,
  Mic,
  Phone,
  RotateCw,
  PhoneCall,
  Plus,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import type { BlandWebClient } from "bland-client-js-sdk";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Id } from "@/convex/_generated/dataModel";
import { StatusBadge } from "@/components/status-badge";
import { ListSkeleton } from "@/components/list-skeleton";
import { CallTranscript } from "@/components/voice/call-transcript";
import { VoicePicker, BackgroundPicker } from "@/components/voice/voice-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const VOICES = [
  { id: "maya", label: "Maya — warm, professional (F)" },
  { id: "ryan", label: "Ryan — confident, friendly (M)" },
  { id: "june", label: "June — upbeat, energetic (F)" },
  { id: "mason", label: "Mason — calm, reassuring (M)" },
];

const TIMEZONES = [
  "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Berlin", "Asia/Dubai", "Australia/Sydney", "UTC",
];

const MAX_RECEPTIONISTS = 3;

// Shared entrance animation: parents stagger their children.
const stagger = {
  animate: { transition: { staggerChildren: 0.06 } },
};
const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.21, 0.65, 0.35, 1] as const },
  },
};

/** A Card that rises in as part of its parent's stagger sequence. */
function MotionCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div variants={fadeUp} className={className}>
      <Card className="h-full">{children}</Card>
    </motion.div>
  );
}

type ReceptionistDoc = FunctionReturnType<typeof api.voice.listReceptionists>[number];

export function ReceptionistClient() {
  const receptionists = useQuery(api.voice.listReceptionists);
  const [view, setView] = useState<"list" | "new" | Id<"receptionists">>("list");

  if (receptionists === undefined) {
    return <ListSkeleton rows={3} />;
  }

  const doc =
    view === "list" || view === "new"
      ? null
      : (receptionists.find((r) => r._id === view) ?? null);
  if (view !== "list" && view !== "new" && !doc) {
    // Deleted elsewhere — fall back to the list.
    setView("list");
    return null;
  }

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {view === "list" ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -14 }}
            transition={{ duration: 0.16 }}
          >
            <ReceptionistList
              receptionists={receptionists}
              onOpen={(id) => setView(id)}
              onNew={() => setView("new")}
            />
          </motion.div>
        ) : (
          <motion.div
            key={view === "new" ? "new" : view}
            initial={{ opacity: 0, x: 14 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 14 }}
            transition={{ duration: 0.16 }}
          >
            <ReceptionistEditor
              receptionist={doc}
              onBack={() => setView("list")}
              onSaved={(id) => setView(id)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

// ── List of saved receptionists ─────────────────────────────────────────

function ReceptionistList({
  receptionists,
  onOpen,
  onNew,
}: {
  receptionists: ReceptionistDoc[];
  onOpen: (id: Id<"receptionists">) => void;
  onNew: () => void;
}) {
  const atLimit = receptionists.length >= MAX_RECEPTIONISTS;
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {receptionists.length} of {MAX_RECEPTIONISTS} receptionists
        </p>
        <Button onClick={onNew} disabled={atLimit} title={atLimit ? "Limit reached — delete one to create another" : undefined}>
          <Plus className="size-4" /> New receptionist
        </Button>
      </div>

      {receptionists.length === 0 ? (
        <motion.div variants={fadeUp} initial="initial" animate="animate">
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
                <PhoneCall className="size-6" />
              </span>
              <p className="font-medium">No receptionists yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Create up to {MAX_RECEPTIONISTS} — e.g. one per business or
                department. Each has its own prompt, voice, number, bookings and
                call history.
              </p>
              <Button className="mt-1" onClick={onNew}>
                <Plus className="size-4" /> Create your first receptionist
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          variants={stagger}
          initial="initial"
          animate="animate"
        >
          {receptionists.map((r) => (
            <motion.button
              key={r._id}
              variants={fadeUp}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onOpen(r._id)}
              className="group rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary">
                  <PhoneCall className="size-5" />
                </span>
                <StatusBadge status={r.status} className="shrink-0" />
              </div>
              <p className="mt-4 flex items-center gap-1 truncate font-semibold">
                {r.name}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {VOICES.find((v) => v.id === r.voice)?.label ?? r.voice}
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {r.phoneNumber ? (
                  <Badge variant="outline" className="font-mono text-xs">
                    <Phone className="size-3" /> {r.phoneNumber}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="text-xs text-muted-foreground"
                  >
                    Browser only
                  </Badge>
                )}
                {r.autoBook && (
                  <Badge
                    variant="outline"
                    className="border-primary/40 text-xs text-primary"
                  >
                    <CalendarCheck className="size-3" /> Auto-book
                  </Badge>
                )}
              </div>
            </motion.button>
          ))}
          {!atLimit && (
            <motion.button
              variants={fadeUp}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={onNew}
              className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="size-6" />
              <span className="text-sm font-medium">New receptionist</span>
            </motion.button>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ── Editor (create + edit) with scoped calls ────────────────────────────

function ReceptionistEditor({
  receptionist,
  onBack,
  onSaved,
}: {
  receptionist: ReceptionistDoc | null;
  onBack: () => void;
  onSaved: (id: Id<"receptionists">) => void;
}) {
  const numbers = useQuery(api.voice.listNumbers) ?? [];
  const save = useMutation(api.voice.saveReceptionist);
  const deleteReceptionist = useMutation(api.voice.deleteReceptionist);
  const attach = useMutation(api.voice.attachNumberToReceptionist);
  const buyNumber = useAction(api.voiceActions.buyNumber);
  const syncReceptionist = useAction(api.voiceActions.syncReceptionist);
  const startBrowserTest = useAction(api.voiceActions.startBrowserTest);
  const saveBookingSettings = useAction(api.voiceActions.saveBookingSettings);
  const endBrowserTest = useAction(api.voiceActions.endBrowserTest);

  const [name, setName] = useState(receptionist?.name ?? "");
  const [voice, setVoice] = useState(receptionist?.voice ?? "maya");
  const [backgroundTrack, setBackgroundTrack] = useState<string | undefined>(
    receptionist?.backgroundTrack ?? undefined,
  );
  const [greeting, setGreeting] = useState(receptionist?.greeting ?? "");
  const [prompt, setPrompt] = useState(receptionist?.prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [buyOpen, setBuyOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("415");
  const [buying, setBuying] = useState<string | null>(null);
  const [available, setAvailable] = useState<
    { phone_number: string; friendly_name: string; location: string }[] | null
  >(null);
  const [priceCredits, setPriceCredits] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [boughtNumber, setBoughtNumber] = useState<string | null>(null);
  const listAvailable = useAction(api.voiceActions.listAvailable);

  const [autoBook, setAutoBook] = useState(receptionist?.autoBook ?? false);
  const [calcomLink, setCalcomLink] = useState(receptionist?.calcomLink ?? "");
  const [bookingTz, setBookingTz] = useState(receptionist?.bookingTimezone ?? "America/New_York");
  const [savingBooking, setSavingBooking] = useState(false);

  const [testState, setTestState] = useState<"idle" | "connecting" | "live">("idle");
  const testClientRef = useRef<BlandWebClient | null>(null);
  const testSessionRef = useRef<{ callRecordId: Id<"calls">; blandCallId: string } | null>(null);
  const transcriptRef = useRef<{ processId: string; type: string; text: string }[]>([]);
  const testStartRef = useRef<number>(0);

  // Hang up if the user navigates away mid-test.
  useEffect(() => {
    return () => {
      testClientRef.current?.stopConversation();
      testClientRef.current = null;
    };
  }, []);

  const doSave = async () => {
    setSaving(true);
    try {
      const id = await save({
        id: receptionist?._id,
        name,
        prompt,
        voice,
        backgroundTrack,
        greeting: greeting || undefined,
      });
      toast.success("Receptionist saved.");
      if (!receptionist) onSaved(id);
      if (receptionist?.phoneNumber) {
        try {
          await syncReceptionist({
            phoneNumber: receptionist.phoneNumber,
            prompt,
            voice,
            backgroundTrack,
            greeting: greeting || undefined,
          });
          toast.success("Live number updated.");
        } catch {
          // Engine not connected — local save still succeeded.
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  // Server errors arrive wrapped ("… Uncaught Error: <real message>") —
  // surface only the human part.
  const serverMessage = (e: unknown, fallback: string) => {
    const raw = e instanceof Error ? e.message : "";
    const m = raw.match(/Uncaught Error: ([\s\S]*?)(?:\n|$)/);
    return m?.[1] ?? (raw || fallback);
  };

  const searchNumbers = async (code: string) => {
    setSearching(true);
    setSearchError("");
    try {
      const res = await listAvailable({ areaCode: code.trim() || undefined });
      setAvailable(res.numbers);
      setPriceCredits(res.priceCredits);
    } catch (e) {
      setAvailable([]);
      setSearchError(serverMessage(e, "Couldn't load available numbers."));
    } finally {
      setSearching(false);
    }
  };

  const openBuy = () => {
    setBuyOpen(true);
    setBoughtNumber(null);
    setAvailable(null);
    void searchNumbers(areaCode);
  };

  const doBuy = async (phoneNumber: string) => {
    setBuying(phoneNumber);
    try {
      const { number } = await buyNumber({ phoneNumber });
      setBoughtNumber(number);
      toast.success("Number purchased.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(
        msg.includes("NOT_CONFIGURED")
          ? "The voice engine isn't connected yet — an admin needs to add the Bland key."
          : serverMessage(e, "Purchase failed."),
      );
    } finally {
      setBuying(null);
    }
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
          const speaker = /user|human|caller/i.test(t.type) ? "Caller" : "Receptionist";
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
      toast.success(
        "Test ended — transcript and booking details appear in Recent calls shortly.",
      );
    } else {
      toast.success("Test ended.");
    }
    transcriptRef.current = [];
    testStartRef.current = 0;
  };

  /**
   * Bland's SDK "transcripts" event delivers ONE chunk at a time:
   * {processId, type, text} — chunks sharing processId+type are pieces of the
   * same utterance (verified against the SDK's own handleNewUpdate source).
   */
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

  const browserTest = async () => {
    if (testState === "live") {
      stopTest();
      return;
    }
    if (!receptionist) {
      toast.error("Save this receptionist first, then test it.");
      return;
    }
    if (!prompt.trim()) {
      toast.error("Write the prompt first — that's what the receptionist runs on.");
      return;
    }
    setTestState("connecting");
    try {
      // Fresh throwaway agent with the CURRENT form values (even unsaved).
      const { agentId, sessionToken, blandCallId, callRecordId } =
        await startBrowserTest({
          receptionistId: receptionist._id,
          prompt,
          voice,
          backgroundTrack,
          greeting: greeting || undefined,
        });
      testSessionRef.current = { callRecordId, blandCallId };
      transcriptRef.current = [];
      const { BlandWebClient } = await import("bland-client-js-sdk");
      const client = new BlandWebClient(agentId, sessionToken);
      // Verified against SDK source: transcript chunks arrive on "transcripts".
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
      toast.success("You're live — say hello!");
    } catch (e) {
      setTestState("idle");
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("NOT_CONFIGURED")) {
        toast.error(
          "The voice engine isn't connected yet — an admin needs to add the Bland key.",
        );
      } else if (/permission|notallowed/i.test(msg)) {
        toast.error("Microphone access was blocked — allow it and try again.");
      } else {
        toast.error(msg || "Couldn't start the test session.");
      }
    }
  };

  return (
    <div>
      <div className="mb-5">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" /> All receptionists
        </Button>
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 text-lg font-semibold text-primary">
            {(receptionist?.name ?? name ?? "N").charAt(0).toUpperCase() || "N"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold leading-tight">
              {receptionist ? receptionist.name : "New receptionist"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {VOICES.find((v) => v.id === voice)?.label ?? voice}
              {receptionist?.phoneNumber && ` · ${receptionist.phoneNumber}`}
            </p>
          </div>
          {receptionist && (
            <Button
              variant="outline"
              size="icon"
              aria-label="Delete receptionist"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <motion.div
        className="grid gap-4 sm:gap-6 lg:grid-cols-5"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <MotionCard className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PhoneCall className="size-4 text-primary" /> Receptionist setup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5">Name *</Label>
                <Input
                  placeholder="Front Desk — Acme Dental"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label className="mb-1.5">Voice</Label>
                <VoicePicker value={voice} onChange={setVoice} />
              </div>
            </div>
            <div>
              <Label className="mb-1.5">Background sound</Label>
              <BackgroundPicker value={backgroundTrack} onChange={setBackgroundTrack} />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Subtle ambiance makes the call feel like a real workplace
                instead of a silent void.
              </p>
            </div>
            <div>
              <Label className="mb-1.5">Greeting (first sentence)</Label>
              <Input
                placeholder="Thanks for calling Acme Dental! How can I help you today?"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1.5">Prompt — how it should behave *</Label>
              <Textarea
                className="h-72 resize-none overflow-y-auto sm:h-96"
                placeholder={
                  "You're the receptionist for Acme Dental in Austin.\n" +
                  "Tone: warm and efficient. Book appointments, answer questions about " +
                  "hours (Mon–Fri 8–6) and pricing, and take a message with name + " +
                  "callback number for anything else."
                }
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={doSave} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Save receptionist
              </Button>
            </div>
          </CardContent>
        </MotionCard>

        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <MotionCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Headphones className="size-4 text-primary" /> Test in browser
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="relative">
                {testState === "live" && (
                  <>
                    <motion.span
                      className="absolute inset-0 rounded-full bg-destructive/40"
                      animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                      transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        ease: "easeOut",
                      }}
                    />
                    <motion.span
                      className="absolute inset-0 rounded-full bg-destructive/40"
                      animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                      transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        ease: "easeOut",
                        delay: 0.9,
                      }}
                    />
                  </>
                )}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.93 }}
                  onClick={browserTest}
                  disabled={testState === "connecting"}
                  className={
                    testState === "live"
                      ? "relative flex size-16 items-center justify-center rounded-full bg-destructive/20 text-destructive transition-colors hover:bg-destructive/30"
                      : "relative flex size-16 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25"
                  }
                  aria-label={testState === "live" ? "End browser test" : "Start browser test"}
                >
                  {testState === "connecting" ? (
                    <Loader2 className="size-7 animate-spin" />
                  ) : testState === "live" ? (
                    <Square className="size-6 fill-current" />
                  ) : (
                    <Mic className="size-7" />
                  )}
                </motion.button>
              </div>
              <p className="text-sm text-muted-foreground">
                {testState === "live"
                  ? "Live — talk normally, it hears you. Click the square to hang up."
                  : testState === "connecting"
                    ? "Connecting your microphone…"
                    : receptionist
                      ? "Talk to this receptionist right here — uses your current prompt, even unsaved."
                      : "Save first, then test it right here."}
              </p>
            </CardContent>
          </MotionCard>

          <MotionCard>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarCheck className="size-4 text-primary" /> Auto-schedule bookings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Create calendar bookings automatically</span>
                <Switch checked={autoBook} onCheckedChange={setAutoBook} />
              </label>
              {autoBook && (
                <>
                  <div>
                    <Label className="mb-1.5">Your booking link</Label>
                    <Input
                      placeholder="cal.com/yourname/15min"
                      value={calcomLink}
                      onChange={(e) => setCalcomLink(e.target.value)}
                    />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      No booking page yet?{" "}
                      <a
                        href="https://app.cal.com/signup"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        Create a free Cal.com account
                      </a>{" "}
                      — sign in with Google, connect your calendar when asked,
                      then paste an event link from Event Types here.
                    </p>
                  </div>
                  <div>
                    <Label className="mb-1.5">Timezone</Label>
                    <Select value={bookingTz} onValueChange={setBookingTz}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Paste your free Cal.com booking link — no API key needed.
                    Connect Google Calendar inside Cal.com once, and every
                    appointment this receptionist books lands straight on your
                    calendar, with a confirmation email to the caller.
                  </p>
                </>
              )}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  disabled={savingBooking || !receptionist}
                  title={!receptionist ? "Save the receptionist first" : undefined}
                  onClick={async () => {
                    if (!receptionist) return;
                    setSavingBooking(true);
                    try {
                      await saveBookingSettings({
                        receptionistId: receptionist._id,
                        autoBook,
                        bookingTimezone: bookingTz,
                        calcomLink: calcomLink.trim() || undefined,
                      });
                      toast.success("Booking settings saved.");
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "Couldn't save.");
                    } finally {
                      setSavingBooking(false);
                    }
                  }}
                >
                  Save booking settings
                </Button>
              </div>
            </CardContent>
          </MotionCard>

          <MotionCard>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Phone className="size-4 text-primary" /> Phone numbers
              </CardTitle>
              <Button size="sm" onClick={openBuy}>Buy number</Button>
            </CardHeader>
            <CardContent>
              {numbers.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Buy a number, connect this receptionist, and it answers every
                  call. Numbers bill at their monthly cost; talk time bills
                  per-second in credits.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {numbers.map((n) => {
                    const isConnected = receptionist?.phoneNumberId === n._id;
                    return (
                      <div key={n._id} className="flex items-center justify-between gap-2 py-2.5">
                        <div>
                          <p className="font-mono text-sm">{n.number}</p>
                          <p className="text-xs text-muted-foreground">
                            ${n.monthlyCostUsd}/mo
                          </p>
                        </div>
                        {isConnected ? (
                          <StatusBadge status="live" />
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!receptionist}
                            title={!receptionist ? "Save the receptionist first" : undefined}
                            onClick={async () => {
                              if (!receptionist) return;
                              try {
                                await attach({
                                  receptionistId: receptionist._id,
                                  phoneNumberId: n._id,
                                });
                              } catch (e) {
                                toast.error(e instanceof Error ? e.message : "Couldn't connect.");
                                return;
                              }
                              // Push the prompt to the live line immediately —
                              // attaching without syncing leaves Bland saying
                              // "this number hasn't been set up yet".
                              try {
                                await syncReceptionist({
                                  phoneNumber: n.number,
                                  prompt,
                                  voice,
                                  backgroundTrack,
                                  greeting: greeting || undefined,
                                });
                                toast.success(
                                  `Connected — ${name || "this receptionist"} now answers ${n.number}.`,
                                );
                              } catch (e) {
                                toast.error(
                                  `Connected in the app, but pushing the prompt to the line failed${e instanceof Error ? `: ${e.message}` : ""} — press Save to retry.`,
                                );
                              }
                            }}
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </MotionCard>
        </div>

        {receptionist && (
          <motion.div variants={fadeUp} className="lg:col-span-5">
            <RecentCalls receptionistId={receptionist._id} />
          </motion.div>
        )}
      </motion.div>

      <Dialog open={buyOpen} onOpenChange={setBuyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy a phone number</DialogTitle>
            <DialogDescription>
              A dedicated US (+1) number for your AI receptionist
              {priceCredits ? (
                <> — {priceCredits.toLocaleString()} credits/month.</>
              ) : (
                "."
              )}
            </DialogDescription>
          </DialogHeader>
          <div>
            {boughtNumber ? (
              <div className="rounded-lg border border-primary/40 bg-primary/10 p-4 text-center">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Your new number
                </p>
                <p className="mt-1 font-mono text-2xl font-semibold text-primary">
                  {boughtNumber}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Connect it to this receptionist below and it starts answering.
                </p>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    placeholder="Area code, e.g. 415"
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void searchNumbers(areaCode);
                    }}
                    inputMode="numeric"
                    className="max-w-[160px]"
                  />
                  <Button
                    variant="outline"
                    onClick={() => searchNumbers(areaCode)}
                    disabled={searching}
                  >
                    {searching && <Loader2 className="size-4 animate-spin" />}
                    Search
                  </Button>
                </div>
                <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border">
                  {searching ? (
                    <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Finding
                      available numbers…
                    </p>
                  ) : searchError ? (
                    <p className="px-4 py-6 text-center text-sm text-destructive">
                      {searchError}
                    </p>
                  ) : !available || available.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                      No numbers in stock for that area code — try another
                      (650, 302, 605…).
                    </p>
                  ) : (
                    <div className="divide-y divide-border">
                      {available.map((n) => (
                        <div
                          key={n.phone_number}
                          className="flex items-center justify-between gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-medium">
                              {n.friendly_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {n.location}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            {priceCredits !== null && (
                              <span className="text-xs text-muted-foreground">
                                {priceCredits.toLocaleString()} cr/mo
                              </span>
                            )}
                            <Button
                              size="sm"
                              onClick={() => doBuy(n.phone_number)}
                              disabled={buying !== null}
                            >
                              {buying === n.phone_number && (
                                <Loader2 className="size-4 animate-spin" />
                              )}
                              Buy
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Billed monthly from your credits. If a purchase fails, the
                  credits bounce straight back.
                </p>
              </>
            )}
          </div>
          <DialogFooter>
            {boughtNumber ? (
              <Button onClick={() => setBuyOpen(false)}>Done</Button>
            ) : (
              <Button variant="outline" onClick={() => setBuyOpen(false)}>
                Cancel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {receptionist?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops answering its number and its configuration is removed.
              Call history stays in your records. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!receptionist) return;
                try {
                  await deleteReceptionist({ id: receptionist._id });
                  toast.success("Receptionist deleted.");
                  onBack();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Delete failed.");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Per-receptionist call history ───────────────────────────────────────

type CallAnalysis = {
  summary?: string;
  callerName?: string | null;
  callerPhone?: string | null;
  callerEmail?: string | null;
  intent?: string;
  bookingMade?: boolean;
  bookingService?: string | null;
  bookingTime?: string | null;
  bookingNotes?: string | null;
  followUpNeeded?: boolean;
  autoBooking?: {
    status: "booked" | "failed" | "skipped" | "pending";
    detail?: string;
  };
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function RecentCalls({ receptionistId }: { receptionistId: Id<"receptionists"> }) {
  const callsQuery = useQuery(api.voice.listReceptionistCalls, { receptionistId });
  const calls = callsQuery ?? [];
  const retryAutoBook = useMutation(api.voice.retryAutoBook);
  const [openId, setOpenId] = useState<Id<"calls"> | null>(null);
  const open = calls.find((c) => c._id === openId) ?? null;
  const analysis = (open?.result ?? null) as CallAnalysis | null;

  const retryBooking = async () => {
    if (!open) return;
    try {
      await retryAutoBook({ callId: open._id });
      toast.success("Booking again — the result appears in a few seconds.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't retry the booking.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" /> Recent calls
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {callsQuery === undefined ? (
          <ListSkeleton rows={3} inCard={false} />
        ) : calls.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No calls yet for this receptionist — run a browser test or connect
            a number. Every call lands here with its transcript and booking
            details.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {calls.map((c) => {
              const a = (c.result ?? null) as CallAnalysis | null;
              return (
                <button
                  key={c._id}
                  onClick={() => setOpenId(c._id)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {a?.callerName ?? (c.isTest ? "Browser test" : "Caller")}
                      {a?.intent && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          {a.intent}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(c._creationTime).toLocaleString()} ·{" "}
                      {c.status === "in_progress"
                        ? "processing…"
                        : formatDuration(c.durationSec)}
                      {c.costCredits > 0 && ` · ${c.costCredits} credits`}
                    </p>
                  </div>
                  {a?.bookingMade && (
                    <Badge className="shrink-0 bg-emerald-500/15 text-emerald-400">
                      <CalendarCheck className="size-3" /> Booked
                    </Badge>
                  )}
                  {c.isTest && (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground">
                      Test
                    </Badge>
                  )}
                  <StatusBadge status={c.status} className="shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {analysis?.callerName ?? (open?.isTest ? "Browser test call" : "Call")}
            </DialogTitle>
            <DialogDescription>
              {open &&
                `${new Date(open._creationTime).toLocaleString()} · ${
                  open.status === "in_progress"
                    ? "still processing"
                    : formatDuration(open.durationSec)
                }${open.costCredits > 0 ? ` · ${open.costCredits} credits` : ""}`}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {open?.status === "in_progress" && (
              <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-3 text-sm text-sky-300">
                Fetching the transcript and extracting details — this updates
                automatically in a few seconds.
              </p>
            )}

            {analysis?.bookingMade && (
              <div className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <CalendarCheck className="size-3.5" /> Booking details
                </p>
                <dl className="space-y-1 text-sm">
                  {analysis.bookingService && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Service</dt><dd>{analysis.bookingService}</dd></div>
                  )}
                  {analysis.bookingTime && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">When</dt><dd>{analysis.bookingTime}</dd></div>
                  )}
                  {analysis.callerName && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Name</dt><dd>{analysis.callerName}</dd></div>
                  )}
                  {analysis.callerPhone && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Callback</dt><dd>{analysis.callerPhone}</dd></div>
                  )}
                  {analysis.callerEmail && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Email</dt><dd>{analysis.callerEmail}</dd></div>
                  )}
                  {analysis.bookingNotes && (
                    <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Notes</dt><dd>{analysis.bookingNotes}</dd></div>
                  )}
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-muted-foreground">Calendar</dt>
                    <dd
                      className={
                        analysis.autoBooking?.status === "booked"
                          ? "text-emerald-400"
                          : analysis.autoBooking?.status === "pending"
                            ? "text-sky-300"
                            : "text-primary"
                      }
                    >
                      {!analysis.autoBooking
                        ? "Not booked automatically"
                        : analysis.autoBooking.status === "booked"
                          ? `On your calendar ✓ ${analysis.autoBooking.detail ?? ""}`
                          : (analysis.autoBooking.detail ?? analysis.autoBooking.status)}
                    </dd>
                  </div>
                </dl>
                {analysis.autoBooking?.status !== "booked" &&
                  analysis.autoBooking?.status !== "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2.5"
                      onClick={retryBooking}
                    >
                      <RotateCw className="size-3.5" />
                      {analysis.autoBooking ? "Book again" : "Book on calendar"}
                    </Button>
                  )}
              </div>
            )}

            {analysis?.summary && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Summary
                </p>
                <p className="text-sm">{analysis.summary}</p>
                {analysis.followUpNeeded && (
                  <p className="mt-1.5 text-xs text-primary">
                    Follow-up needed — the caller expects to hear back.
                  </p>
                )}
              </div>
            )}

            {open?.transcript && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Transcript
                </p>
                <CallTranscript
                  transcript={open.transcript}
                  aiLabel="Receptionist"
                  callerLabel="Caller"
                />
              </div>
            )}

            {open?.status === "completed" && !open.transcript && (
              <p className="text-sm text-muted-foreground">
                No transcript was captured for this call.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

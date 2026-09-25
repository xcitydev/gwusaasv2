"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Bot, Images, Sparkles } from "lucide-react";
import { APP_NAV, filterNav, type NavItem } from "@/lib/nav";
import { hasConvex, isConfigured } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import {
  EASE,
  Eyebrow,
  GlowCard,
  Item,
  Reveal,
  Stagger,
  TileVideo,
} from "@/components/marketing/primitives";
import { LiveStats } from "@/components/dashboard/live-stats";

/** Section accents so the shortcut wall reads as a map, not a list. */
const SECTION_STYLE: Record<string, { blob: string; label: string }> = {
  "Marketing AI Hub": { blob: "from-primary/35 to-transparent", label: "Marketing AI Hub" },
  "Meeting tools": { blob: "from-sky-400/30 to-transparent", label: "Meetings" },
  "Create with AI": { blob: "from-fuchsia-400/30 to-transparent", label: "Create with AI" },
  "GWU Onboarding Forms": { blob: "from-emerald-400/30 to-transparent", label: "Done for you" },
  Earn: { blob: "from-rose-400/30 to-transparent", label: "Earn" },
};

const STUDIO_CLIPS = [
  { clip: "soul-2", label: "Soul 2", tag: "Image" },
  { clip: "cinema-studio", label: "Cinema Studio 4.0", tag: "Video" },
  { clip: "genjutsu", label: "Genjutsu", tag: "Motion transfer" },
  { clip: "kling-motion", label: "Kling 3.0 Motion Control", tag: "Motion" },
];

const HERO_MODELS = ["Kling 3.0", "Seedance 2.5", "Cinema Studio 4.0", "Soul 2", "Veo 3", "FLUX Pro"];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function DashboardClient() {
  const me = useQuery(api.users.me, isConfigured ? {} : "skip");
  const firstName = me?.name?.split(" ")[0];
  const sections = filterNav(APP_NAV, { formsAccess: !isConfigured || Boolean(me?.formsAccess) }).filter(
    (s) => s.section !== "" && s.section !== "Account",
  );

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything happening across your workspace, at a glance.
        </p>
      </motion.div>

      <LiveStats />

      {/* AI Hub banner */}
      <Reveal>
        <Link
          href="/create"
          className="group relative block overflow-hidden rounded-3xl border border-primary/25 bg-black shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] transition-colors hover:border-primary/60"
        >
          <div className="absolute inset-0">
            <TileVideo
              src="/hero.mp4"
              poster="/hero-poster.jpg"
              className="transition-transform duration-[1600ms] group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent" />
          </div>
          <div className="relative flex min-h-[300px] flex-col justify-between gap-8 p-6 sm:min-h-[340px] sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <Eyebrow>
                <Bot className="size-3.5" /> Your AI Hub
              </Eyebrow>
              <div className="hidden flex-wrap justify-end gap-1.5 sm:flex">
                {HERO_MODELS.map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] text-white/85 backdrop-blur"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <div className="max-w-2xl">
              <h2 className="text-3xl font-black uppercase leading-[0.95] tracking-tight sm:text-5xl">
                <span className="bg-gradient-to-b from-[#fff4c2] via-primary to-[#8a6905] bg-clip-text text-transparent">
                  Make something today.
                </span>
              </h2>
              <p className="mt-3 max-w-xl text-sm text-white/80 sm:text-base">
                Describe it in a sentence. The Hub picks the right model, shows the exact
                price, and renders it here — images, video, motion control and Studio.
              </p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform group-hover:translate-x-0.5">
                Open the AI Hub <ArrowRight className="size-4" />
              </span>
            </div>
          </div>
        </Link>
      </Reveal>

      {/* Shortcut wall */}
      <section>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Everything in your workspace</h2>
            <p className="text-sm text-muted-foreground">
              Every tool, one click away.
            </p>
          </div>
        </div>
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.section}>
              <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80">
                {SECTION_STYLE[section.section]?.label ?? section.section}
              </p>
              <Stagger className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {section.items.map((item) => (
                  <Item key={item.href} className="h-full">
                    <ShortcutCard item={item} blob={SECTION_STYLE[section.section]?.blob} />
                  </Item>
                ))}
              </Stagger>
            </div>
          ))}
        </div>
      </section>

      {/* Studio showcase */}
      <Reveal>
        <GlowCard className="p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary">
                <Sparkles className="size-6" />
              </span>
              <div>
                <h2 className="text-xl font-semibold">Create with AI + Studio</h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Images, video, motion control and the Higgsfield Studio models — priced
                  per generation, no separate subscriptions.
                </p>
              </div>
            </div>
            <Link
              href="/create"
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              Open studio <ArrowUpRight className="size-4" />
            </Link>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STUDIO_CLIPS.map((tile) => (
              <Link
                key={tile.clip}
                href="/create"
                className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-white/10 bg-secondary"
              >
                <TileVideo
                  src={`/models/${tile.clip}.mp4`}
                  poster={`/models/${tile.clip}.jpg`}
                  className="transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
                <span className="absolute left-3 top-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
                  {tile.tag}
                </span>
                <span className="absolute inset-x-3 bottom-3 truncate text-sm font-medium text-white">
                  {tile.label}
                </span>
              </Link>
            ))}
          </div>
        </GlowCard>
      </Reveal>

      {hasConvex && <RecentRenders />}
    </div>
  );
}

function ShortcutCard({ item, blob }: { item: NavItem; blob?: string }) {
  return (
    <Link
      href={item.href}
      className="group relative flex h-full items-start gap-3.5 overflow-hidden rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_18px_50px_-30px_rgba(234,197,79,0.45)]"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-gradient-to-br opacity-60 blur-2xl transition-opacity group-hover:opacity-100",
          blob ?? "from-primary/30 to-transparent",
        )}
      />
      <span className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary">
        <item.icon className="size-5" />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{item.label}</span>
          {item.badge && (
            <span className="rounded-full border border-primary/40 px-1.5 py-0 text-[10px] text-primary">
              {item.badge}
            </span>
          )}
        </span>
        {item.description && (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
            {item.description}
          </span>
        )}
      </span>
      <ArrowRight className="relative mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </Link>
  );
}

function RecentRenders() {
  const generations = useQuery(api.generations.list);
  const recent = (generations ?? []).filter((g) => g.status === "done" && g.resultUrl).slice(0, 6);
  if (recent.length === 0) return null;
  return (
    <Reveal>
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Images className="size-4 text-primary" /> Your latest renders
            </h2>
            <p className="text-sm text-muted-foreground">Fresh from the Hub and the Studio.</p>
          </div>
          <Link
            href="/create"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Open Library
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {recent.map((g) => {
            const isVideo = g.kind === "video" || g.kind === "motion";
            return (
              <a
                key={g._id}
                href={g.resultUrl!}
                target="_blank"
                rel="noopener noreferrer"
                title={g.prompt}
                className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-secondary"
              >
                {isVideo ? (
                  <video
                    src={g.resultUrl!}
                    muted
                    playsInline
                    preload="metadata"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.resultUrl!}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                )}
              </a>
            );
          })}
        </div>
      </section>
    </Reveal>
  );
}

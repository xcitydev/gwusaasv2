"use client";

import { useState } from "react";
import { promptTopUpIfInsufficient } from "@/lib/top-up-prompt";
import { useAction, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  AtSign,
  BadgeCheck,
  Copy,
  Download,
  History,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { downloadCsv, toCsv } from "@/lib/csv";
import { hasConvex } from "@/lib/runtime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  username: string;
  fullName: string;
  biography: string;
  followersCount: number;
  followsCount: number;
  postsCount: number;
  externalUrl: string;
  verified: boolean;
  isPrivate: boolean;
  isBusinessAccount: boolean;
  businessCategoryName: string;
  profileUrl: string;
  comment: string;
  commentLikes: number;
  commentAt: string;
  commentCount: number;
  profileMissing: boolean;
};

const CSV_HEADERS = [
  "username",
  "profile_url",
  "full_name",
  "bio",
  "followers",
  "following",
  "posts",
  "link_in_bio",
  "verified",
  "private",
  "business_category",
  "comment",
  "comment_likes",
  "comment_at",
  "comments_by_user",
];

const POST_URL = /^https?:\/\/(www\.)?instagram\.com\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+/i;

function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Leads → IG Commenters: paste a post or reel link, get every commenter's
 * username, bio, follower count and link in bio, plus what they said.
 * Two Apify runs behind the scenes (comments, then profiles); credits are
 * charged per profile actually returned.
 */
export function IgCommenters() {
  if (!hasConvex) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Connect Convex to use the Instagram commenter scraper.
        </CardContent>
      </Card>
    );
  }
  return <Live />;
}

function Live() {
  const start = useAction(api.igCommenters.start);
  const pricing = useQuery(api.igCommenters.pricing);
  const recent = useQuery(api.igCommenters.recent) ?? [];
  const [postUrl, setPostUrl] = useState("");
  const [limitChoice, setLimitChoice] = useState("100");
  const [starting, setStarting] = useState(false);
  const [activeId, setActiveId] = useState<Id<"igCommentScrapes"> | null>(null);
  const job = useQuery(api.igCommenters.get, activeId ? { id: activeId } : "skip");

  const limit = Math.max(1, Math.min(500, Math.round(Number(limitChoice) || 100)));
  const commentRate = pricing?.comment ?? 1.17;
  const profileRate = pricing?.profile ?? 0.72;
  const perCommenter = job?.creditCostPerProfile ?? pricing?.perCommenter ?? commentRate + profileRate;
  const worstCase = Math.ceil(limit * (commentRate + profileRate));
  const validUrl = POST_URL.test(postUrl.trim());

  const run = async () => {
    if (!validUrl) {
      toast.error("Paste an Instagram post or reel link (instagram.com/p/… or /reel/…).");
      return;
    }
    setStarting(true);
    try {
      const res = await start({ postUrl: postUrl.trim(), limit });
      setActiveId(res.jobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (promptTopUpIfInsufficient(e, "This scrape")) return;
      toast.error(
        msg.includes("INSUFFICIENT_CREDITS")
          ? `Not enough credits — this run can cost up to ${worstCase}. Top up in Settings or lower the comment count.`
          : msg.includes("NOT_CONFIGURED")
            ? "The scraper isn't connected yet — set APIFY_API_TOKEN on the Convex deployment."
            : msg || "Couldn't start the scrape. Try again.",
      );
    } finally {
      setStarting(false);
    }
  };

  const rows: Row[] = ((job?.results as Row[] | undefined) ?? []);

  const exportCsv = () => {
    const csv = toCsv(
      CSV_HEADERS,
      rows.map((r) => [
        r.username,
        r.profileUrl,
        r.fullName,
        r.biography,
        String(r.followersCount),
        String(r.followsCount),
        String(r.postsCount),
        r.externalUrl,
        r.verified ? "yes" : "no",
        r.isPrivate ? "yes" : "no",
        r.businessCategoryName,
        r.comment,
        String(r.commentLikes),
        r.commentAt,
        String(r.commentCount),
      ]),
    );
    downloadCsv(`ig-commenters-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  };

  const copyUsernames = async () => {
    await navigator.clipboard.writeText(rows.map((r) => `@${r.username}`).join("\n"));
    toast.success(`Copied ${rows.length} username${rows.length === 1 ? "" : "s"}`);
  };

  return (
    <div>
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="py-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl italic">Who&apos;s commenting on that post?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste any public Instagram post or reel. We pull every comment, then each
              commenter&apos;s bio, follower count and link in bio — a ready-made list of
              people already engaging with your niche.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <AtSign className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
                <Input
                  value={postUrl}
                  onChange={(e) => setPostUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="https://www.instagram.com/p/…"
                  className="h-11 pl-9"
                  aria-label="Instagram post or reel link"
                />
              </div>
              <Input
                type="number"
                min={1}
                max={500}
                inputMode="numeric"
                value={limitChoice}
                onChange={(e) => setLimitChoice(e.target.value)}
                aria-label="Max comments (up to 500)"
                title="How many comments to scrape (up to 500)"
                className="h-11 w-24 shrink-0 text-center"
              />
              <Button onClick={run} disabled={starting} className="h-11 px-5">
                {starting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageCircle className="size-4" />
                )}
                Scrape commenters
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              About {perCommenter.toFixed(2)} credits per commenter ({commentRate} per comment
              scraped + {profileRate} per profile found), billed on the real counts when the
              run finishes — at most {worstCase} for {limit} comments. Replies to comments
              aren&apos;t included.
            </p>
          </div>
        </CardContent>
      </Card>

      {job && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-primary/15 text-primary">Instagram commenters</Badge>
            <a
              href={job.postUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-md truncate text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {job.postUrl}
            </a>
            {job.status === "done" && (
              <span className="text-xs text-muted-foreground">
                · {job.commentCount ?? 0} comment{job.commentCount === 1 ? "" : "s"} ·{" "}
                {job.resultCount} profile{job.resultCount === 1 ? "" : "s"}
                {job.creditsSpent ? ` · ${job.creditsSpent} credits` : ""}
              </span>
            )}
          </div>

          {job.status === "running" && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="font-medium">
                  {job.step === "comments"
                    ? "Scraping comments…"
                    : `Pulling bios for ${job.commentCount ?? 0} commenters…`}
                </p>
                <p className="text-sm text-muted-foreground">
                  Usually 2–5 minutes — results appear here automatically, and you can
                  leave this page.
                </p>
              </CardContent>
            </Card>
          )}

          {job.status === "failed" && (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertTriangle className="size-6 text-destructive" />
                <p className="font-medium">Scrape failed</p>
                <p className="max-w-md text-sm text-muted-foreground">{job.error}</p>
                <Button variant="outline" onClick={run}>
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </CardContent>
            </Card>
          )}

          {job.status === "done" && (
            <>
              {job.warning && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary">
                  <AlertTriangle className="size-4 shrink-0" />
                  {job.warning}
                </div>
              )}
              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Username</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead className="min-w-64">Bio</TableHead>
                        <TableHead className="text-right">Followers</TableHead>
                        <TableHead>Link in bio</TableHead>
                        <TableHead className="min-w-56">Comment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                            No commenters found — is the post public, and does it have comments?
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map((r) => (
                        <TableRow key={r.username} className={r.profileMissing ? "opacity-60" : undefined}>
                          <TableCell className="font-medium">
                            <a
                              href={r.profileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:text-primary"
                            >
                              @{r.username}
                              {r.verified && <BadgeCheck className="size-3.5 text-sky-400" aria-label="Verified" />}
                              {r.isPrivate && <Lock className="size-3 text-muted-foreground" aria-label="Private account" />}
                            </a>
                            {r.commentCount > 1 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">×{r.commentCount}</span>
                            )}
                          </TableCell>
                          <TableCell>{r.fullName || "—"}</TableCell>
                          <TableCell className="max-w-md">
                            {r.profileMissing ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                Profile unavailable
                              </Badge>
                            ) : (
                              <p className="line-clamp-2 whitespace-pre-line text-sm" title={r.biography}>
                                {r.biography || "—"}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.profileMissing ? "—" : compact(r.followersCount)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.externalUrl ? (
                              <a
                                href={r.externalUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline-offset-4 hover:text-primary hover:underline"
                              >
                                {hostOf(r.externalUrl)}
                              </a>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="max-w-sm">
                            <p className="line-clamp-2 text-sm text-muted-foreground" title={r.comment}>
                              {r.comment || "—"}
                            </p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              {rows.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {rows.length} commenter{rows.length === 1 ? "" : "s"}
                    {rows.some((r) => r.profileMissing) &&
                      ` · ${rows.filter((r) => r.profileMissing).length} without a reachable profile`}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={copyUsernames}>
                      <Copy className="size-4" /> Copy usernames
                    </Button>
                    <Button onClick={exportCsv}>
                      <Download className="size-4" /> Export CSV
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium uppercase tracking-widest text-muted-foreground">
            <History className="size-3.5" /> Recent scrapes
          </h3>
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {recent.map((r) => (
                <button
                  key={r._id}
                  onClick={() => setActiveId(r._id)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.postUrl}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(r._creationTime).toLocaleString()}
                      {r.status === "done" && ` · ${r.resultCount} profiles`}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      r.status === "failed"
                        ? "border-destructive/40 text-destructive"
                        : r.status === "running"
                          ? "border-primary/40 text-primary"
                          : "text-muted-foreground"
                    }
                  >
                    {r.status}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

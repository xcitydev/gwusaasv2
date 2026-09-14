"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  FlaskConical,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { LEAD_SOURCES, leadSourceMeta, type LeadSourceId } from "@/lib/lead-sources";
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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type ResultRow = {
  email: string;
  name: string;
  company: string;
  title: string;
  location: string;
  industry: string;
  website: string;
  phone: string;
  duplicate: boolean;
  noEmail: boolean;
};

const EXAMPLES = [
  "Med spas in Miami, Florida",
  "Realtors in 33139, 33140",
  "Marketing directors at SaaS companies in the USA",
];

export function AiSearch() {
  const startSearch = useAction(api.ai.leadSearch);
  const importFromSearch = useMutation(api.leadSearches.importFromSearch);
  const [query, setQuery] = useState("");
  const [limitChoice, setLimitChoice] = useState("auto");
  const [sourceChoice, setSourceChoice] = useState<"auto" | LeadSourceId>("auto");
  const [starting, setStarting] = useState(false);
  const [activeId, setActiveId] = useState<Id<"leadSearches"> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const search = useQuery(
    api.leadSearches.get,
    activeId ? { id: activeId } : "skip",
  );

  const start = async (forceSource?: LeadSourceId) => {
    if (!query.trim()) return;
    setStarting(true);
    setSelected(new Set());
    try {
      const parsedLimit = Math.round(Number(limitChoice));
      // Explicit re-run override > upfront picker > AI auto-routing.
      const picked =
        forceSource ?? (sourceChoice !== "auto" ? sourceChoice : undefined);
      const res = await startSearch({
        query,
        forceSource: picked === "sample" ? undefined : picked,
        ...(Number.isFinite(parsedLimit) &&
          parsedLimit > 0 && { limit: Math.min(parsedLimit, 1000) }),
      });
      setActiveId(res.searchId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const rows: ResultRow[] = (search?.results as ResultRow[] | undefined) ?? [];
  const importable = rows.filter((r) => !r.duplicate && !r.noEmail);
  const costPerLead = search?.creditCostPerLead ?? 1;
  const source = leadSourceMeta(search?.source);
  const status = search?.status ?? (search ? "done" : null);

  const doImport = async () => {
    if (!activeId) return;
    setImporting(true);
    try {
      const { imported, skipped, creditsSpent } = await importFromSearch({
        id: activeId,
        emails: [...selected],
      });
      toast.success(
        `Imported ${imported} lead${imported === 1 ? "" : "s"}` +
          (creditsSpent > 0 ? ` for ${creditsSpent} credits` : "") +
          (skipped > 0 ? ` — ${skipped} skipped (already saved)` : ""),
      );
      setConfirmOpen(false);
      setSelected(new Set());
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.includes("INSUFFICIENT_CREDITS")
          ? "Not enough credits — top up in Settings."
          : "Import failed. Are you signed in?",
      );
    } finally {
      setImporting(false);
    }
  };

  const activeFilters = search
    ? Object.entries((search.filters ?? {}) as Record<string, unknown>).flatMap(
        ([key, value]) => {
          if (key === "source" || key === "mapsSearchString" || key === "locationQuery") return [];
          if (value === null || value === undefined) return [];
          if (Array.isArray(value)) {
            return value.length ? [`${key}: ${value.join(", ")}`] : [];
          }
          return [`${key}: ${String(value)}`];
        },
      )
    : [];

  return (
    <div>
      <Card className="border-primary/20 bg-gradient-to-b from-primary/5 to-transparent">
        <CardContent className="py-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-2xl italic">
              Describe your ideal customer
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Plain English in — the AI builds the filters and picks the best
              source: Google Maps, LinkedIn, or the B2B database.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <div className="relative min-w-52 flex-1">
                <Sparkles className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && start()}
                  placeholder="Med spas in Miami, Florida…"
                  className="h-11 pl-9"
                />
              </div>
              <Select
                value={sourceChoice}
                onValueChange={(v) => setSourceChoice(v as typeof sourceChoice)}
              >
                <SelectTrigger className="h-11 w-40 shrink-0" aria-label="Lead source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (AI picks)</SelectItem>
                  {LEAD_SOURCES.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                value={limitChoice === "auto" ? "" : limitChoice}
                onChange={(e) => setLimitChoice(e.target.value || "auto")}
                placeholder="Auto"
                aria-label="How many leads (up to 1000)"
                className="h-11 w-24 shrink-0 text-center"
                title="How many leads to fetch (up to 1000). Empty = Auto (50, or the number in your query)."
              />
              <Button onClick={() => start()} disabled={starting} className="h-11 px-5">
                {starting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Search
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setQuery(example)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {search && (
        <div className="mt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className="bg-primary/15 text-primary">
              Source: {source.label}
            </Badge>
            {activeFilters.map((f) => (
              <Badge key={f} variant="outline" className="border-primary/40 text-primary">
                {f}
              </Badge>
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                  <RefreshCw className="size-3" /> Different source
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {LEAD_SOURCES.filter((s) => s.id !== search.source).map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => start(s.id)}>
                    <div>
                      <p className="text-sm">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.blurb}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {status === "running" && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="font-medium">Searching {source.label}…</p>
                <p className="text-sm text-muted-foreground">
                  {source.etaLabel} — results appear here automatically, and
                  you can leave this page.
                </p>
              </CardContent>
            </Card>
          )}

          {status === "failed" && (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertTriangle className="size-6 text-destructive" />
                <p className="font-medium">Search failed</p>
                <p className="max-w-md text-sm text-muted-foreground">{search.error}</p>
                <Button variant="outline" onClick={() => start()}>
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </CardContent>
            </Card>
          )}

          {status === "done" && (
            <>
              {search.warning && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-xs text-primary">
                  <AlertTriangle className="size-4 shrink-0" />
                  {search.warning}
                </div>
              )}
              {search.sample && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-4 py-2.5 text-xs text-sky-300">
                  <FlaskConical className="size-4 shrink-0" />
                  Sample results — this source isn&apos;t connected yet. Set
                  APIFY_API_TOKEN / EXPLORIUM_API_KEY on the Convex deployment
                  to search real leads.
                </div>
              )}

              <Card>
                <CardContent className="overflow-x-auto p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <Checkbox
                            checked={importable.length > 0 && selected.size === importable.length}
                            onCheckedChange={(checked) =>
                              setSelected(
                                checked
                                  ? new Set(importable.map((r) => r.email))
                                  : new Set(),
                              )
                            }
                            aria-label="Select all importable"
                          />
                        </TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                            No results — try a broader search or another source.
                          </TableCell>
                        </TableRow>
                      )}
                      {rows.map((r, i) => (
                        <TableRow
                          key={`${r.email}-${i}`}
                          className={r.duplicate || r.noEmail ? "opacity-50" : undefined}
                        >
                          <TableCell>
                            <Checkbox
                              disabled={r.duplicate || r.noEmail}
                              checked={selected.has(r.email)}
                              onCheckedChange={(checked) => {
                                const next = new Set(selected);
                                if (checked) next.add(r.email);
                                else next.delete(r.email);
                                setSelected(next);
                              }}
                              aria-label={`Select ${r.name}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{r.name || "—"}</TableCell>
                          <TableCell>{r.company || "—"}</TableCell>
                          <TableCell>{r.title || "—"}</TableCell>
                          <TableCell>{r.location || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.noEmail ? (
                              <Badge variant="outline" className="text-muted-foreground">
                                No email
                              </Badge>
                            ) : (
                              <span className="flex items-center gap-2">
                                {r.email}
                                {r.duplicate && (
                                  <Badge variant="outline" className="border-primary/40 text-primary">
                                    Already saved
                                  </Badge>
                                )}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{r.phone || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selected.size} of {importable.length} importable selected
                  {rows.length !== importable.length &&
                    ` (${rows.length - importable.length} duplicates or missing email)`}
                </p>
                <Button onClick={() => setConfirmOpen(true)} disabled={selected.size === 0}>
                  Import {selected.size} — {selected.size * costPerLead} credit
                  {selected.size * costPerLead === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Import {selected.size} lead{selected.size === 1 ? "" : "s"} for{" "}
              {selected.size * costPerLead} credit{selected.size * costPerLead === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {source.label} leads cost {costPerLead} credit{costPerLead === 1 ? "" : "s"} each.
              Duplicates are skipped automatically and never charged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doImport} disabled={importing}>
              {importing && <Loader2 className="size-4 animate-spin" />} Import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

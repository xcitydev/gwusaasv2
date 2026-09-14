"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { downloadCsv, parseCsv, toCsv } from "@/lib/csv";
import { leadSourceMeta, LEAD_SOURCES } from "@/lib/lead-sources";
import { ListSkeleton } from "@/components/list-skeleton";
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
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CSV_COLUMNS = ["email", "name", "company", "title", "phone", "location", "industry", "website"];
const PAGE_SIZE = 50;
const ALL_KEY = "__all__";

type Lead = Doc<"leads">;

function sourceLabel(source: string): string {
  if (LEAD_SOURCES.some((s) => s.id === source)) return leadSourceMeta(source).label;
  const labels: Record<string, string> = {
    csv: "CSV import",
    quick_add: "Quick add",
    ai_search: "AI search",
    sample: "Sample data",
  };
  return labels[source] ?? source.replace(/_/g, " ");
}

function groupKey(lead: Lead): string {
  return lead.sourceDetail ?? `src:${lead.source}`;
}

export function LeadsTable() {
  const leadsQuery = useQuery(api.leads.list);
  const leads = (leadsQuery ?? []) as Lead[];
  const importLeads = useMutation(api.leads.importLeads);
  const removeLeads = useMutation(api.leads.removeLeads);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Lists (grouped by search query / campaign / source) ────────────────
  const groupMap = new Map<
    string,
    { key: string; title: string; source: string; count: number; latest: number }
  >();
  for (const lead of leads) {
    const key = groupKey(lead);
    const existing = groupMap.get(key);
    if (existing) {
      existing.count++;
      existing.latest = Math.max(existing.latest, lead._creationTime);
    } else {
      groupMap.set(key, {
        key,
        title: lead.sourceDetail ?? sourceLabel(lead.source),
        source: lead.source,
        count: 1,
        latest: lead._creationTime,
      });
    }
  }
  const groups = [...groupMap.values()].sort((a, b) => b.latest - a.latest);

  const activeTitle =
    activeGroup === ALL_KEY
      ? "All leads"
      : groups.find((g) => g.key === activeGroup)?.title ?? "Leads";

  const groupLeads =
    activeGroup === ALL_KEY ? leads : leads.filter((l) => groupKey(l) === activeGroup);

  const filtered = groupLeads.filter((lead) => {
    const q = search.toLowerCase();
    return (
      !q ||
      [
        lead.email, lead.name, lead.company, lead.title, lead.phone,
        lead.location, lead.industry, lead.sourceDetail, lead.source,
      ].some((field) => (field ?? "").toLowerCase().includes(q))
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const openGroup = (key: string) => {
    setActiveGroup(key);
    setPage(1);
    setSearch("");
    setSelected(new Set());
  };

  const exportCsv = () => {
    downloadCsv(
      `${activeTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      toCsv(
        CSV_COLUMNS,
        filtered.map((l) => [
          l.email, l.name, l.company, l.title, l.phone, l.location, l.industry, l.website,
        ]),
      ),
    );
  };

  const downloadSample = () => {
    downloadCsv(
      "leads-sample.csv",
      toCsv(CSV_COLUMNS, [
        ["jane@acme.com", "Jane Doe", "Acme Inc", "Owner", "+1 555 0100", "New York, US", "Real Estate", "https://acme.com"],
      ]),
    );
  };

  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const { headers, rows } = parseCsv(await file.text());
      const emailIdx = headers.indexOf("email");
      if (emailIdx === -1) {
        toast.error('Your CSV needs an "email" column — download the sample for the format.');
        return;
      }
      const col = (row: string[], name: string) => {
        const idx = headers.indexOf(name);
        return idx === -1 ? undefined : row[idx]?.trim() || undefined;
      };
      const parsed = rows
        .map((row) => ({
          email: row[emailIdx]?.trim() ?? "",
          name: col(row, "name"),
          company: col(row, "company"),
          title: col(row, "title"),
          phone: col(row, "phone"),
          location: col(row, "location"),
          industry: col(row, "industry"),
          website: col(row, "website"),
        }))
        .filter((l) => l.email.includes("@"));
      if (parsed.length === 0) {
        toast.error("No valid rows found in the CSV.");
        return;
      }
      const { imported, skipped } = await importLeads({
        leads: parsed,
        source: "csv",
        chargeCredits: false,
        sourceDetail: `CSV: ${file.name}`,
      });
      toast.success(
        `Imported ${imported} lead${imported === 1 ? "" : "s"}` +
          (skipped > 0 ? ` — ${skipped} duplicates skipped` : ""),
      );
    } catch {
      toast.error("Couldn't read that CSV file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doDelete = async () => {
    await removeLeads({ ids: [...selected] as Id<"leads">[] });
    toast.success(`Deleted ${selected.size} lead${selected.size === 1 ? "" : "s"}.`);
    setSelected(new Set());
    setConfirmDelete(false);
  };

  // ── View 1: the list of lead lists ──────────────────────────────────────
  if (activeGroup === null) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={downloadSample}>
            Sample CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {leadsQuery === undefined ? (
          <ListSkeleton rows={5} />
        ) : leads.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <Users className="size-8 text-muted-foreground" />
              <p className="font-medium">No leads yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Use the AI search to find customers, or import your own CSV —
                every lead is deduped by email automatically.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              <button
                onClick={() => openGroup(ALL_KEY)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">All leads</span>
                <Badge variant="outline" className="shrink-0">{leads.length}</Badge>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              {groups.map((group) => (
                <button
                  key={group.key}
                  onClick={() => openGroup(group.key)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                    <FolderOpen className="size-4.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{group.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {sourceLabel(group.source)} ·{" "}
                      {new Date(group.latest).toLocaleDateString()}
                    </span>
                  </span>
                  <Badge variant="outline" className="shrink-0">{group.count}</Badge>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── View 2: leads inside one list, paginated ───────────────────────────
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => setActiveGroup(null)}
        >
          <ArrowLeft className="size-4" /> Lists
        </Button>
        <p className="min-w-0 flex-1 truncate font-medium">
          {activeTitle}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {filtered.length} lead{filtered.length === 1 ? "" : "s"}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete {selected.size}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-4" /> Export
          </Button>
        </div>
      </div>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search in this list…"
          className="pl-9"
        />
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={pageRows.length > 0 && pageRows.every((l) => selected.has(l._id))}
                    onCheckedChange={(checked) => {
                      const next = new Set(selected);
                      for (const row of pageRows) {
                        if (checked) next.add(row._id);
                        else next.delete(row._id);
                      }
                      setSelected(next);
                    }}
                    aria-label="Select page"
                  />
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Location</TableHead>
                {activeGroup === ALL_KEY && <TableHead>Source</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((lead) => (
                <TableRow key={lead._id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(lead._id)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked) next.add(lead._id);
                        else next.delete(lead._id);
                        setSelected(next);
                      }}
                      aria-label={`Select ${lead.email}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{lead.email}</TableCell>
                  <TableCell>{lead.name ?? "—"}</TableCell>
                  <TableCell>{lead.company ?? "—"}</TableCell>
                  <TableCell>{lead.title ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{lead.phone ?? "—"}</TableCell>
                  <TableCell>{lead.location ?? "—"}</TableCell>
                  {activeGroup === ALL_KEY && (
                    <TableCell>
                      <button
                        className="max-w-44 truncate text-left text-primary hover:underline"
                        title={lead.sourceDetail ?? sourceLabel(lead.source)}
                        onClick={() => openGroup(groupKey(lead))}
                      >
                        {lead.sourceDetail ?? sourceLabel(lead.source)}
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–
          {Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} lead{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. Credits spent importing them are not refunded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

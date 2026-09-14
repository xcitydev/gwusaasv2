"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { parseCsv } from "@/lib/csv";
import { Button } from "@/components/ui/button";

/**
 * Reusable "Import CSV" button: parses the file client-side, imports through
 * the deduped leads mutation (own CSVs are free), and hands back the ids of
 * the newly created leads.
 */
export function CsvImportButton({
  onImported,
  size = "sm",
  variant = "outline",
  sourceDetail,
}: {
  onImported?: (ids: Id<"leads">[]) => void;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  /** Attribution shown in My Leads, e.g. "Campaign: Q1 Realtors". */
  sourceDetail?: string;
}) {
  const importLeads = useMutation(api.leads.importLeads);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const { headers, rows } = parseCsv(await file.text());
      const emailIdx = headers.indexOf("email");
      if (emailIdx === -1) {
        toast.error('Your CSV needs an "email" column.');
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
      const { imported, skipped, importedIds } = await importLeads({
        leads: parsed,
        source: "csv",
        chargeCredits: false,
        sourceDetail,
      });
      toast.success(
        `Imported ${imported} lead${imported === 1 ? "" : "s"}` +
          (skipped > 0 ? ` — ${skipped} duplicates skipped` : ""),
      );
      onImported?.(importedIds);
    } catch {
      toast.error("Couldn't read that CSV file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <Button
        variant={variant}
        size={size}
        disabled={importing}
        onClick={() => fileRef.current?.click()}
      >
        {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        Import CSV
      </Button>
    </>
  );
}

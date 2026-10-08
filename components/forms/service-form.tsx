"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ChevronDown, Info, Loader2 } from "lucide-react";
import type { FormDef, FormFieldDef } from "@/lib/forms-def";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type FieldValues = Record<string, string | boolean>;

function FieldLabel({ field }: { field: FormFieldDef }) {
  return (
    <label
      htmlFor={field.name}
      className="mb-2 block text-xs font-semibold uppercase tracking-wider text-foreground/80"
    >
      {field.label}
      {field.required && <span className="ml-1 text-destructive">*</span>}
    </label>
  );
}

function Callout({ callout }: { callout: NonNullable<FormFieldDef["callout"]> }) {
  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
        <Info className="size-3.5" /> {callout.title}
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        {callout.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function YesNoToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {([true, false] as const).map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "rounded-lg py-3 text-sm font-bold uppercase tracking-wider transition-colors",
            value === option
              ? "bg-primary text-primary-foreground"
              : "bg-input text-muted-foreground hover:bg-accent",
          )}
        >
          {option ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

/** "Choose up to N" pills; the value is stored as a comma-separated string. */
function MultiSelect({
  field,
  value,
  onChange,
  inputProps,
}: {
  field: FormFieldDef;
  value: string;
  onChange: (next: string) => void;
  inputProps: Record<string, unknown>;
}) {
  const selected = value ? value.split(", ").filter(Boolean) : [];
  const atMax = field.max !== undefined && selected.length >= field.max;
  const toggle = (option: string) => {
    const next = selected.includes(option)
      ? selected.filter((o) => o !== option)
      : atMax
        ? selected
        : [...selected, option];
    onChange(next.join(", "));
  };
  return (
    <div>
      <input type="hidden" id={field.name} {...inputProps} />
      <div className="flex flex-wrap gap-2">
        {(field.options ?? []).map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              disabled={!on && atMax}
              onClick={() => toggle(option)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition-colors",
                on
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-input/30 text-foreground hover:border-primary/40",
                !on && atMax && "opacity-40",
              )}
            >
              {option}
            </button>
          );
        })}
      </div>
      {field.max !== undefined && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {selected.length}/{field.max} selected
        </p>
      )}
    </div>
  );
}

function SectionHeading({
  section,
  first,
}: {
  section: NonNullable<FormFieldDef["section"]>;
  first: boolean;
}) {
  return (
    <div className={cn("sm:col-span-2", !first && "mt-2 border-t border-border pt-6")}>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-primary">{section.title}</h2>
      {section.description && (
        <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
      )}
    </div>
  );
}

export function ServiceForm({ def }: { def: FormDef }) {
  const submit = useAction(api.forms.submit);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [fileInputs, setFileInputs] = useState<Record<string, File | null>>({});

  const defaults: FieldValues = {};
  for (const field of def.fields) {
    if (field.type === "toggle") defaults[field.name] = field.defaultValue ?? true;
    else if (field.type !== "file") defaults[field.name] = "";
  }

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors },
  } = useForm<FieldValues>({ defaultValues: defaults });
  // One subscription to the whole form instead of watch() per field: the
  // React Compiler can memoize this, and it is called once, outside the
  // per-field render helper (no hook inside a loop).
  const values = useWatch({ control });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const files: { field: string; storageId: string; name: string }[] = [];
      for (const [fieldName, file] of Object.entries(fileInputs)) {
        if (!file) continue;
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error("File upload failed");
        const { storageId } = await res.json();
        files.push({ field: fieldName, storageId, name: file.name });
      }
      await submit({
        formSlug: def.slug,
        data: values,
        files: files as never,
      });
      setDone(true);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("Not authenticated")
          ? "Please sign in to submit a request."
          : "Something went wrong submitting your request. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  });

  const registerOptions = (field: FormFieldDef) => ({
    ...(field.required && { required: `${field.label} is required` }),
    ...(field.type === "email" && {
      pattern: { value: /^\S+@\S+\.\S+$/, message: "Enter a valid email" },
    }),
    ...(field.type === "url" && {
      pattern: { value: /^https?:\/\/.+/, message: "Enter a valid link (https://…)" },
    }),
    ...(field.type === "number" && {
      pattern: { value: /^[\d,]+$/, message: "Enter a number" },
    }),
  });

  const multiselectOptions = (field: FormFieldDef) => ({
    validate: (value: unknown) => {
      const count = String(value ?? "").split(", ").filter(Boolean).length;
      if (field.required && count === 0) return `${field.label} is required`;
      if (field.max !== undefined && count > field.max) return `Choose up to ${field.max}`;
      return true;
    },
  });

  const renderField = (field: FormFieldDef, index: number) => {
    const error = errors[field.name]?.message as string | undefined;
    return (
      <Fragment key={field.name}>
      {field.section && <SectionHeading section={field.section} first={index === 0} />}
      <div className={cn(field.half && "sm:col-span-1", !field.half && "sm:col-span-2")}>
        <FieldLabel field={field} />
        {field.type === "textarea" ? (
          <Textarea
            id={field.name}
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            aria-invalid={Boolean(error)}
            {...register(field.name, registerOptions(field))}
          />
        ) : field.type === "toggle" ? (
          <YesNoToggle
            value={Boolean(values[field.name])}
            onChange={(v) => setValue(field.name, v)}
          />
        ) : field.type === "select" ? (
          <div className="relative">
            <select
              id={field.name}
              aria-invalid={Boolean(error)}
              className="h-8 w-full appearance-none rounded-lg border border-input bg-transparent px-2.5 pr-8 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
              {...register(field.name, registerOptions(field))}
            >
              <option value="">Choose…</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        ) : field.type === "multiselect" ? (
          <MultiSelect
            field={field}
            value={String(values[field.name] ?? "")}
            onChange={(next) =>
              setValue(field.name, next, { shouldValidate: true, shouldDirty: true })
            }
            inputProps={register(field.name, multiselectOptions(field))}
          />
        ) : field.type === "file" ? (
          <Input
            id={field.name}
            type="file"
            accept="image/png,image/jpeg"
            className="file:mr-3 file:text-foreground"
            onChange={(e) =>
              setFileInputs((prev) => ({
                ...prev,
                [field.name]: e.target.files?.[0] ?? null,
              }))
            }
          />
        ) : (
          <Input
            id={field.name}
            type={field.type === "password" ? "password" : "text"}
            inputMode={field.type === "number" ? "numeric" : undefined}
            placeholder={field.placeholder}
            aria-invalid={Boolean(error)}
            {...register(field.name, registerOptions(field))}
          />
        )}
        {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
        {field.helper && !error && (
          <p className="mt-1.5 text-xs italic text-muted-foreground">{field.helper}</p>
        )}
        {field.callout && <Callout callout={field.callout} />}
      </div>
      </Fragment>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{def.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{def.description}</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between border-b">
          <div>
            <CardTitle className="text-base">{def.formTitle}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fill out all required fields and submit.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/forms">
              <ArrowLeft className="size-4" /> Change Service
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={onSubmit} noValidate>
            <div className="grid gap-6 sm:grid-cols-2">
              {def.fields.map(renderField)}
            </div>
            <div className="mt-8 flex justify-end">
              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="min-w-36 font-bold"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  (def.submitLabel ?? "Submit")
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={done} onOpenChange={setDone}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-emerald-400" />{" "}
              {def.successTitle ?? "Request received"}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {def.successBody ?? (
                <>
                  Your {def.title} request is now <strong>Processing</strong>. Our
                  team reviews every request and starts once payment is confirmed —
                  you&apos;ll get a notification when it goes active.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button asChild>
              <Link href="/forms">Back to forms</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { GalleryHorizontalEnd, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import {
  CAROUSEL_TEMPLATES,
  dbToTemplate,
  TEMPLATE_SAMPLE_SLIDE,
  type CarouselTemplate,
  type DbCarouselTemplateFields,
} from "@/lib/carousel-templates";
import { IMAGE_MODELS } from "@/lib/ai-models";
import {
  CarouselSlideFrame,
  TemplateFonts,
} from "@/components/tools/carousel-slide";
import { PageHeader } from "@/components/page-header";
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

type Draft = DbCarouselTemplateFields & { published: boolean };

function draftFromBuiltIn(base: CarouselTemplate): Draft {
  return {
    name: "",
    tagline: "",
    fontsUrl: base.fontsUrl,
    display: { ...base.display },
    bodyFamily: base.bodyFamily,
    monoFamily: base.monoFamily,
    dark: base.dark,
    colors: { ...base.colors },
    artDirection: base.artDirection,
    bgModelId: base.bgModelId,
    published: true,
  };
}

function draftFromDoc(doc: Doc<"carouselTemplates">): Draft {
  return {
    name: doc.name,
    tagline: doc.tagline,
    fontsUrl: doc.fontsUrl,
    display: { ...doc.display },
    bodyFamily: doc.bodyFamily,
    monoFamily: doc.monoFamily,
    dark: doc.dark,
    colors: { ...doc.colors },
    artDirection: doc.artDirection,
    bgModelId: doc.bgModelId,
    published: doc.published,
  };
}

const COLOR_FIELDS: { key: keyof Draft["colors"]; label: string }[] = [
  { key: "ink", label: "Background" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted text" },
  { key: "accent", label: "Accent" },
  { key: "accentBright", label: "Accent bright" },
  { key: "accentDeep", label: "Accent deep" },
  { key: "accent2", label: "Second accent" },
  { key: "surface", label: "Surface" },
  { key: "line", label: "Line" },
];

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const validHex = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div>
      <Label className="mb-1 text-[11px]">{label}</Label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={validHex ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="size-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 font-mono text-xs"
        />
      </div>
    </div>
  );
}

export default function TemplatesAdminPage() {
  const templates = useQuery(api.carouselTemplates.listAll) ?? [];
  const save = useMutation(api.carouselTemplates.save);
  const remove = useMutation(api.carouselTemplates.remove);
  const [editing, setEditing] = useState<{
    id: Id<"carouselTemplates"> | null;
    draft: Draft;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Doc<"carouselTemplates"> | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = editing?.draft;
  const setDraft = (patch: Partial<Draft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  // Live preview needs a CarouselTemplate — build one from the draft.
  const previewTemplate: CarouselTemplate | null = draft
    ? dbToTemplate({ ...draft, _id: "preview" })
    : null;

  const doSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await save({ id: editing.id ?? undefined, ...editing.draft });
      toast.success(editing.id ? "Template updated." : "Template added to the library.");
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the template.");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove({ id: deleteTarget._id });
      toast.success("Template removed.");
    } catch {
      toast.error("Couldn't remove that template.");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Carousel Templates"
        description="Curate the design library users pick from in AI Tools → IG Carousels."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">New template from:</span>
        {CAROUSEL_TEMPLATES.map((base) => (
          <Button
            key={base.id}
            variant="outline"
            size="sm"
            onClick={() => setEditing({ id: null, draft: draftFromBuiltIn(base) })}
          >
            <Plus className="size-3.5" /> {base.name}
          </Button>
        ))}
      </div>

      {templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <GalleryHorizontalEnd className="size-8 text-muted-foreground" />
            <p className="font-medium">No library templates yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Start from one of the built-in styles above, tweak the fonts,
              colors and art direction, and publish it to every workspace.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {templates.map((doc) => {
            const tpl = dbToTemplate(doc);
            return (
              <Card key={doc._id} className="overflow-hidden">
                <CardContent className="p-3">
                  <TemplateFonts template={tpl} />
                  <CarouselSlideFrame
                    width={210}
                    template={tpl}
                    slide={TEMPLATE_SAMPLE_SLIDE}
                    index={0}
                    total={5}
                    handle="@yourbrand"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{doc.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{doc.tagline}</p>
                    </div>
                    <Badge variant="outline" className={doc.published ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "text-muted-foreground"}>
                      {doc.published ? "Live" : "Hidden"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditing({ id: doc._id, draft: draftFromDoc(doc) })}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(doc)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="flex max-h-[92dvh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              The preview updates live — publish when it looks right.
            </DialogDescription>
          </DialogHeader>
          {draft && previewTemplate && (
            <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto pr-1 sm:grid-cols-[1fr_240px]">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1.5">Name *</Label>
                    <Input value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="Emerald Studio" />
                  </div>
                  <div>
                    <Label className="mb-1.5">Tagline</Label>
                    <Input value={draft.tagline} onChange={(e) => setDraft({ tagline: e.target.value })} placeholder="Deep greens, studio light" />
                  </div>
                </div>
                <div>
                  <Label className="mb-1.5">Google Fonts stylesheet URL</Label>
                  <Input value={draft.fontsUrl} onChange={(e) => setDraft({ fontsUrl: e.target.value })} className="font-mono text-xs" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label className="mb-1.5">Headline font family (CSS)</Label>
                    <Input
                      value={draft.display.family}
                      onChange={(e) => setDraft({ display: { ...draft.display, family: e.target.value } })}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5">Weight</Label>
                    <Input
                      inputMode="numeric"
                      value={String(draft.display.weight)}
                      onChange={(e) => setDraft({ display: { ...draft.display, weight: Number(e.target.value) || 400 } })}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="mb-1.5">Case</Label>
                    <Select
                      value={draft.display.transform}
                      onValueChange={(vv) => setDraft({ display: { ...draft.display, transform: vv as "uppercase" | "none" } })}
                    >
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="uppercase">UPPERCASE</SelectItem>
                        <SelectItem value="none">As written</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1.5">Letter spacing</Label>
                    <Input
                      value={draft.display.letterSpacing}
                      onChange={(e) => setDraft({ display: { ...draft.display, letterSpacing: e.target.value } })}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5">Size factor</Label>
                    <Input
                      inputMode="decimal"
                      value={String(draft.display.sizeFactor)}
                      onChange={(e) => setDraft({ display: { ...draft.display, sizeFactor: Number(e.target.value) || 1 } })}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1.5">Body font family (CSS)</Label>
                    <Input value={draft.bodyFamily} onChange={(e) => setDraft({ bodyFamily: e.target.value })} className="font-mono text-xs" />
                  </div>
                  <div>
                    <Label className="mb-1.5">Mono font family (CSS)</Label>
                    <Input value={draft.monoFamily} onChange={(e) => setDraft({ monoFamily: e.target.value })} className="font-mono text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {COLOR_FIELDS.map(({ key, label }) => (
                    <ColorInput
                      key={key}
                      label={label}
                      value={draft.colors[key]}
                      onChange={(vv) => setDraft({ colors: { ...draft.colors, [key]: vv } })}
                    />
                  ))}
                </div>
                <div>
                  <Label className="mb-1.5">Art direction (steers every background image)</Label>
                  <Textarea
                    rows={3}
                    value={draft.artDirection}
                    onChange={(e) => setDraft({ artDirection: e.target.value })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1.5">Background model</Label>
                    <Select value={draft.bgModelId} onValueChange={(vv) => setDraft({ bgModelId: vv })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IMAGE_MODELS.filter((m) => !m.supportsEdit).map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end gap-3 pb-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={draft.dark}
                        onCheckedChange={(vv) => setDraft({ dark: vv })}
                      />
                      <Label>Dark theme</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={draft.published}
                        onCheckedChange={(vv) => setDraft({ published: vv })}
                      />
                      <Label>Published</Label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="sm:sticky sm:top-0">
                <TemplateFonts template={previewTemplate} />
                <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Live preview
                </p>
                <CarouselSlideFrame
                  key={JSON.stringify(draft)}
                  width={240}
                  template={previewTemplate}
                  slide={TEMPLATE_SAMPLE_SLIDE}
                  index={0}
                  total={5}
                  handle="@yourbrand"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={doSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {editing?.id ? "Save changes" : "Add to library"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{deleteTarget?.name}” from the library?</AlertDialogTitle>
            <AlertDialogDescription>
              Users won&apos;t be able to pick it anymore. Carousels already made
              with it keep rendering.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Tag, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import {
  getSettings,
  updateCustomFieldDefinitions,
  updatePipelineStages,
  updateSupportCategories,
  type CustomFieldDefinition,
  type PipelineStage,
  type SupportCategory,
} from "../lib/api";

// Master plan "CRM industry-specificity": lets a workspace configure its own sales pipeline,
// contact custom fields, and support ticket categories - replacing what used to be fixed
// platform-wide lists (see server/services/pipelineStages.js). Reuses the same self-contained,
// own-data-fetching panel pattern as WhatsAppFlowsPanel/AdsSettingsPanel.

const STAGE_TYPE_OPTIONS: { value: PipelineStage["type"]; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

const FIELD_TYPE_OPTIONS: { value: CustomFieldDefinition["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Select" },
];

function slugify(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function typeBadgeVariant(type: PipelineStage["type"]) {
  if (type === "won") return "success" as const;
  if (type === "lost") return "destructive" as const;
  return "outline" as const;
}

export function CrmSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [fields, setFields] = useState<CustomFieldDefinition[]>([]);
  const [categories, setCategories] = useState<SupportCategory[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    getSettings<{ crm?: { pipelineStages?: PipelineStage[]; customFieldDefinitions?: CustomFieldDefinition[] }; support?: { categories?: SupportCategory[] } }>()
      .then((response) => {
        if (!active) return;
        setStages(response.crm?.pipelineStages || []);
        setFields(response.crm?.customFieldDefinitions || []);
        setCategories(response.support?.categories || []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(""), 2500);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading CRM configuration…</p>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      {notice && <p className="text-xs text-primary">{notice}</p>}
      <PipelineStagesSection stages={stages} onSaved={(next) => { setStages(next); flash("Pipeline stages saved."); }} />
      <CustomFieldsSection fields={fields} onSaved={(next) => { setFields(next); flash("Custom fields saved."); }} />
      <SupportCategoriesSection categories={categories} onSaved={(next) => { setCategories(next); flash("Support categories saved."); }} />
    </div>
  );
}

function PipelineStagesSection({ stages, onSaved }: { stages: PipelineStage[]; onSaved: (stages: PipelineStage[]) => void }) {
  const [draft, setDraft] = useState<PipelineStage[]>(stages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => setDraft(stages), [stages]);

  function addStage() {
    if (!newLabel.trim()) return;
    const key = slugify(newLabel);
    if (!key || draft.some((stage) => stage.key === key)) {
      setError("That stage name isn't usable - try a different one.");
      return;
    }
    setDraft((current) => [...current, { key, label: newLabel.trim(), color: "primary", type: "open" }]);
    setNewLabel("");
    setError("");
  }

  function updateStage(index: number, patch: Partial<PipelineStage>) {
    setDraft((current) => current.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)));
  }

  function removeStage(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  function moveStage(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    setError("");
    if (!draft.length) {
      setError("At least one pipeline stage is required.");
      return;
    }
    if (!draft.some((stage) => stage.type === "won")) {
      setError("At least one stage must be typed \"Won\".");
      return;
    }
    if (!draft.some((stage) => stage.type === "lost")) {
      setError("At least one stage must be typed \"Lost\".");
      return;
    }
    setSaving(true);
    try {
      const response = await updatePipelineStages<{ pipelineStages: PipelineStage[] }>(draft);
      onSaved(response.pipelineStages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save pipeline stages.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Stages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Your own sales pipeline, shown in the Pipeline board. Every stage needs a Won or Lost
          type so revenue reporting and automation know when a deal is decided - the label can be
          anything ("Booking Confirmed", "PO Received"...), the type is what matters underneath.
        </p>
        <div className="space-y-2">
          {draft.map((stage, index) => (
            <div key={`${stage.key}-${index}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 p-2.5">
              <div className="flex flex-col gap-0.5">
                <Button type="button" variant="ghost" size="icon" className="size-6" disabled={index === 0} onClick={() => moveStage(index, -1)}>
                  <ArrowUp size={12} />
                </Button>
                <Button type="button" variant="ghost" size="icon" className="size-6" disabled={index === draft.length - 1} onClick={() => moveStage(index, 1)}>
                  <ArrowDown size={12} />
                </Button>
              </div>
              <Input
                value={stage.label}
                onChange={(e) => updateStage(index, { label: e.target.value })}
                className="h-9 max-w-[220px] flex-1"
                placeholder="Stage name"
              />
              <select
                value={stage.type}
                onChange={(e) => updateStage(index, { type: e.target.value as PipelineStage["type"] })}
                className="h-9 rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              >
                {STAGE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Badge variant={typeBadgeVariant(stage.type)}>{stage.key}</Badge>
              <Button type="button" variant="ghost" size="icon" className="ml-auto size-8 text-destructive" onClick={() => removeStage(index)}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          {draft.length === 0 && <p className="text-xs text-muted-foreground">No stages configured yet.</p>}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New stage name"
            className="h-9 max-w-[220px]"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addStage())}
          />
          <Button type="button" variant="outline" size="sm" onClick={addStage}>
            <Plus size={14} /> Add stage
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="button" size="sm" disabled={saving} onClick={save}>
          <Save size={14} /> {saving ? "Saving…" : "Save pipeline stages"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CustomFieldsSection({ fields, onSaved }: { fields: CustomFieldDefinition[]; onSaved: (fields: CustomFieldDefinition[]) => void }) {
  const [draft, setDraft] = useState<CustomFieldDefinition[]>(fields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<CustomFieldDefinition["type"]>("text");
  const [newOptions, setNewOptions] = useState("");

  useEffect(() => setDraft(fields), [fields]);

  function addField() {
    if (!newLabel.trim()) return;
    const key = slugify(newLabel);
    if (!key || draft.some((field) => field.key === key)) {
      setError("That field name isn't usable - try a different one.");
      return;
    }
    const options = newType === "select" ? newOptions.split(",").map((o) => o.trim()).filter(Boolean) : [];
    if (newType === "select" && options.length === 0) {
      setError("A select field needs at least one option (comma-separated).");
      return;
    }
    setDraft((current) => [...current, { key, label: newLabel.trim(), type: newType, options, archived: false }]);
    setNewLabel("");
    setNewOptions("");
    setError("");
  }

  function toggleArchived(index: number) {
    setDraft((current) => current.map((field, i) => (i === index ? { ...field, archived: !field.archived } : field)));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const response = await updateCustomFieldDefinitions<{ customFieldDefinitions: CustomFieldDefinition[] }>(draft);
      onSaved(response.customFieldDefinitions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save custom fields.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Contact Fields</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Extra fields specific to your business, shown on every contact (e.g. Project Name, Budget
          Range, Insurance Provider). Archiving a field hides it without deleting data already saved
          against it.
        </p>
        <div className="space-y-2">
          {draft.map((field, index) => (
            <div key={`${field.key}-${index}`} className={`flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 p-2.5 ${field.archived ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{field.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {field.type}{field.options.length ? `: ${field.options.join(", ")}` : ""}
                </p>
              </div>
              {field.archived && <Badge variant="secondary">Archived</Badge>}
              <Button type="button" variant="outline" size="sm" onClick={() => toggleArchived(index)}>
                {field.archived ? "Restore" : "Archive"}
              </Button>
            </div>
          ))}
          {draft.length === 0 && <p className="text-xs text-muted-foreground">No custom fields configured yet.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Field name" className="h-9 max-w-[200px]" />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as CustomFieldDefinition["type"])}
            className="h-9 rounded-md border border-input bg-input-background px-2 text-xs text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          >
            {FIELD_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {newType === "select" && (
            <Input
              value={newOptions}
              onChange={(e) => setNewOptions(e.target.value)}
              placeholder="Options, comma-separated"
              className="h-9 max-w-[240px]"
            />
          )}
          <Button type="button" variant="outline" size="sm" onClick={addField}>
            <Plus size={14} /> Add field
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="button" size="sm" disabled={saving} onClick={save}>
          <Save size={14} /> {saving ? "Saving…" : "Save custom fields"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SupportCategoriesSection({ categories, onSaved }: { categories: SupportCategory[]; onSaved: (categories: SupportCategory[]) => void }) {
  const [draft, setDraft] = useState<SupportCategory[]>(categories);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => setDraft(categories), [categories]);

  function addCategory() {
    if (!newLabel.trim()) return;
    const key = slugify(newLabel);
    if (!key || draft.some((category) => category.key === key)) {
      setError("That category name isn't usable - try a different one.");
      return;
    }
    setDraft((current) => [...current, { key, label: newLabel.trim() }]);
    setNewLabel("");
    setError("");
  }

  function removeCategory(index: number) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const response = await updateSupportCategories<{ categories: SupportCategory[] }>(draft);
      onSaved(response.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save support categories.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Support Ticket Categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Shown in the "New ticket" category dropdown in Support.</p>
        <div className="flex flex-wrap gap-2">
          {draft.map((category, index) => (
            <span key={`${category.key}-${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 py-1 pl-3 pr-1.5 text-xs">
              <Tag size={11} className="text-muted-foreground" />
              {category.label}
              <button type="button" onClick={() => removeCategory(index)} className="rounded-full p-0.5 text-muted-foreground hover:bg-secondary/70 hover:text-destructive">
                <Trash2 size={11} />
              </button>
            </span>
          ))}
          {draft.length === 0 && <p className="text-xs text-muted-foreground">No categories configured yet.</p>}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New category name"
            className="h-9 max-w-[220px]"
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCategory())}
          />
          <Button type="button" variant="outline" size="sm" onClick={addCategory}>
            <Plus size={14} /> Add category
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="button" size="sm" disabled={saving} onClick={save}>
          <Save size={14} /> {saving ? "Saving…" : "Save categories"}
        </Button>
      </CardContent>
    </Card>
  );
}

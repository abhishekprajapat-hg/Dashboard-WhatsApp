import { useEffect, useMemo, useState } from "react";
import { LayoutTemplate, Search, Send, X } from "lucide-react";
import { getTemplates } from "../../lib/api";
import { Input } from "../ui/input";
import type { WhatsAppTemplate } from "./types";

interface TemplatePickerModalProps {
  onClose: () => void;
  onSelect: (template: WhatsAppTemplate, parameters: string[]) => void;
}

// Approved WhatsApp templates are the only send path that still works once the 24h session window
// closes - see useWhatsAppEngine's `sessionExpired`. Deliberately fetches via GET /templates
// (permission "templates:read", which the Agent role has) rather than GET /whatsapp/templates
// (gated behind "settings:read", which neither Agent nor Manager holds) - the same data, but the
// latter would silently 403 for everyone who actually staffs the inbox day to day.
export function TemplatePickerModal({ onClose, onSelect }: TemplatePickerModalProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WhatsAppTemplate | null>(null);
  const [values, setValues] = useState<string[]>([]);

  useEffect(() => {
    getTemplates<{ data: WhatsAppTemplate[] }>({ type: "whatsapp", status: "approved" })
      .then((response) => setTemplates(response.data))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load templates."))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return templates;
    return templates.filter((template) => template.name.toLowerCase().includes(query) || template.body?.toLowerCase().includes(query));
  }, [templates, search]);

  function selectTemplate(template: WhatsAppTemplate) {
    setSelected(template);
    setValues((template.variables || []).map(() => ""));
  }

  function preview(template: WhatsAppTemplate) {
    return (template.body || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (match, index) => {
      const value = values[Number(index) - 1];
      return value ? value : match;
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Send a template</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {selected
                ? "Fill in the placeholders, then send."
                : "This contact hasn't messaged in the last 24 hours - only an approved template will deliver."}
            </p>
          </div>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {!selected && (
          <>
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" className="pl-9" />
            </div>

            {error && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
            {!error && loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading templates...</p>}
            {!error && !loading && filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No approved templates yet - create and get one approved in Settings → WhatsApp Templates first.</p>
            )}

            {!error && !loading && filtered.length > 0 && (
              <div className="space-y-1.5">
                {filtered.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="flex w-full items-start gap-3 rounded-lg border border-border/70 p-2.5 text-left hover:bg-secondary"
                    onClick={() => selectTemplate(template)}
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-primary">
                      <LayoutTemplate size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{template.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{template.body}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground/80">{template.category} - {template.language}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {selected && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-3 text-sm text-foreground">{preview(selected)}</div>

            {(selected.variables || []).length > 0 && (
              <div className="space-y-2">
                {(selected.variables || []).map((_, index) => (
                  <Input
                    key={index}
                    value={values[index] || ""}
                    onChange={(event) =>
                      setValues((current) => {
                        const next = [...current];
                        next[index] = event.target.value;
                        return next;
                      })
                    }
                    placeholder={`Value for {{${index + 1}}}`}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={() => setSelected(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                onClick={() => onSelect(selected, values)}
              >
                <Send size={14} /> Send template
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

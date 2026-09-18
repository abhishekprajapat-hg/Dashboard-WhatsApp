import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Download, FileText, Plus, Sparkles, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { Textarea } from "./ui/textarea";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import { downloadBusinessDocumentPdf, draftDocument, getContacts, getDocuments, updateDocument } from "../lib/api";

interface ContactOption {
  id: string;
  name: string;
}

interface DocumentRecord {
  id: string;
  contactId: string;
  contact?: { id: string; name: string; phone: string };
  type: "proposal";
  title: string;
  content: string;
  status: "draft" | "finalized";
  aiProvider: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentsViewProps {
  canWrite?: boolean;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function DocumentsView({ canWrite = false }: DocumentsViewProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [lockedMessage, setLockedMessage] = useState("");
  const [openDocument, setOpenDocument] = useState<DocumentRecord | null>(null);
  const [downloadingId, setDownloadingId] = useState("");

  function loadDocuments() {
    setLoading(true);
    getDocuments<{ data: DocumentRecord[] }>()
      .then((response) => setDocuments(response.data))
      .catch((error) => {
        if (isPlanLimitError(error)) setLockedMessage(error.message);
        setDocuments([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadDocuments, []);

  useEffect(() => {
    getContacts<{ data: { id: string; name: string }[] }>({ limit: 200 })
      .then((response) => setContacts(response.data.map((contact) => ({ id: contact.id, name: contact.name }))))
      .catch(() => undefined);
  }, []);

  const contactName = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);

  async function handleDownload(document: DocumentRecord) {
    setDownloadingId(document.id);
    try {
      await downloadBusinessDocumentPdf(document.id, `${document.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
    } finally {
      setDownloadingId("");
    }
  }

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="AI document drafting is locked" message={lockedMessage} icon={<Sparkles size={20} />} />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(47,168,118,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <FileText size={12} />
            Documentation
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Documents</h1>
          <p className="mt-1 text-sm text-muted-foreground">AI-drafted proposals for your customers - generate, review, and download as PDF.</p>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
          <div className="flex items-center justify-end border-b border-border/80 p-3">
            {canWrite && (
              <Button size="sm" onClick={() => setShowForm(true)} disabled={contacts.length === 0}>
                <Sparkles size={14} />
                Draft proposal
              </Button>
            )}
          </div>

          {loading ? (
            <div className="p-4">
              <LoadingSkeleton rows={6} />
            </div>
          ) : documents.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<FileText size={18} />}
                title="No documents yet"
                description="AI-drafted proposals for your customers will show up here."
                action={canWrite ? <Button onClick={() => setShowForm(true)}><Sparkles size={14} /> Draft proposal</Button> : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
                  <tr>
                    {["Title", "Customer", "Status", "Created", "Actions"].map((column) => (
                      <th key={column} className="px-3 py-3 text-left font-medium text-muted-foreground">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr key={document.id} className="group border-b border-border/70 transition-colors hover:bg-secondary/35">
                      <td className="px-3 py-3">
                        <button className="text-left font-medium text-foreground hover:underline" onClick={() => setOpenDocument(document)}>
                          {document.title}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{document.contact?.name || contactName.get(document.contactId) || "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={document.status === "finalized" ? "success" : "outline"}>{document.status === "finalized" ? "Finalized" : "Draft"}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(document.createdAt)}</td>
                      <td className="px-3 py-3">
                        <button
                          className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100 disabled:opacity-40"
                          title="Download PDF"
                          onClick={() => handleDownload(document)}
                          disabled={downloadingId === document.id}
                        >
                          <Download size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <DraftProposalModal
          contacts={contacts}
          onClose={() => setShowForm(false)}
          onCreated={(created) => {
            setDocuments((items) => [created, ...items]);
            setShowForm(false);
          }}
          onLocked={setLockedMessage}
        />
      )}

      {openDocument && (
        <DocumentDetailModal
          document={openDocument}
          canWrite={canWrite}
          onClose={() => setOpenDocument(null)}
          onSaved={(updated) => {
            setDocuments((items) => items.map((item) => (item.id === updated.id ? updated : item)));
            setOpenDocument(updated);
          }}
        />
      )}
    </div>
  );
}

function DraftProposalModal({
  contacts,
  onClose,
  onCreated,
  onLocked,
}: {
  contacts: ContactOption[];
  onClose: () => void;
  onCreated: (document: DocumentRecord) => void;
  onLocked: (message: string) => void;
}) {
  const [contactId, setContactId] = useState("");
  const [goal, setGoal] = useState("");
  const [notes, setNotes] = useState("");
  const [provider, setProvider] = useState("local");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contactId || !goal.trim()) return;

    setSaving(true);
    try {
      const response = await draftDocument<{ data: DocumentRecord }>({ contactId, goal: goal.trim(), notes, provider: provider as "local" | "openai" | "gemini" | "claude" });
      onCreated(response.data);
    } catch (error) {
      if (isPlanLimitError(error)) onLocked(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Draft a proposal</h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Customer</span>
            <select
              value={contactId}
              onChange={(event) => setContactId(event.target.value)}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
              required
            >
              <option value="">Select a customer</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">What is this proposal for?</span>
            <Input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. Solar panel installation for a 3BHK home" required />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Notes (optional)</span>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Any specifics the draft should include" rows={3} />
          </label>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">AI provider</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
            >
              <option value="local">Local template (no AI provider)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? "Drafting..." : "Draft proposal"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DocumentDetailModal({
  document,
  canWrite,
  onClose,
  onSaved,
}: {
  document: DocumentRecord;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (document: DocumentRecord) => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [saving, setSaving] = useState(false);

  async function handleSave(nextStatus?: "draft" | "finalized") {
    setSaving(true);
    try {
      const response = await updateDocument<{ data: DocumentRecord }>(document.id, { title, content, status: nextStatus });
      onSaved(response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <div className="max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">Proposal</h2>
            <Badge variant={document.status === "finalized" ? "success" : "outline"}>{document.status === "finalized" ? "Finalized" : "Draft"}</Badge>
            {document.aiProvider && <Badge variant="secondary">{document.aiProvider}</Badge>}
          </div>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Title</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canWrite} />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Content</span>
            <Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={14} disabled={!canWrite} />
          </label>
        </div>

        {canWrite && (
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => handleSave("draft")} disabled={saving}>
              Save draft
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={() => handleSave("finalized")} disabled={saving}>
              {saving ? "Saving..." : "Finalize"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

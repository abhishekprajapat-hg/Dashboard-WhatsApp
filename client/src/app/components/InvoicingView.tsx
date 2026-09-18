import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Download, FileText, Plus, Receipt, Wallet, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import { createInvoice, downloadCustomerInvoicePdf, getContacts, getInvoices, getPayments, recordPayment, updateInvoice } from "../lib/api";

interface ContactOption {
  id: string;
  name: string;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface InvoiceItem {
  id: string;
  contactId: string;
  contact?: { id: string; name: string; phone: string };
  invoiceNumber: string;
  lineItems: InvoiceLineItem[];
  currency: string;
  subtotal: number;
  taxLabel: string;
  taxAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";
  dueDate: string | null;
  issuedAt: string | null;
  notes: string;
  createdAt: string;
}

interface PaymentItem {
  id: string;
  contactId: string;
  amount: number;
  currency: string;
  method: string;
  reference: string;
  notes: string;
  receivedAt: string;
}

interface InvoicingViewProps {
  canWrite?: boolean;
}

const STATUS_BADGE: Record<InvoiceItem["status"], { variant: "outline" | "info" | "warning" | "success" | "destructive" | "secondary"; label: string }> = {
  draft: { variant: "outline", label: "Draft" },
  sent: { variant: "info", label: "Sent" },
  partially_paid: { variant: "warning", label: "Partially paid" },
  paid: { variant: "success", label: "Paid" },
  overdue: { variant: "destructive", label: "Overdue" },
  cancelled: { variant: "secondary", label: "Cancelled" },
};

function formatMoney(amount: number, currency = "INR") {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

const tabs = [
  { id: "invoices" as const, icon: <Receipt size={14} />, label: "Invoices" },
  { id: "payments" as const, icon: <Wallet size={14} />, label: "Payments" },
];

export function InvoicingView({ canWrite = false }: InvoicingViewProps) {
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [lockedMessage, setLockedMessage] = useState("");

  useEffect(() => {
    getContacts<{ data: { id: string; name: string }[] }>({ limit: 200 })
      .then((response) => setContacts(response.data.map((contact) => ({ id: contact.id, name: contact.name }))))
      .catch(() => undefined);
  }, []);

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="Invoicing is locked" message={lockedMessage} icon={<Receipt size={20} />} />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(47,168,118,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <Receipt size={12} />
            Billing
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Invoicing</h1>
          <p className="mt-1 text-sm text-muted-foreground">Invoice your own customers and record payments received from them.</p>
        </div>

        <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-subtle/70 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                tab === item.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        {tab === "invoices" ? (
          <InvoicesTab canWrite={canWrite} contacts={contacts} onLocked={setLockedMessage} />
        ) : (
          <PaymentsTab contacts={contacts} onLocked={setLockedMessage} />
        )}
      </div>
    </div>
  );
}

interface LineItemFormState {
  description: string;
  quantity: string;
  unitPrice: string;
}

interface InvoiceFormState {
  contactId: string;
  lineItems: LineItemFormState[];
  taxLabel: string;
  taxAmount: string;
  dueDate: string;
  notes: string;
}

const emptyLineItem: LineItemFormState = { description: "", quantity: "1", unitPrice: "" };
const emptyInvoiceForm: InvoiceFormState = { contactId: "", lineItems: [{ ...emptyLineItem }], taxLabel: "", taxAmount: "0", dueDate: "", notes: "" };

function InvoicesTab({ canWrite, contacts, onLocked }: { canWrite: boolean; contacts: ContactOption[]; onLocked: (message: string) => void }) {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<InvoiceFormState>(emptyInvoiceForm);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [payingInvoice, setPayingInvoice] = useState<InvoiceItem | null>(null);

  function loadInvoices() {
    setLoading(true);
    getInvoices<{ data: InvoiceItem[] }>({ status: statusFilter || undefined })
      .then((response) => setInvoices(response.data))
      .catch((error) => {
        if (isPlanLimitError(error)) onLocked(error.message);
        setInvoices([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadInvoices, [statusFilter]);

  const contactName = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);
  const outstanding = invoices.reduce((sum, invoice) => sum + (invoice.status !== "cancelled" ? invoice.balanceDue : 0), 0);
  const overdueCount = invoices.filter((invoice) => invoice.status === "overdue").length;
  const paidThisMonth = invoices
    .filter((invoice) => invoice.status === "paid" && invoice.issuedAt && new Date(invoice.issuedAt).getMonth() === new Date().getMonth())
    .reduce((sum, invoice) => sum + invoice.total, 0);

  function openCreateForm() {
    setForm(emptyInvoiceForm);
    setShowForm(true);
  }

  function updateLineItem(index: number, patch: Partial<LineItemFormState>) {
    setForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    }));
  }

  function addLineItem() {
    setForm((current) => ({ ...current, lineItems: [...current.lineItems, { ...emptyLineItem }] }));
  }

  function removeLineItem(index: number) {
    setForm((current) => ({ ...current, lineItems: current.lineItems.filter((_, itemIndex) => itemIndex !== index) }));
  }

  const formSubtotal = form.lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  const formTotal = formSubtotal + (Number(form.taxAmount) || 0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.contactId || form.lineItems.every((item) => !item.description.trim())) return;

    setSaving(true);
    try {
      const response = await createInvoice<{ data: InvoiceItem }>({
        contactId: form.contactId,
        lineItems: form.lineItems
          .filter((item) => item.description.trim())
          .map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity) || 1, unitPrice: Number(item.unitPrice) || 0 })),
        taxLabel: form.taxLabel,
        taxAmount: Number(form.taxAmount) || 0,
        dueDate: form.dueDate || undefined,
        notes: form.notes,
      });
      setInvoices((items) => [response.data, ...items]);
      setShowForm(false);
    } catch (error) {
      if (isPlanLimitError(error)) onLocked(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkSent(invoice: InvoiceItem) {
    const response = await updateInvoice<{ data: InvoiceItem }>(invoice.id, { status: "sent" }).catch(() => null);
    if (response) setInvoices((items) => items.map((item) => (item.id === invoice.id ? response.data : item)));
  }

  async function handleDownload(invoice: InvoiceItem) {
    setDownloadingId(invoice.id);
    try {
      await downloadCustomerInvoicePdf(invoice.id, `${invoice.invoiceNumber}.pdf`);
    } finally {
      setDownloadingId("");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Outstanding", value: formatMoney(outstanding), tone: "text-warning" },
          { label: "Paid this month", value: formatMoney(paidThisMonth), tone: "text-primary" },
          { label: "Overdue", value: String(overdueCount), tone: "text-destructive" },
        ].map((item) => (
          <Card key={item.label} className="bg-card/75">
            <CardContent className="flex items-center justify-between p-3">
              <div>
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{item.value}</p>
              </div>
              <div className={`flex size-9 items-center justify-center rounded-lg bg-secondary/70 ${item.tone}`}>
                <Receipt size={16} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
        <div className="flex flex-col gap-3 border-b border-border/80 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-surface-subtle/70 p-1">
            {[
              { id: "", label: "All" },
              { id: "draft", label: "Draft" },
              { id: "sent", label: "Sent" },
              { id: "partially_paid", label: "Partial" },
              { id: "paid", label: "Paid" },
              { id: "overdue", label: "Overdue" },
            ].map((filter) => (
              <button
                key={filter.label}
                type="button"
                onClick={() => setStatusFilter(filter.id)}
                className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                  statusFilter === filter.id ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          {canWrite && (
            <Button size="sm" onClick={openCreateForm} disabled={contacts.length === 0}>
              <Plus size={14} />
              New invoice
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-4">
            <LoadingSkeleton rows={6} />
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={<Receipt size={18} />}
              title="No invoices yet"
              description="Invoices you create for your customers will show up here."
              action={canWrite ? <Button onClick={openCreateForm}><Plus size={14} /> New invoice</Button> : undefined}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
                <tr>
                  {["Invoice", "Customer", "Total", "Balance due", "Status", "Due date", "Actions"].map((column) => (
                    <th key={column} className="px-3 py-3 text-left font-medium text-muted-foreground">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const badge = STATUS_BADGE[invoice.status];
                  return (
                    <tr key={invoice.id} className="group border-b border-border/70 transition-colors hover:bg-secondary/35">
                      <td className="px-3 py-3 font-medium text-foreground">{invoice.invoiceNumber}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {invoice.contact?.name || contactName.get(invoice.contactId) || "—"}
                      </td>
                      <td className="px-3 py-3 text-foreground">{formatMoney(invoice.total, invoice.currency)}</td>
                      <td className="px-3 py-3 text-foreground">{formatMoney(invoice.balanceDue, invoice.currency)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{formatDate(invoice.dueDate)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title="Download PDF"
                            onClick={() => handleDownload(invoice)}
                            disabled={downloadingId === invoice.id}
                          >
                            <Download size={13} />
                          </button>
                          {canWrite && invoice.status === "draft" && (
                            <button
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                              title="Mark as sent"
                              onClick={() => handleMarkSent(invoice)}
                            >
                              <FileText size={13} />
                            </button>
                          )}
                          {canWrite && invoice.status !== "draft" && invoice.status !== "cancelled" && invoice.balanceDue > 0 && (
                            <button
                              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                              title="Record payment"
                              onClick={() => setPayingInvoice(invoice)}
                            >
                              <Wallet size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && canWrite && (
        <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
          <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
            <div className="mb-5 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">New invoice</h2>
              <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setShowForm(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="grid gap-3">
              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Customer</span>
                <select
                  value={form.contactId}
                  onChange={(event) => setForm((current) => ({ ...current, contactId: event.target.value }))}
                  className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
                  required
                >
                  <option value="">Select a customer</option>
                  {contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>{contact.name}</option>
                  ))}
                </select>
              </label>

              <div className="space-y-2">
                <span className="text-sm text-foreground">Line items</span>
                {form.lineItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_4rem_6rem_1.75rem] items-center gap-2">
                    <Input
                      value={item.description}
                      onChange={(event) => updateLineItem(index, { description: event.target.value })}
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={item.quantity}
                      onChange={(event) => updateLineItem(index, { quantity: event.target.value })}
                      placeholder="Qty"
                    />
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(event) => updateLineItem(index, { unitPrice: event.target.value })}
                      placeholder="Unit price"
                    />
                    <button
                      type="button"
                      className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      onClick={() => removeLineItem(index)}
                      disabled={form.lineItems.length === 1}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={addLineItem}>
                  <Plus size={13} />
                  Add line
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Tax label</span>
                  <Input value={form.taxLabel} onChange={(event) => setForm((current) => ({ ...current, taxLabel: event.target.value }))} placeholder="e.g. GST 18%" />
                </label>
                <label className="space-y-1.5 text-sm">
                  <span className="text-foreground">Tax amount</span>
                  <Input type="number" min="0" step="0.01" value={form.taxAmount} onChange={(event) => setForm((current) => ({ ...current, taxAmount: event.target.value }))} />
                </label>
              </div>

              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Due date</span>
                <Input type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
              </label>

              <label className="space-y-1.5 text-sm">
                <span className="text-foreground">Notes</span>
                <Input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional notes shown on the invoice" />
              </label>

              <div className="flex items-center justify-between rounded-lg border border-border/70 bg-surface-subtle/60 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{formatMoney(formTotal)}</span>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
                {saving ? "Saving..." : "Save invoice"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {payingInvoice && (
        <RecordPaymentModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
          onRecorded={() => {
            setPayingInvoice(null);
            loadInvoices();
          }}
          onLocked={onLocked}
        />
      )}
    </div>
  );
}

function RecordPaymentModal({
  invoice,
  onClose,
  onRecorded,
  onLocked,
}: {
  invoice: InvoiceItem;
  onClose: () => void;
  onRecorded: () => void;
  onLocked: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(invoice.balanceDue));
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "upi" | "cheque" | "other">("upi");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return;

    setSaving(true);
    try {
      await recordPayment({
        contactId: invoice.contactId,
        amount: numericAmount,
        method,
        reference,
        allocations: [{ invoiceId: invoice.id, amount: Math.min(numericAmount, invoice.balanceDue) }],
      });
      onRecorded();
    } catch (error) {
      if (isPlanLimitError(error)) onLocked(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-sm overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">Record payment</h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3">
          <p className="text-xs text-muted-foreground">
            Against invoice <span className="font-medium text-foreground">{invoice.invoiceNumber}</span> — balance due {formatMoney(invoice.balanceDue, invoice.currency)}
          </p>
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Amount</span>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Method</span>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
            >
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Reference (optional)</span>
            <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Transaction ID / note" />
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? "Recording..." : "Record payment"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function PaymentsTab({ contacts, onLocked }: { contacts: ContactOption[]; onLocked: (message: string) => void }) {
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPayments<{ data: PaymentItem[] }>()
      .then((response) => setPayments(response.data))
      .catch((error) => {
        if (isPlanLimitError(error)) onLocked(error.message);
        setPayments([]);
      })
      .finally(() => setLoading(false));
  }, [onLocked]);

  const contactName = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/80 bg-card/72 shadow-2xl shadow-black/15">
      {loading ? (
        <div className="p-4">
          <LoadingSkeleton rows={6} />
        </div>
      ) : payments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState icon={<Wallet size={18} />} title="No payments recorded yet" description="Payments you record against invoices will show up here." />
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
              <tr>
                {["Customer", "Amount", "Method", "Reference", "Received"].map((column) => (
                  <th key={column} className="px-3 py-3 text-left font-medium text-muted-foreground">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-border/70 transition-colors hover:bg-secondary/35">
                  <td className="px-3 py-3 text-foreground">{contactName.get(payment.contactId) || "—"}</td>
                  <td className="px-3 py-3 text-foreground">{formatMoney(payment.amount, payment.currency)}</td>
                  <td className="px-3 py-3 text-muted-foreground capitalize">{payment.method.replace("_", " ")}</td>
                  <td className="px-3 py-3 text-muted-foreground">{payment.reference || "—"}</td>
                  <td className="px-3 py-3 text-muted-foreground">{formatDate(payment.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

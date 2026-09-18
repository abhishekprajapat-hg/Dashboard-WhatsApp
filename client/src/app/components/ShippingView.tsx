import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { ArrowRight, Package, Plus, Truck, X, XCircle } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { EmptyState } from "./ui/empty-state";
import { Input } from "./ui/input";
import { LoadingSkeleton } from "./ui/loading-skeleton";
import { isPlanLimitError, PlanLockedState } from "./PlanLockedState";
import { createShipment, getContacts, getInvoices, getShipments, updateShipmentStatus } from "../lib/api";

interface ContactOption {
  id: string;
  name: string;
}

interface InvoiceOption {
  id: string;
  invoiceNumber: string;
  contactId: string;
}

interface ShipmentItem {
  description: string;
  quantity: number;
}

interface StatusHistoryEntry {
  status: string;
  at: string;
  note: string;
}

interface ShipmentRecord {
  id: string;
  contactId: string;
  contact?: { id: string; name: string; phone: string };
  invoiceId: string | null;
  shipmentNumber: string;
  items: ShipmentItem[];
  shippingAddress: string;
  carrier: string;
  trackingReference: string;
  status: "pending" | "packed" | "shipped" | "delivered" | "cancelled";
  statusHistory: StatusHistoryEntry[];
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  notes: string;
  createdAt: string;
}

interface ShippingViewProps {
  canWrite?: boolean;
}

const STATUS_ORDER = ["pending", "packed", "shipped", "delivered"] as const;
const STATUS_BADGE: Record<ShipmentRecord["status"], { variant: "outline" | "info" | "warning" | "success" | "secondary"; label: string }> = {
  pending: { variant: "outline", label: "Pending" },
  packed: { variant: "info", label: "Packed" },
  shipped: { variant: "warning", label: "In transit" },
  delivered: { variant: "success", label: "Delivered" },
  cancelled: { variant: "secondary", label: "Cancelled" },
};

function nextStatus(status: ShipmentRecord["status"]): ShipmentRecord["status"] | null {
  const index = STATUS_ORDER.indexOf(status as (typeof STATUS_ORDER)[number]);
  if (index === -1 || index === STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[index + 1];
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function ShippingView({ canWrite = false }: ShippingViewProps) {
  const [shipments, setShipments] = useState<ShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [lockedMessage, setLockedMessage] = useState("");
  const [advancingId, setAdvancingId] = useState("");

  function loadShipments() {
    setLoading(true);
    getShipments<{ data: ShipmentRecord[] }>({ status: statusFilter || undefined })
      .then((response) => setShipments(response.data))
      .catch((error) => {
        if (isPlanLimitError(error)) setLockedMessage(error.message);
        setShipments([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(loadShipments, [statusFilter]);

  useEffect(() => {
    getContacts<{ data: { id: string; name: string }[] }>({ limit: 200 })
      .then((response) => setContacts(response.data.map((contact) => ({ id: contact.id, name: contact.name }))))
      .catch(() => undefined);
    getInvoices<{ data: { id: string; invoiceNumber: string; contactId: string }[] }>()
      .then((response) => setInvoices(response.data.map((invoice) => ({ id: invoice.id, invoiceNumber: invoice.invoiceNumber, contactId: invoice.contactId }))))
      .catch(() => undefined);
  }, []);

  const contactName = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact.name])), [contacts]);
  const pendingCount = shipments.filter((shipment) => shipment.status === "pending").length;
  const inTransitCount = shipments.filter((shipment) => shipment.status === "packed" || shipment.status === "shipped").length;
  const deliveredCount = shipments.filter((shipment) => shipment.status === "delivered").length;

  async function handleAdvance(shipment: ShipmentRecord) {
    const target = nextStatus(shipment.status);
    if (!target) return;
    setAdvancingId(shipment.id);
    try {
      const response = await updateShipmentStatus<{ data: ShipmentRecord }>(shipment.id, target);
      setShipments((items) => items.map((item) => (item.id === shipment.id ? response.data : item)));
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
    } finally {
      setAdvancingId("");
    }
  }

  async function handleCancel(shipment: ShipmentRecord) {
    setAdvancingId(shipment.id);
    try {
      const response = await updateShipmentStatus<{ data: ShipmentRecord }>(shipment.id, "cancelled");
      setShipments((items) => items.map((item) => (item.id === shipment.id ? response.data : item)));
    } catch (error) {
      if (isPlanLimitError(error)) setLockedMessage(error.message);
    } finally {
      setAdvancingId("");
    }
  }

  if (lockedMessage) {
    return (
      <div className="flex min-h-full w-full items-center justify-center p-6">
        <PlanLockedState title="Shipping is locked" message={lockedMessage} icon={<Truck size={20} />} />
      </div>
    );
  }

  return (
    <div className="relative flex w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(47,168,118,0.08),transparent_26rem),radial-gradient(circle_at_88%_12%,rgba(79,140,255,0.08),transparent_24rem)]" />

      <div className="relative z-10 flex flex-col gap-4 border-b border-border/80 bg-surface/70 px-3 py-4 backdrop-blur-xl sm:px-6">
        <div className="min-w-0">
          <Badge variant="success" className="mb-2">
            <Truck size={12} />
            Fulfilment
          </Badge>
          <h1 className="text-2xl font-semibold text-foreground">Shipping</h1>
          <p className="mt-1 text-sm text-muted-foreground">Track order dispatch status for your customers, from packing through delivery.</p>
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-4 p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Pending", value: pendingCount, tone: "text-muted-foreground" },
            { label: "In transit", value: inTransitCount, tone: "text-warning" },
            { label: "Delivered", value: deliveredCount, tone: "text-primary" },
          ].map((item) => (
            <Card key={item.label} className="bg-card/75">
              <CardContent className="flex items-center justify-between p-3">
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">{item.value}</p>
                </div>
                <div className={`flex size-9 items-center justify-center rounded-lg bg-secondary/70 ${item.tone}`}>
                  <Package size={16} />
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
                { id: "pending", label: "Pending" },
                { id: "packed", label: "Packed" },
                { id: "shipped", label: "In transit" },
                { id: "delivered", label: "Delivered" },
                { id: "cancelled", label: "Cancelled" },
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
              <Button size="sm" onClick={() => setShowForm(true)} disabled={contacts.length === 0}>
                <Plus size={14} />
                New shipment
              </Button>
            )}
          </div>

          {loading ? (
            <div className="p-4">
              <LoadingSkeleton rows={6} />
            </div>
          ) : shipments.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={<Package size={18} />}
                title="No shipments yet"
                description="Shipments you create for your customers' orders will show up here."
                action={canWrite ? <Button onClick={() => setShowForm(true)}><Plus size={14} /> New shipment</Button> : undefined}
              />
            </div>
          ) : (
            <div className="flex-1 overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[860px] text-xs">
                <thead className="sticky top-0 z-10 border-b border-border bg-surface-subtle/95 backdrop-blur">
                  <tr>
                    {["Shipment", "Customer", "Items", "Carrier", "Status", "Delivered", "Actions"].map((column) => (
                      <th key={column} className="px-3 py-3 text-left font-medium text-muted-foreground">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((shipment) => {
                    const badge = STATUS_BADGE[shipment.status];
                    const target = nextStatus(shipment.status);
                    return (
                      <tr key={shipment.id} className="group border-b border-border/70 transition-colors hover:bg-secondary/35">
                        <td className="px-3 py-3 font-medium text-foreground">{shipment.shipmentNumber}</td>
                        <td className="px-3 py-3 text-muted-foreground">{shipment.contact?.name || contactName.get(shipment.contactId) || "—"}</td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {shipment.items.map((item) => `${item.description} ×${item.quantity}`).join(", ")}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{shipment.carrier || "—"}</td>
                        <td className="px-3 py-3">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">{formatDate(shipment.deliveredAt)}</td>
                        <td className="px-3 py-3">
                          {canWrite && target && (
                            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                              <button
                                className="flex h-7 items-center gap-1 rounded-md px-2 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                                title={`Mark as ${STATUS_BADGE[target].label}`}
                                onClick={() => handleAdvance(shipment)}
                                disabled={advancingId === shipment.id}
                              >
                                <ArrowRight size={13} />
                                {STATUS_BADGE[target].label}
                              </button>
                              <button
                                className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                                title="Cancel shipment"
                                onClick={() => handleCancel(shipment)}
                                disabled={advancingId === shipment.id}
                              >
                                <XCircle size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && canWrite && (
        <NewShipmentModal
          contacts={contacts}
          invoices={invoices}
          onClose={() => setShowForm(false)}
          onCreated={(created) => {
            setShipments((items) => [created, ...items]);
            setShowForm(false);
          }}
          onLocked={setLockedMessage}
        />
      )}
    </div>
  );
}

interface ItemFormState {
  description: string;
  quantity: string;
}

const emptyItem: ItemFormState = { description: "", quantity: "1" };

function NewShipmentModal({
  contacts,
  invoices,
  onClose,
  onCreated,
  onLocked,
}: {
  contacts: ContactOption[];
  invoices: InvoiceOption[];
  onClose: () => void;
  onCreated: (shipment: ShipmentRecord) => void;
  onLocked: (message: string) => void;
}) {
  const [contactId, setContactId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [items, setItems] = useState<ItemFormState[]>([{ ...emptyItem }]);
  const [shippingAddress, setShippingAddress] = useState("");
  const [carrier, setCarrier] = useState("");
  const [trackingReference, setTrackingReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const relevantInvoices = useMemo(() => (contactId ? invoices.filter((invoice) => invoice.contactId === contactId) : []), [contactId, invoices]);

  function updateItem(index: number, patch: Partial<ItemFormState>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!contactId || items.every((item) => !item.description.trim())) return;

    setSaving(true);
    try {
      const response = await createShipment<{ data: ShipmentRecord }>({
        contactId,
        invoiceId: invoiceId || undefined,
        items: items.filter((item) => item.description.trim()).map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity) || 1 })),
        shippingAddress,
        carrier,
        trackingReference,
        notes,
      });
      onCreated(response.data);
    } catch (error) {
      if (isPlanLimitError(error)) onLocked(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 p-3 backdrop-blur-sm sm:p-4">
      <form onSubmit={handleSubmit} className="max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-border/90 bg-card p-4 shadow-2xl shadow-black/45 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">New shipment</h2>
          <button type="button" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="grid gap-3">
          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Customer</span>
            <select
              value={contactId}
              onChange={(event) => {
                setContactId(event.target.value);
                setInvoiceId("");
              }}
              className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
              required
            >
              <option value="">Select a customer</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name}</option>
              ))}
            </select>
          </label>

          {relevantInvoices.length > 0 && (
            <label className="space-y-1.5 text-sm">
              <span className="text-foreground">Related invoice (optional)</span>
              <select
                value={invoiceId}
                onChange={(event) => setInvoiceId(event.target.value)}
                className="flex h-9 w-full min-w-0 rounded-md border border-input/85 bg-input-background px-3 text-sm text-foreground outline-none"
              >
                <option value="">No related invoice</option>
                {relevantInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>{invoice.invoiceNumber}</option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-2">
            <span className="text-sm text-foreground">Items</span>
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_4rem_1.75rem] items-center gap-2">
                <Input value={item.description} onChange={(event) => updateItem(index, { description: event.target.value })} placeholder="Item description" />
                <Input type="number" min="1" step="1" value={item.quantity} onChange={(event) => updateItem(index, { quantity: event.target.value })} placeholder="Qty" />
                <button
                  type="button"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  disabled={items.length === 1}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={() => setItems((current) => [...current, { ...emptyItem }])}>
              <Plus size={13} />
              Add item
            </Button>
          </div>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Shipping address</span>
            <Input value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} placeholder="Delivery address" />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-foreground">Carrier</span>
              <Input value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="e.g. Self-delivered, Local courier" />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-foreground">Tracking reference</span>
              <Input value={trackingReference} onChange={(event) => setTrackingReference(event.target.value)} placeholder="Optional" />
            </label>
          </div>

          <label className="space-y-1.5 text-sm">
            <span className="text-foreground">Notes</span>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" />
          </label>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="w-full sm:w-auto" disabled={saving}>
            {saving ? "Saving..." : "Save shipment"}
          </Button>
        </div>
      </form>
    </div>
  );
}

import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Contact, CustomerInvoice, Organization, Shipment } from "../models/index.js";
import { nextSequence } from "../models/Counter.js";
import { generateDeliveryChallanPdfBuffer } from "../services/deliveryChallanPdf.js";
import { objectIdString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const shippingRouter = Router();

const shipmentItemBodySchema = z.object({
  description: trimmedString("Item description is required."),
  quantity: z.number().positive().default(1),
});

export const createShipmentSchema = z.object({
  contactId: objectIdString,
  invoiceId: optionalObjectIdString,
  items: z.array(shipmentItemBodySchema).min(1, "At least one item is required."),
  shippingAddress: z.string().trim().optional().default(""),
  carrier: z.string().trim().optional().default(""),
  trackingReference: z.string().trim().optional().default(""),
  notes: z.string().optional().default(""),
});

const STATUS_ORDER = ["pending", "packed", "shipped", "delivered"];

export const updateShipmentStatusSchema = z.object({
  status: z.enum(["pending", "packed", "shipped", "delivered", "cancelled"]),
  note: z.string().optional().default(""),
});

export const updateShipmentSchema = z.object({
  carrier: z.string().trim().optional(),
  trackingReference: z.string().trim().optional(),
  shippingAddress: z.string().trim().optional(),
  notes: z.string().optional(),
});

export const listShipmentsQuerySchema = z.object({
  contactId: optionalObjectIdString,
  status: z.string().optional(),
});

function serializeShipment(shipment) {
  return {
    id: shipment._id.toString(),
    contactId: shipment.contactId?._id ? shipment.contactId._id.toString() : shipment.contactId?.toString(),
    contact: shipment.contactId?.name
      ? { id: shipment.contactId._id.toString(), name: shipment.contactId.name, phone: shipment.contactId.phone }
      : undefined,
    invoiceId: shipment.invoiceId ? shipment.invoiceId.toString() : null,
    shipmentNumber: shipment.shipmentNumber,
    items: shipment.items || [],
    shippingAddress: shipment.shippingAddress,
    carrier: shipment.carrier,
    trackingReference: shipment.trackingReference,
    status: shipment.status,
    statusHistory: shipment.statusHistory || [],
    packedAt: shipment.packedAt,
    shippedAt: shipment.shippedAt,
    deliveredAt: shipment.deliveredAt,
    notes: shipment.notes,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

shippingRouter.get("/shipments", requirePermission("shipping:read"), requireEntitlement("shipping"), validateQuery(listShipmentsQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.contactId) filter.contactId = req.query.contactId;
  if (req.query.status) filter.status = req.query.status;

  const shipments = await Shipment.find(filter).populate("contactId", "name phone").sort({ createdAt: -1 }).limit(200);
  res.json({ data: shipments.map(serializeShipment), total: shipments.length });
});

shippingRouter.get("/shipments/:id", requirePermission("shipping:read"), requireEntitlement("shipping"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }
  const shipment = await Shipment.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("contactId", "name phone email");
  if (!shipment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }
  res.json({ data: serializeShipment(shipment) });
});

shippingRouter.post("/shipments", requirePermission("shipping:write"), requireEntitlement("shipping"), validateBody(createShipmentSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const contact = await Contact.findOne({ _id: req.body.contactId, workspaceId: req.user.workspaceId });
  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  if (req.body.invoiceId) {
    const invoice = await CustomerInvoice.findOne({ _id: req.body.invoiceId, workspaceId: req.user.workspaceId });
    if (!invoice) {
      return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
    }
  }

  const sequence = await nextSequence(`shipment:${req.user.workspaceId}`);
  const shipmentNumber = `SHIP-${String(sequence).padStart(4, "0")}`;

  const shipment = await Shipment.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    contactId: contact._id,
    invoiceId: req.body.invoiceId || null,
    shipmentNumber,
    items: req.body.items,
    shippingAddress: req.body.shippingAddress,
    carrier: req.body.carrier,
    trackingReference: req.body.trackingReference,
    notes: req.body.notes,
    status: "pending",
    statusHistory: [{ status: "pending", at: new Date(), note: "Shipment created." }],
    createdByUserId: req.user.sub,
  });

  res.status(201).json({ data: serializeShipment(shipment) });
});

shippingRouter.patch("/shipments/:id", requirePermission("shipping:write"), requireEntitlement("shipping"), validateBody(updateShipmentSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }
  const shipment = await Shipment.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!shipment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }

  if (req.body.carrier !== undefined) shipment.carrier = req.body.carrier;
  if (req.body.trackingReference !== undefined) shipment.trackingReference = req.body.trackingReference;
  if (req.body.shippingAddress !== undefined) shipment.shippingAddress = req.body.shippingAddress;
  if (req.body.notes !== undefined) shipment.notes = req.body.notes;
  await shipment.save();

  res.json({ data: serializeShipment(shipment) });
});

shippingRouter.get("/shipments/:id/challan-pdf", requirePermission("shipping:read"), requireEntitlement("shipping"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }
  const shipment = await Shipment.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate("contactId", "name phone email waName");
  if (!shipment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }

  const organization = await Organization.findById(req.user.organizationId).select("name");
  const pdfBuffer = await generateDeliveryChallanPdfBuffer(shipment, {
    issuerName: organization?.name || "Delivery Challan",
    contact: shipment.contactId,
  });

  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${shipment.shipmentNumber}-challan.pdf"`);
  res.send(pdfBuffer);
});

// Status is its own endpoint, not folded into the general PATCH above - a status change is a real
// workflow transition (stamps packedAt/shippedAt/deliveredAt, appends to statusHistory), not just
// an incidental field edit, same distinction routes/invoicing.js draws for an invoice's status.
shippingRouter.post("/shipments/:id/status", requirePermission("shipping:write"), requireEntitlement("shipping"), validateBody(updateShipmentStatusSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }
  const shipment = await Shipment.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!shipment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Shipment not found." });
  }

  const { status, note } = req.body;

  // "cancelled" can happen from any non-terminal state; otherwise moving backwards in the
  // pending->packed->shipped->delivered sequence isn't a supported flow (a real mis-scan gets
  // corrected by cancelling and creating a fresh shipment, not by rewinding this one).
  if (status !== "cancelled" && shipment.status !== "cancelled") {
    const currentIndex = STATUS_ORDER.indexOf(shipment.status);
    const nextIndex = STATUS_ORDER.indexOf(status);
    if (nextIndex !== -1 && nextIndex < currentIndex) {
      return res.status(400).json({ error: "VALIDATION_ERROR", message: "Cannot move a shipment backwards in its status sequence." });
    }
  }
  if (shipment.status === "cancelled" || shipment.status === "delivered") {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: `A ${shipment.status} shipment's status cannot be changed further.` });
  }

  shipment.status = status;
  shipment.statusHistory = [...(shipment.statusHistory || []), { status, at: new Date(), note }];
  if (status === "packed") shipment.packedAt = new Date();
  if (status === "shipped") shipment.shippedAt = new Date();
  if (status === "delivered") shipment.deliveredAt = new Date();
  await shipment.save();

  res.json({ data: serializeShipment(shipment) });
});

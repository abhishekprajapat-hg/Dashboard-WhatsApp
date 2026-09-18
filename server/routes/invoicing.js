import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireEntitlement, requirePermission } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { Contact, CustomerInvoice, CustomerPayment, CustomerPaymentAllocation, Organization } from "../models/index.js";
import { nextSequence } from "../models/Counter.js";
import { generateCustomerInvoicePdfBuffer } from "../services/customerInvoicePdf.js";
import { objectIdString, optionalDateString, optionalObjectIdString, trimmedString } from "../utils/zodHelpers.js";

export const invoicingRouter = Router();

const lineItemBodySchema = z.object({
  description: trimmedString("Line item description is required."),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().nonnegative("Unit price cannot be negative."),
});

export const createInvoiceSchema = z.object({
  contactId: objectIdString,
  lineItems: z.array(lineItemBodySchema).min(1, "At least one line item is required."),
  taxLabel: z.string().trim().optional().default(""),
  taxAmount: z.number().nonnegative().optional().default(0),
  dueDate: optionalDateString(),
  notes: z.string().optional().default(""),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "cancelled"]).optional(),
  dueDate: optionalDateString(),
  notes: z.string().optional(),
});

export const listInvoicesQuerySchema = z.object({
  contactId: optionalObjectIdString,
  status: z.string().optional(),
});

export const recordPaymentSchema = z
  .object({
    contactId: objectIdString,
    amount: z.number().positive("Amount must be greater than zero."),
    method: z.enum(["cash", "bank_transfer", "upi", "cheque", "other"]).default("other"),
    reference: z.string().trim().optional().default(""),
    notes: z.string().optional().default(""),
    receivedAt: optionalDateString(),
    // Optional up-front allocation against specific invoices - omit to record an unallocated
    // payment (e.g. an advance) that gets applied to invoices later via POST /payments/:id/allocate.
    allocations: z
      .array(z.object({ invoiceId: objectIdString, amount: z.number().positive() }))
      .optional()
      .default([]),
  })
  .refine(
    (data) => {
      const allocated = data.allocations.reduce((sum, item) => sum + item.amount, 0);
      return allocated <= data.amount;
    },
    { message: "Allocated amounts cannot exceed the payment amount." }
  );

function toPaise(rupees) {
  return Math.round(Number(rupees || 0) * 100);
}

function serializeInvoice(invoice) {
  return {
    id: invoice._id.toString(),
    contactId: invoice.contactId?._id ? invoice.contactId._id.toString() : invoice.contactId?.toString(),
    contact: invoice.contactId?.name
      ? { id: invoice.contactId._id.toString(), name: invoice.contactId.name, phone: invoice.contactId.phone }
      : undefined,
    invoiceNumber: invoice.invoiceNumber,
    lineItems: (invoice.lineItems || []).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice / 100,
      amount: item.amount / 100,
    })),
    currency: invoice.currency,
    subtotal: invoice.subtotal / 100,
    taxLabel: invoice.taxLabel,
    taxAmount: invoice.taxAmount / 100,
    total: invoice.total / 100,
    amountPaid: invoice.amountPaid / 100,
    balanceDue: Math.max(0, invoice.total - invoice.amountPaid) / 100,
    status: invoice.status,
    dueDate: invoice.dueDate,
    issuedAt: invoice.issuedAt,
    notes: invoice.notes,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function serializePayment(payment) {
  return {
    id: payment._id.toString(),
    contactId: payment.contactId?.toString(),
    amount: payment.amount / 100,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    receivedAt: payment.receivedAt,
    createdAt: payment.createdAt,
  };
}

// Re-derives amountPaid/status from CustomerPaymentAllocation rows rather than trusting an
// incrementally-updated counter - cheap at this volume, and immune to drift if an allocation is
// ever edited/reversed later.
async function recalculateInvoiceStatus(invoiceId) {
  const invoice = await CustomerInvoice.findById(invoiceId);
  if (!invoice) return null;

  const allocations = await CustomerPaymentAllocation.find({ invoiceId }).select("amount");
  const amountPaid = allocations.reduce((sum, item) => sum + item.amount, 0);

  invoice.amountPaid = amountPaid;
  if (invoice.status !== "cancelled" && invoice.status !== "draft") {
    if (amountPaid >= invoice.total) invoice.status = "paid";
    else if (amountPaid > 0) invoice.status = "partially_paid";
    else if (invoice.dueDate && invoice.dueDate < new Date()) invoice.status = "overdue";
    else invoice.status = "sent";
  }
  await invoice.save();
  return invoice;
}

invoicingRouter.get("/invoices", requirePermission("invoicing:read"), requireEntitlement("invoicing"), validateQuery(listInvoicesQuerySchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }

  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.contactId) filter.contactId = req.query.contactId;
  if (req.query.status) filter.status = req.query.status;

  const invoices = await CustomerInvoice.find(filter).populate("contactId", "name phone").sort({ createdAt: -1 }).limit(200);
  res.json({ data: invoices.map(serializeInvoice), total: invoices.length });
});

invoicingRouter.get("/invoices/:id", requirePermission("invoicing:read"), requireEntitlement("invoicing"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }
  const invoice = await CustomerInvoice.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate(
    "contactId",
    "name phone email"
  );
  if (!invoice) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }
  res.json({ data: serializeInvoice(invoice) });
});

invoicingRouter.post("/invoices", requirePermission("invoicing:write"), requireEntitlement("invoicing"), validateBody(createInvoiceSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const contact = await Contact.findOne({ _id: req.body.contactId, workspaceId: req.user.workspaceId });
  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const lineItems = req.body.lineItems.map((item) => {
    const unitPrice = toPaise(item.unitPrice);
    return { description: item.description, quantity: item.quantity, unitPrice, amount: Math.round(unitPrice * item.quantity) };
  });
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = toPaise(req.body.taxAmount);
  const total = subtotal + taxAmount;

  const sequence = await nextSequence(`customer-invoice:${req.user.workspaceId}`);
  const invoiceNumber = `INV-${String(sequence).padStart(4, "0")}`;

  const invoice = await CustomerInvoice.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    contactId: contact._id,
    invoiceNumber,
    lineItems,
    subtotal,
    taxLabel: req.body.taxLabel,
    taxAmount,
    total,
    status: "draft",
    dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
    notes: req.body.notes,
    createdByUserId: req.user.sub,
  });

  res.status(201).json({ data: serializeInvoice(invoice) });
});

invoicingRouter.patch("/invoices/:id", requirePermission("invoicing:write"), requireEntitlement("invoicing"), validateBody(updateInvoiceSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }
  const invoice = await CustomerInvoice.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!invoice) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }

  if (req.body.status) {
    // "sent" is the one transition that stamps issuedAt, and only the first time - re-sending an
    // already-issued invoice must never reset its original issue date.
    if (req.body.status === "sent" && !invoice.issuedAt) {
      invoice.issuedAt = new Date();
    }
    invoice.status = req.body.status;
  }
  if (req.body.dueDate !== undefined) {
    invoice.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  }
  if (req.body.notes !== undefined) {
    invoice.notes = req.body.notes;
  }
  await invoice.save();

  res.json({ data: serializeInvoice(invoice) });
});

invoicingRouter.get("/invoices/:id/pdf", requirePermission("invoicing:read"), requireEntitlement("invoicing"), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }
  const invoice = await CustomerInvoice.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId }).populate(
    "contactId",
    "name phone email waName"
  );
  if (!invoice) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }

  const organization = await Organization.findById(req.user.organizationId).select("name");
  const pdfBuffer = await generateCustomerInvoicePdfBuffer(invoice, {
    issuerName: organization?.name || "Invoice",
    contact: invoice.contactId,
  });

  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `attachment; filename="${invoice.invoiceNumber}.pdf"`);
  res.send(pdfBuffer);
});

invoicingRouter.get("/payments", requirePermission("invoicing:read"), requireEntitlement("invoicing"), validateQuery(z.object({ contactId: optionalObjectIdString })), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.json({ data: [], total: 0 });
  }
  const filter = { workspaceId: req.user.workspaceId };
  if (req.query.contactId) filter.contactId = req.query.contactId;

  const payments = await CustomerPayment.find(filter).sort({ receivedAt: -1 }).limit(200);
  res.json({ data: payments.map(serializePayment), total: payments.length });
});

invoicingRouter.post("/payments", requirePermission("invoicing:write"), requireEntitlement("invoicing"), validateBody(recordPaymentSchema), async (req, res) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ error: "DATABASE_UNAVAILABLE", message: "MongoDB is required." });
  }

  const contact = await Contact.findOne({ _id: req.body.contactId, workspaceId: req.user.workspaceId });
  if (!contact) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Contact not found." });
  }

  const amount = toPaise(req.body.amount);

  if (req.body.allocations.length > 0) {
    const invoiceIds = req.body.allocations.map((item) => item.invoiceId);
    const invoices = await CustomerInvoice.find({ _id: mongoose.trusted({ $in: invoiceIds }), workspaceId: req.user.workspaceId });
    if (invoices.length !== invoiceIds.length) {
      return res.status(404).json({ error: "NOT_FOUND", message: "One or more invoices were not found." });
    }
  }

  const payment = await CustomerPayment.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    contactId: contact._id,
    amount,
    method: req.body.method,
    reference: req.body.reference,
    notes: req.body.notes,
    receivedAt: req.body.receivedAt ? new Date(req.body.receivedAt) : new Date(),
    recordedByUserId: req.user.sub,
  });

  const touchedInvoiceIds = [];
  for (const allocation of req.body.allocations) {
    await CustomerPaymentAllocation.create({
      organizationId: req.user.organizationId,
      workspaceId: req.user.workspaceId,
      paymentId: payment._id,
      invoiceId: allocation.invoiceId,
      amount: toPaise(allocation.amount),
    });
    touchedInvoiceIds.push(allocation.invoiceId);
  }
  await Promise.all(touchedInvoiceIds.map((id) => recalculateInvoiceStatus(id)));

  res.status(201).json({ data: serializePayment(payment) });
});

const allocatePaymentSchema = z.object({
  invoiceId: objectIdString,
  amount: z.number().positive(),
});

invoicingRouter.post("/payments/:id/allocate", requirePermission("invoicing:write"), requireEntitlement("invoicing"), validateBody(allocatePaymentSchema), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Payment not found." });
  }
  const payment = await CustomerPayment.findOne({ _id: req.params.id, workspaceId: req.user.workspaceId });
  if (!payment) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Payment not found." });
  }
  const invoice = await CustomerInvoice.findOne({ _id: req.body.invoiceId, workspaceId: req.user.workspaceId });
  if (!invoice) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Invoice not found." });
  }

  const existingAllocations = await CustomerPaymentAllocation.find({ paymentId: payment._id }).select("amount");
  const alreadyAllocated = existingAllocations.reduce((sum, item) => sum + item.amount, 0);
  const amount = toPaise(req.body.amount);

  if (alreadyAllocated + amount > payment.amount) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "This would allocate more than the payment's total amount." });
  }

  await CustomerPaymentAllocation.create({
    organizationId: req.user.organizationId,
    workspaceId: req.user.workspaceId,
    paymentId: payment._id,
    invoiceId: invoice._id,
    amount,
  });
  const updatedInvoice = await recalculateInvoiceStatus(invoice._id);

  res.status(201).json({ data: serializeInvoice(updatedInvoice) });
});

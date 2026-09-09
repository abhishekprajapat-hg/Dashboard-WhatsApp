import mongoose from "mongoose";

const invoiceSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    plan: { type: String, required: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    // Loose string, not a hard enum - same reasoning as Organization.plan: rows are only ever
    // created on a confirmed Razorpay event (checkout verify, subscription.charged), so "paid" is
    // the only value written today, but a hard enum would block a future refund/dispute status.
    status: { type: String, default: "paid" },
    razorpayPaymentId: { type: String, trim: true, default: "" },
    razorpaySubscriptionId: { type: String, trim: true, default: "" },
    periodStart: Date,
    periodEnd: Date,

    // --- GST tax invoice fields (services/gstInvoice.js is the only writer) ---
    // Gapless, sequential per financial year, e.g. "NEM-WA-2026-27-0001" - GST Rule 46(b) requires
    // this to be unique for the financial year; sparse because invoices created before this field
    // existed have none, and must never be renumbered retroactively (a real GST invoice number, once
    // issued, is permanent).
    invoiceNumber: { type: String, trim: true, default: "", index: true, sparse: true, unique: true },
    sacCode: { type: String, trim: true, default: "" },
    // `amount` above is the real total actually charged (tax-inclusive, since that's what Razorpay
    // charges against a fixed Plan amount) - these are the GST-required breakdown of that same
    // total, computed once at issue time and frozen here even if tax rates change later.
    taxableValue: { type: Number, default: 0 },
    cgstRate: { type: Number, default: 0 },
    cgstAmount: { type: Number, default: 0 },
    sgstRate: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstRate: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    // Snapshotted at issue time, not a live reference to Organization - a real tax invoice must
    // reflect what the recipient's details actually were on the day it was issued, not whatever
    // they've since edited in Settings.
    supplierName: { type: String, trim: true, default: "" },
    supplierGstin: { type: String, trim: true, default: "" },
    supplierAddress: { type: String, trim: true, default: "" },
    supplierState: { type: String, trim: true, default: "" },
    recipientName: { type: String, trim: true, default: "" },
    recipientGstin: { type: String, trim: true, default: "" },
    recipientAddress: { type: String, trim: true, default: "" },
    recipientState: { type: String, trim: true, default: "" },
    // True only when recipientState was genuinely unknown at issue time and IGST was assumed as the
    // conservative default (see gstInvoice.js) - surfaced so a client who later adds their real
    // state can be told this specific invoice's CGST/SGST-vs-IGST split may need correcting with
    // their CA, rather than silently treating every invoice as equally authoritative.
    placeOfSupplyAssumed: { type: Boolean, default: false },
    pdfSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

invoiceSchema.index({ organizationId: 1, createdAt: -1 });
invoiceSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });

export const Invoice = mongoose.model("Invoice", invoiceSchema);

import mongoose from "mongoose";

// An invoice a workspace issues to its OWN customer (a Contact) - not to be confused with
// models/Invoice.js, which is this organization's own Dashboard-WhatsApp subscription invoice
// from Nemnidhi. Amounts are in paise (minor units), same convention as Invoice.js/entitlements.js's
// PLAN_PRICES, not rupees.
const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true }, // paise
    amount: { type: Number, required: true }, // paise, quantity * unitPrice
  },
  { _id: false }
);

const customerInvoiceSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    // Sequential per workspace, e.g. "INV-0001" - generated via Counter.js's nextSequence(),
    // keyed "customer-invoice:<workspaceId>". v1 only, not a GST-compliant financial-year series
    // like Invoice.js's own numbering - see entitlements.js's invoicing capability description
    // for why these two invoice concepts are kept deliberately separate.
    invoiceNumber: { type: String, required: true, trim: true },
    lineItems: { type: [lineItemSchema], default: [] },
    currency: { type: String, default: "INR" },
    subtotal: { type: Number, required: true }, // paise
    // Flat, free-text tax in v1 (e.g. "GST 18%") - a real GST breakdown (CGST/SGST/IGST, HSN/SAC
    // codes, e-invoice IRN) is deliberately out of scope until real transaction volume needs it,
    // per the platform master plan's Billing-module v2.
    taxLabel: { type: String, trim: true, default: "" },
    taxAmount: { type: Number, default: 0 }, // paise
    total: { type: Number, required: true }, // paise
    // Denormalized running total from CustomerPaymentAllocation - recomputed on every allocation
    // change (see routes/invoicing.js), not trusted as a source of truth on its own.
    amountPaid: { type: Number, default: 0 }, // paise
    status: {
      type: String,
      enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],
      default: "draft",
    },
    dueDate: { type: Date, default: null },
    issuedAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

customerInvoiceSchema.index({ workspaceId: 1, invoiceNumber: 1 }, { unique: true });
customerInvoiceSchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
customerInvoiceSchema.index({ workspaceId: 1, status: 1 });

export const CustomerInvoice = mongoose.model("CustomerInvoice", customerInvoiceSchema);

import mongoose from "mongoose";

// A payment received from a workspace's own customer - manually recorded in v1 (no payment
// gateway integration yet, see the platform master plan's Billing-module v2). One payment can
// cover multiple invoices, or partially cover one - see CustomerPaymentAllocation.js for the split.
const customerPaymentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    amount: { type: Number, required: true }, // paise
    currency: { type: String, default: "INR" },
    method: { type: String, enum: ["cash", "bank_transfer", "upi", "cheque", "other"], default: "other" },
    reference: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    receivedAt: { type: Date, default: Date.now },
    recordedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

customerPaymentSchema.index({ workspaceId: 1, contactId: 1, receivedAt: -1 });

export const CustomerPayment = mongoose.model("CustomerPayment", customerPaymentSchema);

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
  },
  { timestamps: true }
);

invoiceSchema.index({ organizationId: 1, createdAt: -1 });
invoiceSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true });

export const Invoice = mongoose.model("Invoice", invoiceSchema);

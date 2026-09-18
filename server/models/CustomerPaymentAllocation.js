import mongoose from "mongoose";

// Splits one CustomerPayment across one or more CustomerInvoices - a payment doesn't have to match
// an invoice 1:1 (a customer can overpay, underpay, or settle several invoices in one payment).
// amount here is the portion of the payment applied to that specific invoice, always <= the
// payment's own total and <= the invoice's outstanding balance at allocation time.
const customerPaymentAllocationSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerPayment", required: true, index: true },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerInvoice", required: true, index: true },
    amount: { type: Number, required: true }, // paise
  },
  { timestamps: true }
);

customerPaymentAllocationSchema.index({ paymentId: 1, invoiceId: 1 }, { unique: true });

export const CustomerPaymentAllocation = mongoose.model("CustomerPaymentAllocation", customerPaymentAllocationSchema);

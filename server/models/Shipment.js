import mongoose from "mongoose";

// v1 scope per the platform master plan: internal order/dispatch status tracking only, no real
// courier API integration yet (that's v2, once this proves out with real usage) - carrier/
// trackingReference are free-text fields a workspace fills in by hand, not a live API response.
const shipmentItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, default: 1 },
  },
  { _id: false }
);

const statusHistoryEntrySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const shipmentSchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
    // Optional - a shipment doesn't have to originate from an invoice (e.g. a free sample), but
    // when it does this is how routes/invoicing.js's data and routes/shipping.js's data connect,
    // both scoped to the same Contact either way.
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "CustomerInvoice", default: null },
    // Sequential per workspace, e.g. "SHIP-0001" - same Counter.js pattern as
    // CustomerInvoice.invoiceNumber, own series so the two numbering sequences never collide.
    shipmentNumber: { type: String, required: true, trim: true },
    items: { type: [shipmentItemSchema], default: [] },
    shippingAddress: { type: String, trim: true, default: "" },
    carrier: { type: String, trim: true, default: "" },
    trackingReference: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["pending", "packed", "shipped", "delivered", "cancelled"],
      default: "pending",
    },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
    packedAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

shipmentSchema.index({ workspaceId: 1, shipmentNumber: 1 }, { unique: true });
shipmentSchema.index({ workspaceId: 1, contactId: 1, createdAt: -1 });
shipmentSchema.index({ workspaceId: 1, status: 1 });

export const Shipment = mongoose.model("Shipment", shipmentSchema);

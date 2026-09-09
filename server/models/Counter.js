import mongoose from "mongoose";

// Generic atomic sequence counter. Currently only used for GST invoice numbering
// (services/gstInvoice.js), keyed by e.g. "invoice:NEM-WA:2026-27" - one document per financial
// year per series, incremented via findOneAndUpdate's atomic $inc so two webhook deliveries firing
// at the same instant can never be handed the same number (a real GST invoice number must be
// gapless AND never duplicated).
const counterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: Number, default: 0 },
});

export const Counter = mongoose.model("Counter", counterSchema);

export async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate({ key }, { $inc: { value: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return doc.value;
}

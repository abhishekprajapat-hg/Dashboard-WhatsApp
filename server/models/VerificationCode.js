import mongoose from "mongoose";

const verificationCodeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true, index: true },
    codeHash: { type: String, required: true },
    // Loose string, not a hard enum - same reasoning as Organization.plan elsewhere in this
    // codebase: this is the only purpose today, but a future password-reset-by-OTP flow (etc.)
    // shouldn't need a schema migration to add a new value.
    purpose: { type: String, default: "signup" },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: Date,
  },
  { timestamps: true }
);

verificationCodeSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
// TTL index - Mongo auto-deletes a code once its own expiresAt passes, so expired codes never pile
// up and never need a separate cleanup job.
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const VerificationCode = mongoose.model("VerificationCode", verificationCodeSchema);

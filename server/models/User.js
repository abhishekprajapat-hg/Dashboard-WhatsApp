import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Optional now - a social/OTP-only signup (Google, Facebook, Instagram, WhatsApp OTP) never
    // sets one. verifyPassword() already fails closed on an empty/malformed hash, so a passwordless
    // account simply can never log in via POST /login, only via the identity it actually signed up
    // with - matches the same "no synthetic/fallback credential" discipline used elsewhere.
    passwordHash: { type: String },
    phone: { type: String, trim: true, sparse: true, unique: true },
    phoneVerifiedAt: Date,
    googleId: { type: String, trim: true, sparse: true, unique: true },
    facebookId: { type: String, trim: true, sparse: true, unique: true },
    instagramId: { type: String, trim: true, sparse: true, unique: true },
    avatarUrl: String,
    status: { type: String, enum: ["active", "invited", "suspended"], default: "active", index: true },
    lastLoginAt: Date,
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);

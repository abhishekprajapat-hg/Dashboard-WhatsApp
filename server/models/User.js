import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    phone: { type: String, trim: true },
    avatarUrl: String,
    status: { type: String, enum: ["active", "invited", "suspended"], default: "active", index: true },
    lastLoginAt: Date,
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);

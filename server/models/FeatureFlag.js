import mongoose from "mongoose";

const featureFlagSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, required: true },
    updatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByEmail: String,
  },
  { timestamps: true }
);

export const FeatureFlag = mongoose.model("FeatureFlag", featureFlagSchema);

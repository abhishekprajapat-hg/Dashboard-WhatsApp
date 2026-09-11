import "dotenv/config";
import mongoose from "mongoose";
import "../models/index.js";

// READ-ONLY. Reports what every organization actually owns across every collection that references
// organizationId, so a cleanup decision is made from real numbers rather than from what the admin
// list happens to show. Writes nothing, deletes nothing - safe to run against production.
//
// Same cwd constraint as the other scripts here: "dotenv/config" resolves .env relative to
// process.cwd() at process start and ES imports are hoisted, so run it from inside server/:
//
//   sudo -u dashboard bash -c 'cd /home/dashboard/dashboard-whatsapp/server && node scripts/reportTenantFootprint.mjs'
//
// Collections are discovered from the registered schemas rather than hardcoded, so a model added
// later is picked up automatically instead of being silently missed by a stale list - which is
// exactly how an orphaned-data bug would get introduced during a cleanup.

// Owning one of these is what makes an org "real" rather than a test husk: a connected channel or
// actual message traffic. Used only to label rows in the report, never to act on them.
const SIGNIFICANT = ["Message", "WhatsAppAccount", "InstagramAccount", "FacebookAccount", "Invoice"];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    const Organization = mongoose.model("Organization");
    const scoped = Object.values(mongoose.models).filter(
      (model) => model.modelName !== "Organization" && model.schema.path("organizationId")
    );

    const organizations = await Organization.find({}).sort({ createdAt: 1 }).lean();
    console.log(`${organizations.length} organizations; ${scoped.length} collections reference organizationId\n`);

    const rows = [];

    for (const org of organizations) {
      const counts = {};
      let total = 0;
      let significant = 0;

      for (const model of scoped) {
        const n = await model.countDocuments({ organizationId: org._id });
        if (n > 0) {
          counts[model.modelName] = n;
          total += n;
          if (SIGNIFICANT.includes(model.modelName)) significant += n;
        }
      }

      rows.push({ org, counts, total, significant });
    }

    for (const { org, counts, total, significant } of rows) {
      const label = org.isPlatformOwner
        ? "PLATFORM OWNER - never delete"
        : significant > 0
          ? `HAS REAL ACTIVITY (${significant} significant docs) - do not delete`
          : total === 0
            ? "EMPTY - safe to delete"
            : "metadata only - review";

      console.log(`${org.name}  [${org.plan}/${org.billingStatus}]  id=${org._id}`);
      console.log(`  created ${new Date(org.createdAt).toISOString().slice(0, 10)}  total docs: ${total}`);
      console.log(`  ${label}`);
      if (total > 0) {
        const detail = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([name, n]) => `${name}=${n}`)
          .join(" ");
        console.log(`  ${detail}`);
      }
      console.log();
    }

    const deletable = rows.filter((r) => !r.org.isPlatformOwner && r.significant === 0);
    console.log("--- summary ---");
    console.log(`safe/reviewable: ${deletable.length} of ${rows.length}`);
    console.log(deletable.map((r) => `${r.org.name} (${r.total} docs)`).join(", ") || "none");
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("reportTenantFootprint failed:", error.message);
  process.exit(1);
});

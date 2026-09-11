import "dotenv/config";
import mongoose from "mongoose";
import "../models/index.js";

// Deletes test-husk organizations left behind by signup/OTP testing, and the user records orphaned
// by removing them. DRY RUN BY DEFAULT - pass --execute to actually delete.
//
//   sudo -u dashboard bash -c 'cd /home/dashboard/dashboard-whatsapp/server && node scripts/deleteTestTenants.mjs'
//   sudo -u dashboard bash -c 'cd /home/dashboard/dashboard-whatsapp/server && node scripts/deleteTestTenants.mjs --execute'
//
// Optional: --keep <id>,<id> to spare specific organizations by id.
//
// Safety model is an ALLOWLIST, not a blocklist: an organization is deletable only if every
// collection it owns documents in is one of DISPOSABLE below. Anything else present - a single
// Message, Contact, WhatsAppAccount, Invoice, or a model added to the codebase next month - makes
// it non-deletable automatically. A blocklist of "important" collections would silently treat any
// future model as unimportant, which is exactly how a real tenant gets destroyed by a cleanup
// script. Erring toward "skip it" costs a leftover row; erring the other way costs a client.
//
// Users are NOT organization-scoped (no organizationId on the User schema) - they're linked only
// through Membership. So removing an org's memberships orphans its user records, and because
// User.email and User.phone are UNIQUE indexes, a leftover orphan permanently blocks that address
// or number from signing up for real later. Orphans are therefore cleaned up too, but only when a
// user has zero remaining memberships anywhere.

const DISPOSABLE = new Set(["Workspace", "Membership", "Role", "AuditLog"]);

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const keepArg = args[args.indexOf("--keep") + 1];
const keepIds = new Set(args.includes("--keep") && keepArg ? keepArg.split(",").map((s) => s.trim()) : []);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  try {
    const Organization = mongoose.model("Organization");
    const Membership = mongoose.model("Membership");
    const User = mongoose.model("User");

    const scoped = Object.values(mongoose.models).filter(
      (model) => model.modelName !== "Organization" && model.schema.path("organizationId")
    );

    const organizations = await Organization.find({}).sort({ createdAt: 1 }).lean();
    const deletable = [];

    for (const org of organizations) {
      if (org.isPlatformOwner) continue;
      if (keepIds.has(org._id.toString())) continue;

      const owned = {};
      for (const model of scoped) {
        const n = await model.countDocuments({ organizationId: org._id });
        if (n > 0) owned[model.modelName] = n;
      }

      const blockers = Object.keys(owned).filter((name) => !DISPOSABLE.has(name));
      if (blockers.length > 0) continue;

      deletable.push({ org, owned });
    }

    // Which users would be left with no membership at all once these orgs go.
    const orgIds = deletable.map((d) => d.org._id);
    const affectedUserIds = await Membership.distinct("userId", { organizationId: { $in: orgIds } });
    const orphanIds = [];
    for (const userId of affectedUserIds) {
      if (!userId) continue;
      const remaining = await Membership.countDocuments({
        userId,
        organizationId: { $nin: orgIds },
      });
      if (remaining === 0) orphanIds.push(userId);
    }
    const orphans = await User.find({ _id: { $in: orphanIds } }).select("name email phone").lean();

    console.log(`${organizations.length} organizations total`);
    console.log(`${deletable.length} deletable (own nothing outside: ${[...DISPOSABLE].join(", ")})`);
    console.log(`${organizations.length - deletable.length} kept (platform owner, real activity, or --keep)\n`);

    for (const { org, owned } of deletable) {
      const detail = Object.entries(owned).map(([k, v]) => `${k}=${v}`).join(" ") || "(nothing)";
      console.log(`  ${org.name.padEnd(20)} ${org._id}  ${detail}`);
    }

    console.log(`\n${orphans.length} user records would be orphaned and removed:`);
    for (const user of orphans) {
      console.log(`  ${(user.email || "(no email)").padEnd(34)} ${user.phone || ""}  ${user.name || ""}`);
    }

    if (!execute) {
      console.log("\nDRY RUN - nothing was deleted. Re-run with --execute to apply.");
      return;
    }

    console.log("\n--- executing ---");
    let docsDeleted = 0;

    for (const { org } of deletable) {
      // Children first, organization last: if this dies partway the org still exists and the whole
      // thing can simply be re-run. Deleting the org first would strand its children with no owner
      // and nothing to find them by. There are no transactions here - a standalone mongod has no
      // replica set - so recoverable ordering is the only protection available.
      for (const model of scoped) {
        const { deletedCount } = await model.deleteMany({ organizationId: org._id });
        docsDeleted += deletedCount || 0;
      }
      await Organization.deleteOne({ _id: org._id });
      docsDeleted += 1;
    }

    const userResult = orphanIds.length ? await User.deleteMany({ _id: { $in: orphanIds } }) : { deletedCount: 0 };

    console.log(`deleted ${deletable.length} organizations, ${docsDeleted} scoped documents, ${userResult.deletedCount || 0} orphaned users`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("deleteTestTenants failed:", error.message);
  process.exit(1);
});

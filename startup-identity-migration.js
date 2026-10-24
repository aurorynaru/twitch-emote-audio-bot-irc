import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applyIdentityMergePlan, buildIdentityMergePlan } from "./identity-migration.js";
import { getLegacyIdentityObservations, refreshIdentities } from "./twitch-identities.js";

// Await this before installing reward/game timers or accepting account mutations.
// No permanent "completed" flag: a future chat observation can identify a previously
// unresolved legacy name. Rebuilding the plan makes completed merges harmless to rerun.
export async function migrateIdentitiesOnStartup({ runtimes, directory, fetchUsers, backupDirectory, logger = console }) {
  const databases = runtimes.map((runtime) => runtime.db);
  const users = await refreshIdentities(directory, databases, fetchUsers);
  const observations = (await Promise.all(databases.map(getLegacyIdentityObservations))).flat();
  const work = [];
  for (const runtime of runtimes) {
    // Use raw per-channel connections: shared balances must not be merged again through
    // the SQL proxy when migrating a secondary channel's local stats/activity records.
    const plan = await buildIdentityMergePlan(runtime.db, users, { observations });
    work.push({ runtime, plan, backupPath: null });
  }

  // Back up every affected database before the first balance or item is changed.
  // VACUUM INTO includes committed WAL data; copying only the .sqlite file would not.
  for (const item of work) {
    if (!item.plan.merges.length) continue;
    await fs.mkdir(backupDirectory, { recursive: true });
    item.backupPath = path.join(backupDirectory,
      `${path.basename(item.runtime.dbPath)}.${Date.now()}-${randomUUID()}.sqlite`);
    await item.runtime.db.run("VACUUM main INTO ?", [item.backupPath]);
    logger.log(`* [IDENTITY MIGRATION] ${item.runtime.login}: backup saved to ${item.backupPath}`);
  }

  const results = [];
  for (const { runtime, plan, backupPath } of work) {
    if (plan.merges.length) await applyIdentityMergePlan(runtime.db, plan);
    const mergedAccounts = plan.merges.length;
    const unresolvedAccounts = plan.unresolved.length;
    logger.log(`* [IDENTITY MIGRATION] ${runtime.login}: ${mergedAccounts} account(s) merged; ${unresolvedAccounts} unresolved name(s) preserved.`);
    results.push({ channel: runtime.login, mergedAccounts, unresolvedAccounts, backupPath });
  }
  return results;
}

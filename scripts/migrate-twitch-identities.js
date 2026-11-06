import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import dotenv from "dotenv";
import { getLegacyIdentityObservations } from "../twitch-identities.js";
import { applyIdentityMergePlan, buildIdentityMergePlan } from "../identity-migration.js";

dotenv.config({ quiet: true });

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: "string", default: "data/database.sqlite" },
    output: { type: "string" },
    help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("Preview: node scripts/migrate-twitch-identities.js --db <database.sqlite>\nCreate a merged copy: add --output <new-database.sqlite>\nStop the bot before migrating. The input database is never modified.");
    return;
  }
  const input = path.resolve(values.db);
  const output = values.output && path.resolve(values.output);
  if (output === input) throw new Error("Output must be a different file; the original is preserved.");
  if (output && fs.existsSync(output)) throw new Error("Output already exists. Choose a new filename.");
  const source = await open({ filename: input, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    const observations = await getLegacyIdentityObservations(source);
    const ids = [...new Set(observations.map((row) => row.twitch_user_id))];
    const users = [];
    if (ids.length) {
      if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
        throw new Error("Set CLIENT_ID and CLIENT_SECRET in .env to verify account IDs with Twitch.");
      }
      // An app token stays in memory. Do not refresh or overwrite the bot's saved tokens.
      const auth = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: "client_credentials" }),
        signal: AbortSignal.timeout(15000),
      });
      if (!auth.ok) throw new Error(`Twitch authentication failed (${auth.status}).`);
      const token = (await auth.json()).access_token;
      for (let index = 0; index < ids.length; index += 100) {
        const query = new URLSearchParams();
        ids.slice(index, index + 100).forEach((id) => query.append("id", id));
        const response = await fetch(`https://api.twitch.tv/helix/users?${query}`, {
          headers: { Authorization: `Bearer ${token}`, "Client-Id": process.env.CLIENT_ID },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`Twitch identity lookup failed (${response.status}).`);
        users.push(...(await response.json()).data);
      }
    }
    const plan = await buildIdentityMergePlan(source, users);
    console.log(JSON.stringify({
      mode: output ? "create-merged-copy" : "preview-only", input, output: output || null,
      merges: plan.merges.map((merge) => ({
        displayNames: merge.sources, login: merge.login, twitchUserId: merge.id,
        existingLoginPoints: merge.existingPoints, combinedPoints: merge.combinedPoints,
      })),
      unresolvedPreserved: plan.unresolved,
    }, null, 2));
    if (output) {
      // VACUUM INTO includes committed WAL contents and creates a consistent standalone copy.
      await source.run("VACUUM INTO ?", [output]);
      const target = await open({ filename: output, driver: sqlite3.Database, mode: sqlite3.OPEN_READWRITE });
      try {
        // Plan from the actual snapshot, so totals and references cannot drift from the copy.
        await applyIdentityMergePlan(target, await buildIdentityMergePlan(target, users));
      } finally {
        await target.close();
      }
      console.log(`Merged copy saved to ${output}. Original records are also archived in identity_merge_history. Unresolved accounts are unchanged.`);
    }
  } finally {
    await source.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

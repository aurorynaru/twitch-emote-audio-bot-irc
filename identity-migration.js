import {
  ensureIdentitySchema,
  getLegacyIdentityObservations,
  isTwitchLogin,
  normalizeMention,
  TwitchIdentityDirectory,
} from "./twitch-identities.js";

const referenceColumns = {
  users: ["username"],
  user_stats: ["username"],
  user_inventory: ["username"],
  user_modifiers: ["username"],
  pending_fish: ["username"],
  active_effects: ["target_user", "caster"],
  user_submissions: ["username", "reviewer"],
  trivia_questions: ["submitter"],
  playsounds_metadata: ["submitter"],
  chatter_subscription_status: ["username"],
};
const quote = (name) => `"${name.replace(/"/g, '""')}"`;

async function schema(db) {
  const result = new Map();
  for (const { name } of await db.all("SELECT name FROM sqlite_master WHERE type='table'")) {
    result.set(name, await db.all(`PRAGMA table_info(${quote(name)})`));
  }
  return result;
}

export async function buildIdentityMergePlan(db, verifiedUsers, { observations: sharedObservations = [] } = {}) {
  const tables = await schema(db);
  const names = new Set();
  for (const [table, columns] of Object.entries(referenceColumns)) {
    for (const column of columns) {
      if (!tables.get(table)?.some((entry) => entry.name === column)) continue;
      for (const row of await db.all(
        `SELECT DISTINCT ${quote(column)} AS name FROM ${quote(table)} WHERE ${quote(column)} GLOB '*[^ -~]*'`,
      )) names.add(row.name);
    }
  }
  const usersById = new Map(verifiedUsers.map((user) => [user.id, user]));
  const aliases = new Map();
  const observations = await getLegacyIdentityObservations(db);
  observations.push(...sharedObservations);
  observations.push(...verifiedUsers.map((user) => ({
    twitch_user_id: user.id, alias: user.display_name,
  })));
  for (const observation of observations) {
    // A missing/deleted account still supplies evidence about who owned an old name.
    // Do not merge its history into a different verified user who later reused it.
    if (!observation.alias) continue;
    const alias = normalizeMention(observation.alias);
    if (!aliases.has(alias)) aliases.set(alias, new Set());
    aliases.get(alias).add(observation.twitch_user_id);
  }
  const groups = new Map();
  const unresolved = [];
  for (const name of names) {
    const ids = aliases.get(normalizeMention(name));
    if (ids?.size !== 1 || !usersById.has([...ids][0])) {
      unresolved.push(name);
      continue;
    }
    const user = usersById.get([...ids][0]);
    if (!/^\d+$/.test(user.id) || !isTwitchLogin(user.login)) {
      throw new Error("Twitch returned an invalid identity; migration cancelled.");
    }
    if (!groups.has(user.id)) groups.set(user.id, { ...user, sources: [] });
    groups.get(user.id).sources.push(name);
  }
  const merges = [...groups.values()];
  for (const merge of merges) {
    merge.existingPoints = (await db.get("SELECT points FROM users WHERE username = ?", [merge.login]))?.points || 0;
    merge.combinedPoints = merge.existingPoints;
    for (const source of merge.sources) {
      merge.combinedPoints += (await db.get("SELECT points FROM users WHERE username = ?", [source]))?.points || 0;
    }
  }
  return { merges, unresolved, identities: verifiedUsers };
}

async function mergeAggregateTable(db, tables, table, source, login, keys, policies) {
  const columns = tables.get(table);
  if (!columns) return;
  const values = columns.filter((column) => !keys.includes(column.name));
  const updates = values.map((column) => {
    const policy = policies[column.name] || policies["*"];
    if (!policy || !/INT|REAL|NUM|FLOAT|DOUBLE/i.test(column.type)) {
      throw new Error(`No safe merge rule for ${table}.${column.name}; no data was changed.`);
    }
    const current = `COALESCE(${quote(table)}.${quote(column.name)}, 0)`;
    const incoming = `COALESCE(excluded.${quote(column.name)}, 0)`;
    return `${quote(column.name)} = ${policy === "sum" ? `${current} + ${incoming}` : `MAX(${current}, ${incoming})`}`;
  });
  await db.run(
    `INSERT INTO ${quote(table)} (${columns.map((column) => quote(column.name)).join(", ")})
     SELECT ${columns.map((column) => column.name === "username" ? "?" : quote(column.name)).join(", ")}
     FROM ${quote(table)} WHERE username = ?
     ON CONFLICT(${keys.map(quote).join(", ")}) DO UPDATE SET ${updates.join(", ")}`,
    [login, source],
  );
  await db.run(`DELETE FROM ${quote(table)} WHERE username = ?`, [source]);
}

export async function applyIdentityMergePlan(db, plan) {
  // Run before chat/timers start, or offline on a copy. Archives commit with the merges.
  await db.exec("BEGIN IMMEDIATE");
  try {
    await ensureIdentitySchema(db);
    await db.exec(`CREATE TABLE IF NOT EXISTS identity_merge_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twitch_user_id TEXT NOT NULL,
      login TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      original_records_json TEXT NOT NULL,
      merged_at INTEGER NOT NULL
    )`);
    const directory = new TwitchIdentityDirectory(() => db);
    for (const user of plan.identities) await directory.observe(user);
    const tables = await schema(db);
    for (const merge of plan.merges) {
      await directory.observe(merge, merge.sources);
      const snapshot = {};
      for (const [table, names] of Object.entries(referenceColumns)) {
        const columns = names.filter((column) => tables.get(table)?.some((entry) => entry.name === column));
        if (!columns.length) continue;
        const accountNames = [merge.login, ...merge.sources];
        const placeholders = accountNames.map(() => "?").join(",");
        snapshot[table] = await db.all(
          `SELECT * FROM ${quote(table)} WHERE ${columns.map((column) => `${quote(column)} IN (${placeholders})`).join(" OR ")}`,
          columns.flatMap(() => accountNames),
        );
      }
      await db.run(
        `INSERT INTO identity_merge_history
         (twitch_user_id, login, sources_json, original_records_json, merged_at) VALUES (?, ?, ?, ?, ?)`,
        [merge.id, merge.login, JSON.stringify(merge.sources), JSON.stringify(snapshot), Date.now()],
      );
      for (const source of merge.sources) {
        if (tables.has("pending_fish")) {
          const fishes = await db.all("SELECT * FROM pending_fish WHERE username IN (?, ?)", [source, merge.login]);
          if (fishes.length > 1) {
            throw new Error(`Both ${source} and ${merge.login} have pending fishing. Let a catch finish before migrating; no merges were applied.`);
          }
          await db.run("UPDATE pending_fish SET username = ? WHERE username = ?", [merge.login, source]);
        }
        await mergeAggregateTable(db, tables, "users", source, merge.login, ["username"], {
          points: "sum", xp: "sum", last_message_time: "max",
          true_last_chat_time: "max", timeout_until: "max",
        });
        await mergeAggregateTable(db, tables, "user_stats", source, merge.login, ["username"], { "*": "sum" });
        await mergeAggregateTable(db, tables, "user_inventory", source, merge.login, ["username", "item_name"], { quantity: "sum" });
        await mergeAggregateTable(db, tables, "user_modifiers", source, merge.login, ["username", "modifier"], { value: "sum" });
        for (const table of ["active_effects", "user_submissions", "trivia_questions", "playsounds_metadata", "chatter_subscription_status"]) {
          for (const column of referenceColumns[table]) {
            if (!tables.get(table)?.some((entry) => entry.name === column)) continue;
            await db.run(`UPDATE ${quote(table)} SET ${quote(column)} = ? WHERE ${quote(column)} = ?`, [merge.login, source]);
          }
        }
      }
    }
    const check = await db.get("PRAGMA quick_check");
    if (Object.values(check)[0] !== "ok") throw new Error("Database integrity check failed.");
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

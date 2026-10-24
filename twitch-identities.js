// Account keys are Twitch logins. Display names are aliases, never account keys.
export const normalizeMention = (value) =>
  String(value ?? "").trim().replace(/^@/, "").normalize("NFC").toLowerCase();

export const isTwitchLogin = (value) => /^[a-z0-9_]+$/.test(value);

export function ircLogin(source, tags = {}) {
  const login = String(source ?? "").match(/^:([^! ]+)!/)?.[1] || tags.login || "";
  const normalized = login.toLowerCase();
  return isTwitchLogin(normalized) ? normalized : null;
}

export function unescapeIrcTag(value = "") {
  return value.replace(/\\([s:nr\\])/g, (_, character) =>
    ({ s: " ", ":": ";", n: "\n", r: "\r", "\\": "\\" })[character],
  );
}

export async function ensureIdentitySchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS twitch_identities (
      twitch_user_id TEXT PRIMARY KEY,
      login TEXT NOT NULL,
      display_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_twitch_identities_login ON twitch_identities(login);
    CREATE TABLE IF NOT EXISTS twitch_identity_aliases (
      alias TEXT NOT NULL,
      twitch_user_id TEXT NOT NULL,
      PRIMARY KEY (alias, twitch_user_id)
    );
  `);
}

export class TwitchIdentityDirectory {
  constructor(getDb) {
    this.getDb = getDb;
    this.observed = new Map();
  }

  async observe(user, aliases = []) {
    const id = String(user.id || "");
    const login = String(user.login || "").toLowerCase();
    const displayName = user.display_name || login;
    if (!/^\d+$/.test(id) || !isTwitchLogin(login)) return;
    const db = this.getDb();
    // Swapping an uploaded database must also invalidate the observation cache.
    if (this.connection !== db) {
      this.connection = db;
      this.observed.clear();
    }
    const names = [...new Set([displayName, ...aliases].map(normalizeMention).filter(Boolean))];
    const signature = JSON.stringify([login, displayName, names]);
    if (this.observed.get(id) === signature) return;
    await db.run(
      `INSERT INTO twitch_identities (twitch_user_id, login, display_name, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(twitch_user_id) DO UPDATE SET
         login = excluded.login, display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
      [id, login, displayName, Date.now()],
    );
    for (const alias of names) {
      await db.run(
        "INSERT OR IGNORE INTO twitch_identity_aliases (alias, twitch_user_id) VALUES (?, ?)",
        [alias, id],
      );
    }
    this.observed.set(id, signature);
  }

  async resolve(value) {
    const name = normalizeMention(value);
    if (!name) return null;
    // An ASCII login is already canonical. Never interpret punctuation by deleting it.
    if (isTwitchLogin(name)) return name;
    const rows = await this.getDb().all(
      `SELECT DISTINCT i.twitch_user_id, i.login
       FROM twitch_identity_aliases a JOIN twitch_identities i
         ON i.twitch_user_id = a.twitch_user_id WHERE a.alias = ?`,
      [name],
    );
    // Historical aliases can be reused. Ambiguous aliases must not target another user.
    return rows.length === 1 ? rows[0].login : null;
  }
}

// Legacy observations contain a user ID even when their username was a display name.
export async function getLegacyIdentityObservations(db) {
  const tables = new Set((await db.all("SELECT name FROM sqlite_master WHERE type='table'"))
    .map((row) => row.name));
  const observations = [];
  if (tables.has("chatter_subscription_status")) {
    observations.push(...await db.all(
      "SELECT twitch_user_id, username AS alias FROM chatter_subscription_status WHERE username GLOB '*[^ -~]*'",
    ));
  }
  if (tables.has("twitch_identities")) {
    observations.push(...await db.all(
      `SELECT i.twitch_user_id, a.alias FROM twitch_identities i
       LEFT JOIN twitch_identity_aliases a ON a.twitch_user_id = i.twitch_user_id`,
    ));
  }
  return observations;
}

export async function refreshIdentities(directory, databases, fetchUsers) {
  const observations = (await Promise.all(databases.map(getLegacyIdentityObservations))).flat();
  const ids = [...new Set(observations.map((row) => row.twitch_user_id))];
  const verifiedUsers = [];
  for (let index = 0; index < ids.length; index += 100) {
    const users = await fetchUsers(ids.slice(index, index + 100));
    verifiedUsers.push(...users);
    for (const user of users) {
      await directory.observe(user, observations
        .filter((row) => row.twitch_user_id === user.id)
        .map((row) => row.alias).filter(Boolean));
    }
  }
  return verifiedUsers;
}

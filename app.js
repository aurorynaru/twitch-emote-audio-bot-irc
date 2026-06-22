import WebSocket from 'ws';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
dotenv.config();

import { parseFlexibleTime, parseAmount, parseTime } from './utils.js';
import { setupRoutes, broadcastEmote, broadcastAudio, broadcastConfig, broadcastBetState, clearBetState, broadcastChatWarState, clearChatWarState, clearEmotes } from './routes.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const AUTH_CODE = process.env.AUTH_CODE
const TARGET_CHANNEL = process.env.TARGET_CHANNEL;
let USER_ACCESS_TOKEN = '';
let BOT_USERNAME = ''
const TOKEN_FILE = path.join(__dirname, 'data', 'tokens.json');
let COMMAND_COOLDOWN=process.env.COMMAND_COOLDOWN || 1000
const getDuelTax = () => parseFloat(globalConfig['duel_tax'] || '0.05');

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(path.join(__dirname, 'data', 'playsounds'))) {
  fs.mkdirSync(path.join(__dirname, 'data', 'playsounds'));
}

const globalConfig = {};
const customAliasesMap = new Map();
const ignoredBots = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'dotabod', 'wizebot', 'fossabot', 'kofibot', 'soundalerts'];
let streamStartTime = Date.now();

const builtInAliases = {
  '!point': '!points',
  '!pts': '!points',
  '!givepoint': '!givepoints',
  '!givept': '!givepoints',
  '!givepts': '!givepoints',
  '!startbet': '!betstart',
  '!stopbet': '!betstop',
  '!checkbet': '!betstatus',
  '!statusbet': '!betstatus',
  '!editpoint': '!editpoints',
  '!toppoint': '!toppoints',
  '!top': '!toppoints',
  '!leaderboard': '!toppoints',
  '!addpoint': '!masspointsadd',
  '!subpoint': '!masspointssub',
  '!delcommand': '!removecommand',
  '!deletecommand': '!removecommand',
  '!commands': '!commandlist',
  '!cmds': '!commandlist',
  '!cmdlist': '!commandlist',
  '!roulette': '!gamble',
  '!roll': '!gamble',
  '!setrewards': '!editrewards',
  '!buylvl': '!lvlup',
  '!buylevel': '!lvlup',
  '!buylevels': '!lvlup',
  '!levelup': '!lvlup',
  '!inv': '!inventory',
  '!redeem': '!use'
};

const commandConfigSchema = {
  '!playsound': ['cost', 'cooldown'],
  '!showemote': ['cost', 'duration', 'size', 'cooldown'],
  '!betstart': ['cost', 'cooldown'],
  '!betstop': ['cost', 'cooldown'],
  '!givepoints':['cooldown'],
  '!deleteplaysound': ['cooldown'],
  '!betstatus': ['cost', 'cooldown'],
  '!points': ['cost', 'cooldown'],
  '!toppoints': ['cost', 'cooldown'],
  '!editpoints': ['cooldown'],
  '!editcommand': ['cost', 'cooldown'],
  '!gamble': ['cost', 'cooldown'],
  '!refreshemotes': ['cost', 'cooldown'],
  '!addcommand': ['cost', 'cooldown'],
  '!removecommand': ['cost', 'cooldown'],
  '!commandlist': ['cost', 'cooldown'],
  '!chatwar': ['cost', 'cooldown'],
  '!chatwarcancel': ['cost', 'cooldown'],
  '!global': ['cooldown'],
  '!chatcooldown': ['cooldown'],
  '!clearoverlay': ['cooldown'],
  '!duel': ['cooldown'],
  '!acceptduel': ['cooldown'],
  '!declineduel': ['cooldown'],
  '!dueltax': ['cooldown'],
  '!disable': ['cooldown'],
  '!shoot': ['cost', 'duration', 'cooldown'],
  '!enable':['cooldown'],
  '!raffle': ['cooldown'],
  '!multiraffle': ['cooldown'],
  '!join': ['cooldown'],
  '!masspointsadd': ['cooldown'],
  '!masspointssub': ['cooldown'],
  '!editpoints': ['cooldown'],
  '!toppoints': ['cooldown'],
  '!editrewards': ['cooldown'],
  '!lvlup': ['cooldown'],
  '!use': ['cooldown'],
  '!fish': ['cost','cooldown'],
  '!inventory': ['cooldown'],
  '!buffs': ['cooldown'],
  '!emotesize': ['cooldown'],
  '!emoteduration': ['cooldown'],
  '!removepoints': ['cooldown'],
  '!betcancel': ['cooldown'],
  '!bet': ['cooldown']
};

const activeDuels = new Map();

const duelWinMessages = [
  "{winner} absolutely destroyed {loser} and took their {amount} points!",
  "{winner} styled on {loser} and walked away with {amount} points!",
  "{loser} tripped on a rock, giving {winner} an easy {amount} points victory!",
  "It was a close battle, but {winner} came out on top against {loser} for {amount} points!",
  "{winner} just sent {loser} to the shadow realm and claimed {amount} points!",
  "EZ Clap for {winner}! {loser} stood no chance. (+{amount} points)",
  "{winner} outsmarted {loser} in combat and secured {amount} points!",
  "Flawless victory for {winner} over {loser}! Here's {amount} points!",
  "{winner} hit {loser} with a folding chair! {amount} points secured!",
  "{loser} thought they had a chance, but {winner} took their {amount} points anyway!",
  "A swift kick to the shins by {winner} leaves {loser} crying without their {amount} points!",
  "{winner} parried {loser}'s attack and counter-struck for {amount} points!",
  "{winner} 360-no-scoped {loser} for an easy {amount} points!"
];

const duelTimeoutMessages = [
  "{target} was too scared to face {challenger} in a duel! Points refunded.",
  "{target} ran away from {challenger}'s duel!",
  "The duel timer ran out! {target} ignored {challenger}."
];

const duelBrokeMessages = [
  "{target} tried to accept {challenger}'s duel, but they are too broke!",
  "The duel is canceled because {target} doesn't have {amount} points!"
];

let FISHING_ITEMS = {
  common: [],
  uncommon: [],
  rare: [],
  legendary: []
};
let ITEMS_REGISTRY = {};

async function loadItemsConfig() {
  try {
    let itemsFromDb = await db.all('SELECT * FROM items');
    
    // Migration logic
    if (itemsFromDb.length === 0 && fs.existsSync('./items.json')) {
      console.log('* Migrating items from items.json to database...');
      const data = fs.readFileSync('./items.json', 'utf8');
      const parsed = JSON.parse(data);
      for (const [name, info] of Object.entries(parsed)) {
        await db.run(`
          INSERT INTO items (name, rarity, description, effectType, effectValue, effectDurationMinutes, isGlobal, uses, autoConsume, isPercentage, maxGambleLimit)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          name, info.rarity || 'Common', info.description || '', info.effectType || '', info.effectValue || 0,
          info.effectDurationMinutes || 0, info.isGlobal ? 1 : 0, info.uses || 1, info.autoConsume ? 1 : 0,
          info.isPercentage ? 1 : 0, info.maxGambleLimit || 0
        ]);
      }
      itemsFromDb = await db.all('SELECT * FROM items');
    }

    for (let key in ITEMS_REGISTRY) delete ITEMS_REGISTRY[key];
    FISHING_ITEMS.common = [];
    FISHING_ITEMS.uncommon = [];
    FISHING_ITEMS.rare = [];
    FISHING_ITEMS.legendary = [];

    for (const row of itemsFromDb) {
      const lowerName = row.name.toLowerCase();
      // Reconstruct object in memory
      const info = {
        name: row.name,
        rarity: row.rarity,
        description: row.description,
        effectType: row.effectType,
        effectValue: row.effectValue,
        effectDurationMinutes: row.effectDurationMinutes,
        isGlobal: row.isGlobal === 1,
        uses: row.uses,
        autoConsume: row.autoConsume === 1,
        isPercentage: row.isPercentage === 1,
        maxGambleLimit: row.maxGambleLimit
      };
      
      ITEMS_REGISTRY[lowerName] = info;
      const rarity = info.rarity.toLowerCase();
      if (FISHING_ITEMS[rarity]) {
        FISHING_ITEMS[rarity].push({ 
          name: lowerName, 
          originalName: row.name, 
          rarity: info.rarity, 
          description: info.description,
          effectType: info.effectType,
          effectValue: info.effectValue,
          uses: info.uses,
          effectDurationMinutes: info.effectDurationMinutes,
          isGlobal: info.isGlobal ? 1 : 0
        });
      }
    }
    console.log(`* Loaded ${Object.keys(ITEMS_REGISTRY).length} items from database`);
  } catch (err) {
    console.error('Error loading items:', err);
  }
}

const FISHING_RARITIES = [
  { rarity: 'legendary', threshold: 0.7 },
  { rarity: 'rare', threshold: 10.7 },
  { rarity: 'uncommon', threshold: 45.7 },
  { rarity: 'common', threshold: 100.0 }
];

let db;
async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      points INTEGER DEFAULT 0,
      last_message_time INTEGER DEFAULT 0
    )
  `);
  
  try {
    await db.exec('ALTER TABLE users ADD COLUMN true_last_chat_time INTEGER DEFAULT 0');
  } catch (err) {}

  try {
    await db.exec('ALTER TABLE users ADD COLUMN xp INTEGER DEFAULT 0');
  } catch (err) {}

  try {
    await db.exec('ALTER TABLE users ADD COLUMN timeout_until INTEGER DEFAULT 0');
  } catch (err) {}

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_points ON users (points DESC);
    CREATE INDEX IF NOT EXISTS idx_users_true_last_chat_time ON users (true_last_chat_time);
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS active_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_user TEXT,
      effect_type TEXT,
      effect_value REAL,
      expires_at INTEGER,
      uses_left INTEGER
    )
  `);

  try {
    await db.exec('ALTER TABLE active_effects ADD COLUMN caster TEXT');
  } catch (err) {
    // Column might already exist
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_stats (
      username TEXT PRIMARY KEY,
      duels_played INTEGER DEFAULT 0,
      duels_won INTEGER DEFAULT 0,
      duels_lost INTEGER DEFAULT 0,
      duels_points_won INTEGER DEFAULT 0,
      duels_points_lost INTEGER DEFAULT 0,
      raffles_joined INTEGER DEFAULT 0,
      raffles_won INTEGER DEFAULT 0,
      raffles_points_won INTEGER DEFAULT 0,
      gamble_played INTEGER DEFAULT 0,
      gamble_won INTEGER DEFAULT 0,
      gamble_lost INTEGER DEFAULT 0,
      gamble_points_won INTEGER DEFAULT 0,
      gamble_points_lost INTEGER DEFAULT 0,
      bets_played INTEGER DEFAULT 0,
      bets_won INTEGER DEFAULT 0,
      bets_lost INTEGER DEFAULT 0,
      bets_points_bet INTEGER DEFAULT 0,
      bets_points_won INTEGER DEFAULT 0,
      bets_points_lost INTEGER DEFAULT 0,
      chatwar_spent INTEGER DEFAULT 0,
      chatwar_lost INTEGER DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS emote_stats (
      emote TEXT PRIMARY KEY,
      chatwar_battles INTEGER DEFAULT 0,
      chatwar_wins INTEGER DEFAULT 0,
      chatwar_points_spent INTEGER DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      name TEXT PRIMARY KEY,
      rarity TEXT,
      description TEXT,
      effectType TEXT,
      effectValue REAL,
      effectDurationMinutes INTEGER,
      isGlobal INTEGER,
      uses INTEGER,
      autoConsume INTEGER,
      isPercentage INTEGER,
      maxGambleLimit INTEGER
    )
  `);

  try {
    await db.exec('ALTER TABLE emote_stats ADD COLUMN chatwar_points_spent INTEGER DEFAULT 0');
  } catch (err) { }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      username TEXT,
      item_name TEXT,
      quantity INTEGER DEFAULT 0,
      PRIMARY KEY (username, item_name)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS pending_fish (
      username TEXT PRIMARY KEY,
      catch_time INTEGER,
      is_free INTEGER DEFAULT 0
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_modifiers (
      username TEXT,
      modifier TEXT,
      value INTEGER DEFAULT 0,
      PRIMARY KEY (username, modifier)
    )
  `);

  console.log('* Ensuring app_config defaults...');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS custom_aliases (
      command TEXT PRIMARY KEY,
      cost INTEGER,
      action TEXT
    )
  `);

  const configs = await db.all('SELECT * FROM app_config');
  for (const row of configs) {
    globalConfig[row.key] = row.value;
  }

  const aliases = await db.all('SELECT * FROM custom_aliases');
  for (const row of aliases) {
    customAliasesMap.set(row.command, { cost: row.cost, action: row.action });
  }


  try {
    await db.run('UPDATE users SET points = CAST(points AS INTEGER)');
    console.log('* Ensured all user points are integers.');

    // Migrate bomb to rng_effect
    await db.run("UPDATE items SET effectType = 'rng_effect' WHERE effectType = 'bomb'");
    await db.run("UPDATE active_effects SET effect_type = 'rng_effect' WHERE effect_type = 'bomb'");
    
    // Refresh items config after migration
    if (loadItemsConfig) await loadItemsConfig();
    
  } catch (err) {
    console.error('Error cleaning up database / migrating:', err);
  }
}

async function swapDatabase() {
  if (db) {
    await db.close();
    db = null;
  }
  const stagingPath = path.join(__dirname, 'data', 'database_staging.sqlite');
  const actualPath = path.join(__dirname, 'data', 'database.sqlite');
  if (fs.existsSync(stagingPath)) {
    if (fs.existsSync(actualPath)) fs.unlinkSync(actualPath);
    fs.renameSync(stagingPath, actualPath);
  }
  await initDb();
  await loadItemsConfig();
}


async function updateUserStat(username, field, amount) {
  if (!db || !username || !field) return;
  try {
    await db.run(
      `INSERT INTO user_stats (username, ${field}) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET ${field} = ${field} + ?`,
      [username, amount, amount]
    );
  } catch (err) {
    console.error(`Error updating user_stats for ${username} on field ${field}:`, err);
  }
}

async function updateEmoteStat(emote, isWinner) {
  if (!db || !emote) return;
  try {
    const winsVal = isWinner ? 1 : 0;
    await db.run(
      `INSERT INTO emote_stats (emote, chatwar_battles, chatwar_wins) VALUES (?, 1, ?) ON CONFLICT(emote) DO UPDATE SET chatwar_battles = chatwar_battles + 1, chatwar_wins = chatwar_wins + ?`,
      [emote, winsVal, winsVal]
    );
  } catch (err) {
    console.error(`Error updating emote_stats for ${emote}:`, err);
  }
}

async function updateRaffleStats(participants, winnersArray, pointsWonPerWinner) {
  if (!participants || participants.length === 0) return;
  for (const user of participants) {
    await updateUserStat(user, 'raffles_joined', 1);
  }
  for (const winner of winnersArray) {
    await updateUserStat(winner, 'raffles_won', 1);
    await updateUserStat(winner, 'raffles_points_won', pointsWonPerWinner);
  }
}

async function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  }
  return null;
}

async function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function exchangeAuthCode() {
  console.log('* First time setup! Exchanging Auth Code for permanent tokens...');
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: AUTH_CODE,
      grant_type: 'authorization_code',
      redirect_uri: 'http://localhost'
    })
  });
  const data = await res.json();
  if (data.access_token) {
    await saveTokens(data);
    return data.access_token;
  } else {
    throw new Error('Failed to exchange auth code. Make sure you pasted the code and secret correctly: ' + JSON.stringify(data));
  }
}

async function refreshAccessToken(refreshToken) {
  console.log('* Token expired! Automatically fetching a new one in the background...');
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json();
  if (data.access_token) {
    await saveTokens(data);
    return data.access_token;
  } else {
    throw new Error('Failed to refresh token: ' + JSON.stringify(data));
  }
}

async function getValidAccessToken() {
  let tokens = await loadTokens();

  if (!tokens) {
    if (!AUTH_CODE || !CLIENT_SECRET) {
      throw new Error('No tokens.json found, and AUTH_CODE/CLIENT_SECRET are missing! Please fill them in at the top of app.js.');
    }
    const token = await exchangeAuthCode();
    return token;
  }


  const res = await fetch('https://api.twitch.tv/helix/users', {
    headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Client-Id': CLIENT_ID }
  });

  if (res.status === 401) {

    const newToken = await refreshAccessToken(tokens.refresh_token);
    return newToken;
  }

  return tokens.access_token;
}


const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/playsounds', express.static(path.join(__dirname, 'data', 'playsounds')));

function clearOverlaySystem() {
  if (activeBets.has('default')) {
    const bet = activeBets.get('default');
    bet.isHidden = true;
    clearBetState(null);
  }
  
  if (activeChatWar) {
    activeChatWar.isHidden = true;
    clearChatWarState(null);
  }

  clearEmotes();
  sendChatMessage(`Overlay cleared by Admin Dashboard!`);
}

setupRoutes(app, {
  getDb: () => db,
  globalConfig,
  customAliasesMap,
  commandConfigSchema,
  FISHING_ITEMS,
  FISHING_RARITIES,
  swapDatabase,
  clearOverlaySystem,
  loadItemsConfig
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`* Emote Overlay Server running on port ${PORT}!`);
  console.log(`* OBS Users: Add Browser Source: http://localhost:${PORT}/overlay`);
  console.log(`==================================================\n`);
});



let thirdPartyEmotes = new Map();
let sevenTvEmoteSetId = null;
let lastRefreshTime = 0;
const REFRESH_COOLDOWN_MS = 10000;

async function loadThirdPartyEmotes(broadcasterId) {
  console.log('* Loading 3rd party emotes (7TV, BTTV, FFZ)...');
  try {
    const res7tv = await fetch(`https://7tv.io/v3/users/twitch/${broadcasterId}`);
    if (res7tv.ok) {
      const data = await res7tv.json();
      if (data.emote_set && data.emote_set.emotes) {
        sevenTvEmoteSetId = data.emote_set.id;
        data.emote_set.emotes.forEach(emote => {
          const flags = emote.data ? emote.data.flags : emote.flags;
          const isZeroWidth = (flags & 256) === 256;
          thirdPartyEmotes.set(emote.name, { url: `https://cdn.7tv.app/emote/${emote.id}/4x.webp`, isZeroWidth });
        });
      }
    }

    const res7tvGlobal = await fetch('https://7tv.io/v3/emote-sets/global');
    if (res7tvGlobal.ok) {
      const data = await res7tvGlobal.json();
      if (data.emotes) data.emotes.forEach(emote => {
        const flags = emote.data ? emote.data.flags : emote.flags;
        const isZeroWidth = (flags & 256) === 256;
        thirdPartyEmotes.set(emote.name, { url: `https://cdn.7tv.app/emote/${emote.id}/4x.webp`, isZeroWidth });
      });
    }

    const resBttvGlobal = await fetch('https://api.betterttv.net/3/cached/emotes/global');
    if (resBttvGlobal.ok) {
      const bttvGlobal = await resBttvGlobal.json();
      bttvGlobal.forEach(emote => thirdPartyEmotes.set(emote.code, { url: `https://cdn.betterttv.net/emote/${emote.id}/3x`, isZeroWidth: false }));
    }

    const resBttvChannel = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${broadcasterId}`);
    if (resBttvChannel.ok) {
      const bttvChannel = await resBttvChannel.json();
      if (bttvChannel.channelEmotes) bttvChannel.channelEmotes.forEach(emote => thirdPartyEmotes.set(emote.code, { url: `https://cdn.betterttv.net/emote/${emote.id}/3x`, isZeroWidth: false }));
      if (bttvChannel.sharedEmotes) bttvChannel.sharedEmotes.forEach(emote => thirdPartyEmotes.set(emote.code, { url: `https://cdn.betterttv.net/emote/${emote.id}/3x`, isZeroWidth: false }));
    }

    const resFfzGlobal = await fetch('https://api.betterttv.net/3/cached/frankerfacez/emotes/global');
    if (resFfzGlobal.ok) {
      const ffzGlobal = await resFfzGlobal.json();
      ffzGlobal.forEach(emote => thirdPartyEmotes.set(emote.code, { url: `https://cdn.betterttv.net/frankerfacez_emote/${emote.id}/4`, isZeroWidth: false }));
    }

    const resFfzChannel = await fetch(`https://api.betterttv.net/3/cached/frankerfacez/users/twitch/${broadcasterId}`);
    if (resFfzChannel.ok) {
      const ffzChannel = await resFfzChannel.json();
      ffzChannel.forEach(emote => thirdPartyEmotes.set(emote.code, { url: `https://cdn.betterttv.net/frankerfacez_emote/${emote.id}/4`, isZeroWidth: false }));
    }

    console.log(`* Successfully loaded ${thirdPartyEmotes.size} total 3rd-party emotes into memory!`);

  } catch (err) {
    console.error('! Failed to load some 3rd party emotes:', err);
  }
}

async function start() {
  await initDb();
  await loadItemsConfig();
  console.log('* SQLite Database Initialized!');

  try {
    USER_ACCESS_TOKEN = await getValidAccessToken();
  } catch (err) {
    console.error('! Authentication Error:', err.message);
    console.error('! Did you forget to paste your CLIENT_SECRET or AUTH_CODE?');
    return;
  }

  console.log('* Fetching Twitch User IDs...');

  const userRes = await fetch(`https://api.twitch.tv/helix/users?login=${TARGET_CHANNEL}`, {
    headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
  });
  const userData = await userRes.json();
  const BROADCASTER_USER_ID = userData.data[0].id;

  const myRes = await fetch('https://api.twitch.tv/helix/users', {
    headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
  });
  const myData = await myRes.json();
  const YOUR_USER_ID = myData.data[0].id;
  BOT_USERNAME = myData.data[0].login;
  console.log(`* Bot User ID: ${YOUR_USER_ID} (${BOT_USERNAME})`);
  console.log(`* Target channel: ${TARGET_CHANNEL} (Broadcaster ID: ${BROADCASTER_USER_ID})`);


  const getLevelBase = () => parseInt(globalConfig['level_base_cost'] || '200', 10);
  const getLvl = (xp) => Math.floor(Math.sqrt((xp || 0) / getLevelBase())) + 1;
  const getXpForLvl = (lvl) => getLevelBase() * Math.pow(lvl - 1, 2);
  
  const getLegBonusRate = () => parseFloat(globalConfig['leg_bonus_rate'] || '0.01');
  const getRareBonusRate = () => parseFloat(globalConfig['rare_bonus_rate'] || '0.05');
  const getPointsBonusRate = () => parseFloat(globalConfig['lvl_bonus_rate'] || '0.001');
  const getPointsToXpRate = () => parseFloat(globalConfig['points_to_xp_rate'] || '1');

  async function getActiveEffects(username, effectType) {
    const now = Date.now();
    await db.run('DELETE FROM active_effects WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
    await db.run('DELETE FROM active_effects WHERE uses_left IS NOT NULL AND uses_left <= 0');
    return await db.all(
      'SELECT * FROM active_effects WHERE (target_user = ? OR target_user = "GLOBAL") AND effect_type = ?',
      [username, effectType]
    );
  }

  async function distributeRobinHoodTax(taxAmount) {
    if (taxAmount <= 0) return;
    await isStreamerLive(); // Fetch latest start time if live
    const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
    const row = await db.get(`SELECT COUNT(*) as count FROM users WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [streamStartTime]);
    const count = row ? row.count : 0;
    if (count > 0) {
      const splitAmount = Math.floor(taxAmount / count);
      if (splitAmount > 0) {
        await db.run(`UPDATE users SET points = points + ? WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [splitAmount, streamStartTime]);
      }
    }
  }
  
  async function addPointsWithBonus(username, amount) {
    const userRow = await db.get('SELECT xp FROM users WHERE username = ?', [username]);
    const xp = userRow ? userRow.xp : 0;
    const lvl = getLvl(xp);
    const lvlBonus = Math.round(amount * (lvl * getPointsBonusRate()));
    
    // Check for item buffs/debuffs
    const personalBoosts = await getActiveEffects(username, 'personal_point_boost');
    const globalBoosts = await getActiveEffects(username, 'global_point_boost');
    const globalDebuffs = await getActiveEffects(username, 'global_point_debuff');
    const personalDebuffs = await getActiveEffects(username, 'personal_point_debuff_target');
    

    let multiplier = 1.0;
    for (const b of personalBoosts) multiplier *= (1 + b.effect_value);
    for (const b of globalBoosts) multiplier *= (1 + b.effect_value);
    for (const b of globalDebuffs) {
      if (b.caster !== username) {
        const evaders = await db.all('SELECT * FROM active_effects WHERE target_user = ? AND effect_type = "tax_evader" AND uses_left > 0', [username]);
        if (evaders.length > 0) {
           if (evaders[0].uses_left > 1) {
              await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [evaders[0].id]);
           } else {
              await db.run('DELETE FROM active_effects WHERE id = ?', [evaders[0].id]);
           }
           continue;
        }
        multiplier *= (1 - b.effect_value);
      }
    }
    
    for (const b of personalDebuffs) {
      const evaders = await db.all('SELECT * FROM active_effects WHERE target_user = ? AND effect_type = "tax_evader" AND uses_left > 0', [username]);
      if (evaders.length > 0) {
         if (evaders[0].uses_left > 1) {
            await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [evaders[0].id]);
         } else {
            await db.run('DELETE FROM active_effects WHERE id = ?', [evaders[0].id]);
         }
         continue;
      }
      multiplier *= (1 - b.effect_value);
    }
    
    // Calculate final
    let itemBonus = Math.round((amount * multiplier) - amount);
    
    const finalAmount = amount + lvlBonus + itemBonus;
    await db.run('INSERT INTO users (username, points, xp) VALUES (?, ?, 0) ON CONFLICT(username) DO UPDATE SET points = points + ?', [username, finalAmount, finalAmount]);
    
    // Tax Collector (only global effect, but applies to the collector's points)
    // Avoid recursion if adding tax collector points, but since it's a global passive, we can just do:
    const taxCollectors = await db.all('SELECT target_user, effect_value FROM active_effects WHERE effect_type = "tax_collector" AND target_user != ?', [username]);
    for (const collector of taxCollectors) {
      const taxAmount = Math.max(1, Math.round(finalAmount * collector.effect_value));
      // Give tax directly to them without bonuses to prevent infinite loops
      await db.run('UPDATE users SET points = points + ? WHERE username = ?', [taxAmount, collector.target_user]);
    }
    
    return finalAmount;
  }

  async function sendChatMessage(messageText, author = null) {
    try {
      if (author) {
        const userRow = await db.get('SELECT xp FROM users WHERE username = ?', [author]);
        const xp = userRow ? userRow.xp : 0;
        const lvl = getLvl(xp);
        
        // Find the author's name in the message (with optional @) and insert the level before it
        const nameRegex = new RegExp(`(@?${author})`, 'i');
        if (nameRegex.test(messageText)) {
          messageText = messageText.replace(nameRegex, `[${lvl}]$1`);
        } else {
          messageText = `[${lvl}]` + messageText;
        }
      }
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.send(`PRIVMSG #${TARGET_CHANNEL.toLowerCase()} :${messageText}`);
      } else {
        console.error('! Cannot send chat message, IRC disconnected.');
      }
    } catch (err) {
      console.error('! Error sending chat message:', err);
    }
  }

  await loadThirdPartyEmotes(BROADCASTER_USER_ID);

  const pendingActivityUpdates = new Map();
  setInterval(async () => {
    if (pendingActivityUpdates.size === 0 || !db) return;
    const updates = Array.from(pendingActivityUpdates.entries());
    pendingActivityUpdates.clear();
    
    try {
      await db.exec('BEGIN TRANSACTION');
      for (const [username, data] of updates) {
        if (data.isNew) {
          await db.run('INSERT INTO users (username, points, last_message_time, true_last_chat_time) VALUES (?, ?, ?, ?) ON CONFLICT(username) DO UPDATE SET true_last_chat_time = ?', 
            [username, data.pointsReward, data.lastMessageTime, data.trueLastChatTime, data.trueLastChatTime]);
        } else if (data.awardedPoints) {
          await db.run('UPDATE users SET points = points + ?, last_message_time = ?, true_last_chat_time = ? WHERE username = ?', 
            [data.pointsReward, data.lastMessageTime, data.trueLastChatTime, username]);
        } else {
          await db.run('UPDATE users SET true_last_chat_time = ? WHERE username = ?', 
            [data.trueLastChatTime, username]);
        }
      }
      await db.exec('COMMIT');
    } catch (e) {
      console.error('Batch chat update failed:', e);
      await db.exec('ROLLBACK');
    }
  }, 10000);

  setInterval(async () => {
    try {
      const now = Date.now();
      const readyFishes = await db.all('SELECT * FROM pending_fish WHERE catch_time <= ?', [now]);
      
      let processedUsernames = [];

      for (const fish of readyFishes) {
        const userRow = await db.get('SELECT xp FROM users WHERE username = ?', [fish.username]);
        const lvl = getLvl(userRow ? userRow.xp : 0);
        const rarityBoosts = await getActiveEffects(fish.username, 'rarity_boost');
        let rarityBoostVal = 0;
        for (const b of rarityBoosts) rarityBoostVal += b.effect_value;

        const legBonus = (lvl * getLegBonusRate()) + (rarityBoostVal / 2);
        const rareBonus = (lvl * getRareBonusRate()) + rarityBoostVal;

        const customRarities = [
          { rarity: 'legendary', threshold: FISHING_RARITIES[0].threshold + legBonus },
          { rarity: 'rare', threshold: FISHING_RARITIES[1].threshold + legBonus + rareBonus },
          { rarity: 'uncommon', threshold: FISHING_RARITIES[2].threshold + legBonus + rareBonus },
          { rarity: 'common', threshold: 100.0 }
        ];

        let numCatches = 1;
        const multiCatch = await db.get('SELECT * FROM active_effects WHERE target_user = ? AND effect_type = ? AND uses_left > 0', [fish.username, 'multi_catch']);
        if (multiCatch) {
           numCatches += multiCatch.effect_value;
           if (multiCatch.uses_left > 1) {
              await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [multiCatch.id]);
           } else {
              await db.run('DELETE FROM active_effects WHERE id = ?', [multiCatch.id]);
           }
        }
        
        let allItemsCaught = [];
        let autoConsumedMsgs = [];

        for (let c = 0; c < numCatches; c++) {
            const roll = Math.random() * 100;
            let rarityTier = 'common';
            for (const tier of customRarities) {
              if (roll <= tier.threshold) {
                rarityTier = tier.rarity;
                break;
              }
            }
            
            const itemPool = FISHING_ITEMS[rarityTier];
            const item = itemPool[Math.floor(Math.random() * itemPool.length)];
            const itemConfig = ITEMS_REGISTRY[item.name];
            
            if (itemConfig && itemConfig.autoConsume) {
               if (itemConfig.effectType === 'instant_points') {
                  const prefix = rarityTier !== 'common' ? `[${item.rarity}] ` : '';
                  const isPercent = itemConfig.isPercentage || (Math.abs(itemConfig.effectValue) > 0 && Math.abs(itemConfig.effectValue) < 1);
                  
                  if (itemConfig.isGlobal) {
                     await isStreamerLive();
                     const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
                     if (isPercent) {
                        const modifier = itemConfig.effectValue;
                        if (modifier < 0) {
                           await db.run(`UPDATE users SET points = MAX(0, points + (points * ?)) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [modifier, streamStartTime]);
                        } else {
                           await db.run(`UPDATE users SET points = points + (points * ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [modifier, streamStartTime]);
                        }
                     } else {
                        const pts = Math.floor(itemConfig.effectValue);
                        if (pts < 0) {
                           await db.run(`UPDATE users SET points = MAX(0, points + ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [pts, streamStartTime]);
                        } else {
                           await db.run(`UPDATE users SET points = points + ? WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [pts, streamStartTime]);
                        }
                     }
                     autoConsumedMsgs.push(`${prefix}${item.originalName} ${itemConfig.description}`);
                  } else {
                     if (isPercent) {
                        const user = await db.get('SELECT points FROM users WHERE username = ?', [fish.username]);
                        const currPoints = user ? user.points : 0;
                        const modifier = Math.floor(currPoints * Math.abs(itemConfig.effectValue));
                        if (itemConfig.effectValue < 0) {
                           await db.run('UPDATE users SET points = MAX(0, CAST(points - ? AS INTEGER)) WHERE username = ?', [modifier, fish.username]);
                           autoConsumedMsgs.push(`${prefix}${item.originalName} drained ${modifier} points`);
                        } else {
                           const addedAmount = await addPointsWithBonus(fish.username, modifier);
                           autoConsumedMsgs.push(`${prefix}${item.originalName} granted ${addedAmount} points`);
                        }
                     } else {
                         const pts = Math.floor(itemConfig.effectValue);
                         if (pts < 0) {
                            await db.run('UPDATE users SET points = MAX(0, CAST(points + ? AS INTEGER)) WHERE username = ?', [Math.abs(pts), fish.username]);
                            autoConsumedMsgs.push(`${prefix}${item.originalName} drained ${Math.abs(pts)} points`);
                         } else {
                            const addedAmount = await addPointsWithBonus(fish.username, pts);
                            autoConsumedMsgs.push(`${prefix}${item.originalName} granted ${addedAmount} points`);
                         }
                     }
                  }
               }
            } else {
               await db.run('INSERT INTO user_inventory (username, item_name, quantity) VALUES (?, ?, 1) ON CONFLICT(username, item_name) DO UPDATE SET quantity = quantity + 1', [fish.username, item.originalName]);
               const prefix = rarityTier !== 'common' ? `[${item.rarity}] ` : '';
               allItemsCaught.push(`${prefix}${item.originalName}`);
            }
        }
        
        await db.run('DELETE FROM pending_fish WHERE username = ?', [fish.username]);
        processedUsernames.push(fish.username);
        
        if (readyFishes.length === 1) {
          let parts = [];
          if (allItemsCaught.length > 0) parts.push(`caught ${allItemsCaught.join(', ')}`);
          if (autoConsumedMsgs.length > 0) parts.push(`( ${autoConsumedMsgs.join(' | ')} )`);
          await sendChatMessage(`🎣 ${fish.username} reeled in their line and ${parts.join(' ')}`, fish.username);
        }
      }

   
      if (readyFishes.length > 1) {
        let displayNames = processedUsernames.slice(0, 3).join(', ');
        if (processedUsernames.length > 3) {
          displayNames += ` and ${processedUsernames.length - 3} more`;
        }
        await sendChatMessage(`🎣 ${displayNames} are done fishing! Type !inv to check what new items you caught (or points instantly awarded)!`);
      }
    } catch (err) {
      console.error('Error resolving fishes:', err);
    }
  }, 10000);

  
  async function buildRaffleParticipants(baseSet) {
    const baseUsers = Array.from(baseSet);
    let expanded = [];
    let guaranteed = [];

    for (const p of baseUsers) {
      const goldens = await getActiveEffects(p, 'golden_ticket');
      if (goldens.length > 0) {
         await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [goldens[0].id]);
         guaranteed.push(p);
      }

      const muls = await getActiveEffects(p, 'raffle_ticket_multiplier');
      let tickets = 1;
      for (const m of muls) {
         tickets += (m.effect_value - 1);
         await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [m.id]);
      }
      
      for (let i = 0; i < tickets; i++) expanded.push(p);
    }
    return { expanded, guaranteed };
  }

  const customCommands = {
    '!editconfig': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!hasPermission) {
          await sendChatMessage(`${chatterName}, you don't have permission to use this command!`, chatterName);
          return;
        }
        
        if (args.length < 2) {
          await sendChatMessage(`Usage: !editconfig <key> <value>. Available keys: level_base_cost, points_to_xp_rate, leg_bonus_rate, rare_bonus_rate, lvl_bonus_rate`, chatterName);
          return;
        }

        const key = args[0].toLowerCase();
        const value = args[1];
        
        const validKeys = [
          'level_base_cost', 'points_to_xp_rate', 'leg_bonus_rate', 'rare_bonus_rate', 'lvl_bonus_rate',
          'mod_wide_cost', 'mod_cursed_cost', 'mod_flipx_cost', 'mod_flipy_cost', 'mod_bounce_cost', 
          'mod_leave_cost', 'mod_arrive_cost', 'mod_jam_cost', 'mod_rainbow_cost', 'mod_hyper_cost'
        ];
        if (!validKeys.includes(key)) {
           await sendChatMessage(`Invalid key. Available keys: ${validKeys.join(', ')}`, chatterName);
           return;
        }

        // Save to DB
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [key, value, value]);
        globalConfig[key] = value; // Update in-memory
        
        await sendChatMessage(`Config '${key}' has been updated to ${value}!`, chatterName);
      }
    },
    '!lvlup': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        let user = await db.get('SELECT points, xp FROM users WHERE username = ?', chatterName);
        if (!user) {
          await db.run('INSERT OR IGNORE INTO users (username, points, xp) VALUES (?, 0, 0)', [chatterName]);
          user = { points: 0, xp: 0 };
        }

        const currentLvl = getLvl(user.xp);
        const nextLvlXp = getXpForLvl(currentLvl + 1);
        const xpNeeded = nextLvlXp - user.xp;

        if (args.length === 0) {
          await sendChatMessage(`${chatterName} you are Level ${currentLvl}! You need ${xpNeeded} more XP (points) for Level ${currentLvl + 1}.`, chatterName);
          return;
        }

        let spendAmount = 0;
        const arg = args[0].toLowerCase();
        
        if (arg === 'all') {
          spendAmount = user.points;
        } else if (arg.endsWith('%')) {
          const pct = parseFloat(arg.replace('%', ''));
          if (!isNaN(pct) && pct > 0 && pct <= 100) {
            spendAmount = Math.floor(user.points * (pct / 100));
          }
        } else {
          const parsed = parseInt(arg, 10);
          if (!isNaN(parsed) && parsed > 0) {
            spendAmount = parsed;
          }
        }

        if (spendAmount <= 0) {
          await sendChatMessage(`${chatterName} invalid amount! Use !lvlup <amount> or !lvlup 30% or !lvlup all`, chatterName);
          return;
        }

        if (user.points < spendAmount) {
          await sendChatMessage(`${chatterName} you don't have enough points!`, chatterName);
          return;
        }

        let gainedXp = Math.floor(spendAmount * getPointsToXpRate());
        
        const xpBoosts = await getActiveEffects(chatterName, 'personal_xp_boost');
        let xpMultiplier = 1.0;
        for (const b of xpBoosts) {
           xpMultiplier *= (1 + b.effect_value);
        }
        gainedXp = Math.floor(gainedXp * xpMultiplier);

        const newXp = user.xp + gainedXp;
        const newLvl = getLvl(newXp);
        const levelsGained = newLvl - currentLvl;

        await db.run('UPDATE users SET points = points - ?, xp = xp + ? WHERE username = ?', [spendAmount, gainedXp, chatterName]);

        if (levelsGained > 0) {
          await sendChatMessage(`${chatterName} spent ${spendAmount} points and gained ${levelsGained} level(s)! You are now Level ${newLvl}!`, chatterName);
        } else {
          const xpStillNeeded = getXpForLvl(newLvl + 1) - newXp;
          await sendChatMessage(`${chatterName} spent ${spendAmount} points! You need ${xpStillNeeded} more for Level ${newLvl + 1}.`, chatterName);
        }
      }
    },
    '!use': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (args.length === 0) {
          await sendChatMessage(`${chatterName}, please specify an item to use! Example: !use energy drink 1 london passport all`, chatterName);
          return;
        }

        let useTarget = null;
        let filteredArgs = [];
        for (const arg of args) {
          if (arg.startsWith('@')) {
            useTarget = arg.replace('@', '').toLowerCase();
          } else {
            filteredArgs.push(arg);
          }
        }

        let remainingInput = filteredArgs.join(' ').toLowerCase();
        let requestedItems = [];
        const validItems = Object.keys(ITEMS_REGISTRY).sort((a,b) => b.length - a.length);

        while (remainingInput.trim().length > 0) {
          remainingInput = remainingInput.trim();
          let matchedItem = null;
          
          for (const item of validItems) {
            const lowerItem = item.toLowerCase();
            if (remainingInput.startsWith(lowerItem) && (remainingInput.length === lowerItem.length || remainingInput[lowerItem.length] === ' ')) {
               matchedItem = item;
               break;
            }
          }
          
          if (!matchedItem) {
             const word = remainingInput.split(' ')[0];
             remainingInput = remainingInput.substring(word.length);
             if (!useTarget) {
                 useTarget = word.toLowerCase();
             }
             continue;
          }
          
          remainingInput = remainingInput.substring(matchedItem.length).trim();
          
          let qtyWord = remainingInput.split(' ')[0];
          let qty = 1;
          let hasQty = false;
          
          if (qtyWord === 'all') {
             qty = 'all';
             hasQty = true;
          } else if (!isNaN(parseInt(qtyWord, 10)) && parseInt(qtyWord, 10) > 0) {
             qty = parseInt(qtyWord, 10);
             hasQty = true;
          }
          
          if (hasQty) {
             remainingInput = remainingInput.substring(qtyWord.length);
          }
          
          requestedItems.push({ name: matchedItem, amountReq: qty });
        }

        if (requestedItems.length === 0) {
          await sendChatMessage(`${chatterName}, I couldn't recognize any items!`, chatterName);
          return;
        }

        let totalUsed = [];
        let totalPointsGained = 0;
        let chatMsgs = [];

        for (const req of requestedItems) {
          const lowerItemName = req.name;
          let itemConfig = { ...ITEMS_REGISTRY[lowerItemName] };
          const itemName = itemConfig && itemConfig.name ? itemConfig.name : lowerItemName; 
          
          const inventoryRow = await db.get('SELECT quantity FROM user_inventory WHERE username = ? AND item_name = ?', [chatterName, itemName]);
          if (!inventoryRow || inventoryRow.quantity <= 0) continue;

          const amountToUse = req.amountReq === 'all' ? inventoryRow.quantity : Math.min(req.amountReq, inventoryRow.quantity);
          if (amountToUse <= 0) continue;

          const chatMsgCountBefore = chatMsgs.length;
          const isLegacy = (lowerItemName === 'fishing ticket' || lowerItemName === 'knife');
          
          if (!isLegacy && (!itemConfig || !itemConfig.effectType || itemConfig.effectType === 'none')) continue;

          if (!isLegacy && itemConfig.effectType === 'rng_effect') {
              const possibleEffects = [
                  'instant_points', 'global_point_drain', 'global_point_boost', 'personal_point_boost', 
                  'fishing_time_reduction', 'tax_collector', 'global_point_debuff', 'gamble_guaranteed_win', 
                  'mirror_shield', 'rarity_boost', 'instant_catch', 'multi_catch', 'personal_xp_boost', 
                  'gamble_shield', 'fishing_debuff_target', 'tax_evader', 'steal_points', 
                  'destroy_points_target', 'personal_point_debuff_target', 'point_shield', 'point_defense', 
                  'duel_shield', 'duel_win_boost', 'gamble_multiplier', 'golden_ticket', 'raffle_ticket_multiplier'
              ];
              itemConfig.effectType = possibleEffects[Math.floor(Math.random() * possibleEffects.length)];
              
             
              const rolledEffect = itemConfig.effectType;
              if (['instant_points', 'global_point_drain', 'global_point_boost', 'tax_collector', 'steal_points', 'destroy_points_target'].includes(rolledEffect)) {

                  itemConfig.effectValue = Math.floor(Math.random() * 3401) + 100;
                  itemConfig.isPercentage = false;
              } else if (['point_defense', 'duel_shield', 'point_shield', 'global_point_debuff', 'personal_point_debuff_target'].includes(rolledEffect)) {
                  
                  itemConfig.effectValue = Number(((Math.random() * 0.4) + 0.1).toFixed(2));
                  itemConfig.isPercentage = false; 
              } else if (['personal_point_boost', 'duel_win_boost', 'gamble_multiplier', 'raffle_ticket_multiplier', 'personal_xp_boost'].includes(rolledEffect)) {
                  itemConfig.effectValue = Number(((Math.random() * 1.5) + 1.5).toFixed(2));
                  itemConfig.isPercentage = false;
              } else if (['fishing_time_reduction', 'fishing_debuff_target'].includes(rolledEffect)) {
      
                  itemConfig.effectValue = Math.floor(Math.random() * 10) + 1;
                  itemConfig.isPercentage = false;
              } else {
       
                  itemConfig.effectValue = 1;
              }
              
              let rngPrefix = `🎲 `;
              
          
              if (['global_point_debuff', 'personal_point_debuff_target', 'personal_point_boost', 'fishing_time_reduction', 'rarity_boost', 'personal_xp_boost'].includes(itemConfig.effectType)) {
                  if (!itemConfig.effectDurationMinutes || itemConfig.effectDurationMinutes <= 0) {
                      itemConfig.effectDurationMinutes = 5;
                  }
              }
              
        
              if (['fishing_debuff_target', 'steal_points', 'destroy_points_target', 'personal_point_debuff_target'].includes(itemConfig.effectType)) {
                  if (!useTarget || useTarget === chatterName) {
                      const randomRow = await db.get('SELECT username FROM users WHERE username != ? AND points > 0 ORDER BY RANDOM() LIMIT 1', [chatterName]);
                      if (randomRow) {
                          useTarget = randomRow.username;
                      } else {
                          useTarget = globalConfig['target_channel'];
                      }
                      rngPrefix += `🎯 `;
                  }
              }
              
              itemConfig.rngPrefix = rngPrefix;
          }

          if (!isLegacy) {
             const effType = itemConfig.effectType;
             if (['fishing_debuff_target', 'steal_points', 'destroy_points_target', 'personal_point_debuff_target'].includes(effType)) {
                 const actualTarget = useTarget || chatterName;
                 if (actualTarget === chatterName) {
                     chatMsgs.push(`⚠️ You must specify another user as a target to use ${itemName} !`);
                     continue;
                 }
             }
          }

          await db.run('UPDATE user_inventory SET quantity = quantity - ? WHERE username = ? AND item_name = ?', [amountToUse, chatterName, itemName]);

          if (isLegacy) {
            const usesPerItem = itemConfig ? (itemConfig.uses || 1) : 1;
            const totalGranted = amountToUse * usesPerItem;
            if (itemName === 'fishing ticket') {
              await db.run('INSERT INTO user_modifiers (username, modifier, value) VALUES (?, ?, ?) ON CONFLICT(username, modifier) DO UPDATE SET value = value + ?', [chatterName, 'free_fish', totalGranted, totalGranted]);
            } else if (itemName === 'knife') {
              await db.run('INSERT INTO user_modifiers (username, modifier, value) VALUES (?, ?, ?) ON CONFLICT(username, modifier) DO UPDATE SET value = value + ?', [chatterName, 'auto_duel', totalGranted, totalGranted]);
            }
            totalUsed.push(`${amountToUse}x ${itemName} `);
            continue;
          }

          const effectType = itemConfig.effectType;
          const baseValue = itemConfig.effectValue;
          const isGlobal = effectType.startsWith('global_') || itemConfig.isGlobal;
          const targetUser = isGlobal ? 'GLOBAL' : chatterName;

          if (effectType === 'instant_points') {
            const rawPointsToAdd = baseValue * amountToUse;
            if (isGlobal) {
              await isStreamerLive();
              const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
              if (itemConfig.isPercentage) {
                if (rawPointsToAdd > 0) {
                   await db.run(`UPDATE users SET points = points + (points * ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [rawPointsToAdd, streamStartTime]);
                   chatMsgs.push(`🎁 ${chatterName} used a global item! Everyone active this stream gained ${rawPointsToAdd * 100}% points!`);
                } else {
                   await db.run(`UPDATE users SET points = MAX(0, points + (points * ?)) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [rawPointsToAdd, streamStartTime]);
                   chatMsgs.push(`⚠️ ${chatterName} unleashed a global item! Everyone active this stream lost ${Math.abs(rawPointsToAdd * 100)}% points!`);
                }
              } else {
                if (rawPointsToAdd > 0) {
                   await db.run(`UPDATE users SET points = points + ? WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [rawPointsToAdd, streamStartTime]);
                   chatMsgs.push(`🎁 ${chatterName} used a global item! Everyone active this stream gained ${rawPointsToAdd} points!`);
                } else {
                   await db.run(`UPDATE users SET points = MAX(0, points + ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [rawPointsToAdd, streamStartTime]);
                   chatMsgs.push(`⚠️ ${chatterName} unleashed a global item! Everyone active this stream lost ${Math.abs(rawPointsToAdd)} points!`);
                }
              }
            } else {
              let pointsToAdd = rawPointsToAdd;
              if (itemConfig.isPercentage) {
                 const uRow = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
                 const currentPts = uRow ? uRow.points : 0;
                 pointsToAdd = Math.round(currentPts * rawPointsToAdd);
              }
              if (pointsToAdd > 0) {
                 const finalGained = await addPointsWithBonus(chatterName, pointsToAdd);
                 totalPointsGained += finalGained;
              } else {
                 await db.run('UPDATE users SET points = MAX(0, points + ?) WHERE username = ?', [pointsToAdd, chatterName]);
                 totalPointsGained += pointsToAdd;
              }
            }
          } else if (effectType === 'global_point_drain') {
            const drainAmount = itemConfig.effectValue * amountToUse;
            await db.run('UPDATE users SET points = MAX(0, points - ?) WHERE username != ?', [drainAmount, chatterName]);
            chatMsgs.push(`⚠️ A global point drain of ${drainAmount} points was unleashed!`);
          } else if (effectType === 'global_point_boost' || effectType === 'personal_point_boost' || effectType === 'fishing_time_reduction' || effectType === 'tax_collector' || effectType === 'global_point_debuff' || effectType === 'rarity_boost' || effectType === 'personal_xp_boost') {
            const actualTarget = useTarget || chatterName;
            const finalTarget = isGlobal ? 'GLOBAL' : actualTarget;
            const now = Date.now();
            const durationMs = itemConfig.effectDurationMinutes * 60 * 1000;
            
            let combinedValue = 0;
            if (effectType === 'global_point_debuff' || effectType === 'fishing_time_reduction') {
               combinedValue = 1 - Math.pow(1 - baseValue, amountToUse);
            } else if (effectType === 'rarity_boost' || effectType === 'personal_xp_boost') {
               combinedValue = baseValue * amountToUse;
            } else {
               combinedValue = Math.pow(1 + baseValue, amountToUse) - 1;
            }

            await db.run(
              'INSERT INTO active_effects (target_user, effect_type, effect_value, expires_at, caster) VALUES (?, ?, ?, ?, ?)',
              [finalTarget, effectType, combinedValue, now + durationMs, chatterName]
            );
            
            if (isGlobal) {
               chatMsgs.push(`✨ ${chatterName} applied a ${effectType} for everyone!`);
            } else {
               chatMsgs.push(`${chatterName} applied a ${effectType} to ${finalTarget}!`);
            }
          } else if (effectType === 'fishing_debuff_target') {
             const actualTarget = useTarget || chatterName;
             let timeToAddMinutes = baseValue * amountToUse;
             if (itemConfig.isPercentage) {
                const baseTimeMinutes = parseFloat(globalConfig['cmd_!fish_time'] !== undefined ? globalConfig['cmd_!fish_time'] : '5');
                timeToAddMinutes = baseTimeMinutes * baseValue * amountToUse;
             }
             const timeToAddMs = timeToAddMinutes * 60 * 1000;
             const pendingFish = await db.get('SELECT * FROM pending_fish WHERE username = ?', [actualTarget]);
             if (pendingFish) {
                await db.run('UPDATE pending_fish SET catch_time = catch_time + ? WHERE username = ?', [timeToAddMs, actualTarget]);
                chatMsgs.push(`🎣 ${chatterName} used ${amountToUse}x ${itemName} to sabotage ${actualTarget}'s fishing trip! Added ${timeToAddMinutes} minutes to their wait time!`);
             } else {
                await db.run('INSERT INTO user_modifiers (username, modifier, value) VALUES (?, ?, ?) ON CONFLICT(username, modifier) DO UPDATE SET value = value + ?', [actualTarget, 'delayed_fish', timeToAddMs, timeToAddMs]);
                chatMsgs.push(`${chatterName} used ${amountToUse}x ${itemName} to curse ${actualTarget}'s fishing rod! Their next trip will take ${timeToAddMinutes} minutes longer!`);
             }
          } else if (effectType === 'steal_points') {
             const actualTarget = useTarget || chatterName;
             if (actualTarget === chatterName) {
               // chatMsgs.push(`⚠️ ${chatterName} tried to steal points from themselves! It did nothing!`);
             } else {
                const targetRow = await db.get('SELECT points FROM users WHERE username = ?', [actualTarget]);
                if (targetRow && targetRow.points > 0) {
                    let remainingAttacks = amountToUse;
                    let shieldedAttacks = 0;
                    let defendedAttacks = 0;
                    let defenseMultiplier = 1;

                    const pointShields = await getActiveEffects(actualTarget, 'point_shield');
                    if (pointShields.length > 0) {
                        const shield = pointShields[0];
                        shieldedAttacks = Math.min(shield.uses_left, remainingAttacks);
                        if (shieldedAttacks > 0) {
                            await db.run('UPDATE active_effects SET uses_left = uses_left - ? WHERE id = ?', [shieldedAttacks, shield.id]);
                            remainingAttacks -= shieldedAttacks;
                            if (remainingAttacks === 0) {
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT SHIELD completely blocked ${chatterName}'s steal attack!`);
                            } else {
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT SHIELD blocked ${shieldedAttacks} of ${chatterName}'s steal attacks, but broke!`);
                            }
                        }
                    }

                    if (remainingAttacks > 0) {
                        const pointDefenses = await getActiveEffects(actualTarget, 'point_defense');
                        if (pointDefenses.length > 0) {
                            const defense = pointDefenses[0];
                            defendedAttacks = Math.min(defense.uses_left, remainingAttacks);
                            if (defendedAttacks > 0) {
                                await db.run('UPDATE active_effects SET uses_left = uses_left - ? WHERE id = ?', [defendedAttacks, defense.id]);
                                defenseMultiplier = Math.max(0, 1 - defense.effect_value);
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT DEFENSE reduced ${defendedAttacks} of ${chatterName}'s steal attacks by ${Math.round(defense.effect_value * 100)}%!`);
                            }
                        }
                    }

                    if (remainingAttacks > 0) {
                        const undefendedAttacks = remainingAttacks - defendedAttacks;
                        let totalCalcAmount = 0;
                        if (itemConfig.isPercentage) {
                            const perAttack = targetRow.points * baseValue;
                            totalCalcAmount = (defendedAttacks * perAttack * defenseMultiplier) + (undefendedAttacks * perAttack);
                        } else {
                            const perAttack = baseValue;
                            totalCalcAmount = (defendedAttacks * perAttack * defenseMultiplier) + (undefendedAttacks * perAttack);
                        }
                        
                        const stealAmount = Math.floor(Math.min(targetRow.points, totalCalcAmount));
                        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [stealAmount, actualTarget]);
                        await addPointsWithBonus(chatterName, stealAmount);
                        chatMsgs.push(`${chatterName} used ${amountToUse}x ${itemName} to steal ${stealAmount} points from ${actualTarget}!`);
                    }
                 } else {
                   chatMsgs.push(`⚠️ ${chatterName} tried to steal points from ${actualTarget}, but they are broke!`);
                 }
              }
           } else if (effectType === 'destroy_points_target') {
              const actualTarget = useTarget || chatterName;
              if (actualTarget === chatterName) {
                 chatMsgs.push(`⚠️ ${chatterName} tried to destroy their own points! It did nothing!`);
              } else {
                 const targetRow = await db.get('SELECT points FROM users WHERE username = ?', [actualTarget]);
                 if (targetRow && targetRow.points > 0) {
                    let remainingAttacks = amountToUse;
                    let shieldedAttacks = 0;
                    let defendedAttacks = 0;
                    let defenseMultiplier = 1;

                    const pointShields = await getActiveEffects(actualTarget, 'point_shield');
                    if (pointShields.length > 0) {
                        const shield = pointShields[0];
                        shieldedAttacks = Math.min(shield.uses_left, remainingAttacks);
                        if (shieldedAttacks > 0) {
                            await db.run('UPDATE active_effects SET uses_left = uses_left - ? WHERE id = ?', [shieldedAttacks, shield.id]);
                            remainingAttacks -= shieldedAttacks;
                            if (remainingAttacks === 0) {
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT SHIELD completely blocked ${chatterName}'s attack!`);
                            } else {
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT SHIELD blocked ${shieldedAttacks} of ${chatterName}'s attacks, but broke!`);
                            }
                        }
                    }

                    if (remainingAttacks > 0) {
                        const pointDefenses = await getActiveEffects(actualTarget, 'point_defense');
                        if (pointDefenses.length > 0) {
                            const defense = pointDefenses[0];
                            defendedAttacks = Math.min(defense.uses_left, remainingAttacks);
                            if (defendedAttacks > 0) {
                                await db.run('UPDATE active_effects SET uses_left = uses_left - ? WHERE id = ?', [defendedAttacks, defense.id]);
                                defenseMultiplier = Math.max(0, 1 - defense.effect_value);
                                chatMsgs.push(`🛡️ ${actualTarget}'s POINT DEFENSE reduced ${defendedAttacks} of ${chatterName}'s attacks by ${Math.round(defense.effect_value * 100)}%!`);
                            }
                        }
                    }

                    if (remainingAttacks > 0) {
                        const undefendedAttacks = remainingAttacks - defendedAttacks;
                        let totalCalcAmount = 0;
                        if (itemConfig.isPercentage) {
                            const perAttack = targetRow.points * baseValue;
                            totalCalcAmount = (defendedAttacks * perAttack * defenseMultiplier) + (undefendedAttacks * perAttack);
                        } else {
                            const perAttack = baseValue;
                            totalCalcAmount = (defendedAttacks * perAttack * defenseMultiplier) + (undefendedAttacks * perAttack);
                        }
                        
                        const destroyAmount = Math.floor(Math.min(targetRow.points, totalCalcAmount));
                        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [destroyAmount, actualTarget]);
                        chatMsgs.push(`${chatterName} used ${amountToUse}x ${itemName} to destroy ${destroyAmount} of ${actualTarget}'s points!`);
                    }
                 } else {
                    chatMsgs.push(`⚠️ ${chatterName} tried to destroy points from ${actualTarget}, but they are already broke!`);
                 }
              }
           } else if (effectType === 'personal_point_debuff_target') {
             const actualTarget = useTarget || chatterName;
             const now = Date.now();
             const durationMs = itemConfig.effectDurationMinutes * 60 * 1000;
             const combinedValue = 1 - Math.pow(1 - baseValue, amountToUse);
             await db.run(
               'INSERT INTO active_effects (target_user, effect_type, effect_value, expires_at, caster) VALUES (?, ?, ?, ?, ?)',
               [actualTarget, 'global_point_debuff', combinedValue, now + durationMs, chatterName]
             );
             chatMsgs.push(`📉 ${chatterName} used ${amountToUse}x ${itemName} to curse ${actualTarget} with a ${Math.round(combinedValue * 100)}% point gain debuff for ${itemConfig.effectDurationMinutes} minutes!`);
          } else {

            const uses = itemConfig.uses * amountToUse;
            const existing = await db.get('SELECT * FROM active_effects WHERE target_user = ? AND effect_type = ? AND effect_value = ?', [targetUser, effectType, baseValue]);
            if (existing) {
               await db.run('UPDATE active_effects SET uses_left = uses_left + ? WHERE id = ?', [uses, existing.id]);
            } else {
               await db.run(
                 'INSERT INTO active_effects (target_user, effect_type, effect_value, uses_left, caster) VALUES (?, ?, ?, ?, ?)',
                 [targetUser, effectType, baseValue, uses, chatterName]
               );
            }
          }
          
          if (!['fishing_debuff_target', 'steal_points', 'destroy_points_target', 'personal_point_debuff_target'].includes(effectType) && !(itemConfig && itemConfig.rngPrefix)) {
             totalUsed.push(`${amountToUse}x ${itemName} `);
          }
          
          if (itemConfig && itemConfig.rngPrefix) {
              if (chatMsgs.length > chatMsgCountBefore) {
                  chatMsgs[chatMsgCountBefore] = itemConfig.rngPrefix + chatMsgs[chatMsgCountBefore];
              } else {
                  chatMsgs.push(itemConfig.rngPrefix + `${chatterName} used ${amountToUse}x ${itemName} and got a **${effectType}** effect!`);
              }
          }
        }

        if (totalUsed.length > 0 || chatMsgs.length > 0) {
          if (totalUsed.length > 0) {
            await sendChatMessage(`${chatterName} redeemed: ${totalUsed.join(', ')} !${totalPointsGained > 0 ? ` (Gained ${totalPointsGained} pts)` : ''}`, chatterName);
          }
          for (const msg of chatMsgs) {
             await sendChatMessage(msg);
          }
        } else {
          await sendChatMessage(`${chatterName}, you don't have those items or they cannot be used!`, chatterName);
        }
      }
    },
    '!points': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        let targetUser = chatterName;
        if (args.length > 0) {
          const rawTarget = args[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
          if (rawTarget.length > 0) {
            targetUser = rawTarget;
          }
        }

        let user = await db.get('SELECT points FROM users WHERE username = ?', targetUser);
        if (!user) {
          await db.run('INSERT OR IGNORE INTO users (username, points) VALUES (?, 0)', [targetUser]);
          user = { points: 0 };
        }

        const points = user.points;

        if (targetUser === chatterName) {
          await sendChatMessage(`${chatterName} you have ${points} points!`, chatterName);
        } else {
          await sendChatMessage(`${targetUser} has ${points} points!`, targetUser);
        }
      }
    },
    '!toppoints': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        let amount = 5;
        if (args.length > 0) {
          const parsed = parseInt(args[0], 10);
          if (!isNaN(parsed) && parsed > 0) {
            amount = Math.min(parsed, 15);
          }
        }
        
        const topUsers = await db.all('SELECT username, points FROM users ORDER BY points DESC LIMIT ?', [amount]);
        if (!topUsers || topUsers.length === 0) {
          await sendChatMessage(`No users found!`);
          return;
        }

        const leaderboard = topUsers.map((u, i) => `${i + 1}. ${u.username} (${u.points})`).join(', ');
        await sendChatMessage(`🏆 Top Points: ${leaderboard}`);
      }
    },
    '!editpoints': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) {
        //  await sendChatMessage(`@${chatterName}, you do not have permission to edit points!`, chatterName);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !editpoints <username> <amount>`, chatterName);
          return;
        }

        const targetUser = args[0].replace('@', '').toLowerCase();
        const amount = parseAmount(args[1]);

        if (isNaN(amount) || amount < 0) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        await db.run('INSERT INTO users (username, points) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET points = ?', [targetUser, amount, amount]);
        await sendChatMessage(`Successfully set ${targetUser}'s points to ${amount}!`, targetUser);
      }
    },
    '!chatcooldown': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) {
        //  await sendChatMessage(`@${chatterName}, you do not have permission to edit the chat cooldown!`, chatterName);
          return;
        }

        if (args.length === 1) {
          const cdVal = parseFlexibleTime(args[0]);
          if (isNaN(cdVal) || cdVal < 0) {
            await sendChatMessage(`${chatterName} invalid time! Use ms (1000), or 10s, 5m.`, chatterName);
            return;
          }

          const configKey = 'chat_wide_cooldown';
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, cdVal, cdVal]);
          globalConfig[configKey] = cdVal;
          
          await sendChatMessage(`Successfully updated chat-wide global cooldown to ${cdVal} ms!`);
        } else if (args.length === 2) {
          const targetCmd = args[0].toLowerCase();
          if (!targetCmd.startsWith('!')) {
            await sendChatMessage(`${chatterName} invalid command! Use: !chatcooldown !command <time>`, chatterName);
            return;
          }
          
          const cdVal = parseFlexibleTime(args[1]);
          if (isNaN(cdVal) || cdVal < 0) {
            await sendChatMessage(`${chatterName} invalid time! Use ms (1000), or 10s, 5m.`, chatterName);
            return;
          }

          const configKey = `cmd_${targetCmd}_global_chat_cooldown`;
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, cdVal, cdVal]);
          globalConfig[configKey] = cdVal;
          
          await sendChatMessage(`Successfully updated GLOBAL chat cooldown for ${targetCmd} to ${cdVal} ms!`);
        } else {
          await sendChatMessage(`${chatterName} invalid format! Use: !chatcooldown <time> OR !chatcooldown <!command> <time>`, chatterName);
        }
      }
    },
    '!playsound': {
      cost: 1,
      manualCost: true,
      execute: async (args, chatterName, event, hasPermission) => {
        // if (!await isStreamerLive()) return;
        args = [args[0]]

        const filename = args.join('').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        if (filename) {
          const customCooldownRaw = globalConfig[`cooldown_playsound_${filename}`];
          if (customCooldownRaw !== undefined && customCooldownRaw !== '') {
            const cooldownMs = parseInt(customCooldownRaw, 10);
            if (cooldownMs > 0) {
              const lastPlayed = playsoundCooldowns.get(filename) || 0;
              const now = Date.now();
              if (now - lastPlayed < cooldownMs) {
                console.log(`[PLAYSOUND] Sound '${filename}' is on custom cooldown. Ignoring.`);
                return;
              }
            }
          }

          const customCostRaw = globalConfig[`cost_playsound_${filename}`];
          const dynamicCostRaw = globalConfig['cmd_!playsound_cost'];
          let activeCost = 0;
          if (customCostRaw !== undefined && customCostRaw !== '') {
            activeCost = parseInt(customCostRaw, 10);
          } else {
            activeCost = dynamicCostRaw !== undefined ? parseInt(dynamicCostRaw, 10) : 1;
          }

          if (activeCost > 0) {
            const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
            if (!user || user.points < activeCost) {
              console.log(`[PLAYSOUND] ${chatterName} lacks points for ${filename}`);
              return;
            }
            await db.run('UPDATE users SET points = points - ? WHERE username = ?', [activeCost, chatterName]);
          }

          const disabledRaw = globalConfig[`disabled_playsound_${filename}`];
          if (disabledRaw === 'true' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw))) {
            console.log(`[PLAYSOUND] Sound '${filename}' is disabled.`);
            if (activeCost > 0) {
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [activeCost, chatterName]);
            }
            return;
          }

          const oggPath = path.join(__dirname, 'data', 'playsounds', filename + '.ogg');
          const mp3Path = path.join(__dirname, 'data', 'playsounds', filename + '.mp3');
          
          if (fs.existsSync(oggPath) || fs.existsSync(mp3Path)) {
            if (fs.existsSync(oggPath)) {
              broadcastAudio(filename + '.ogg');
              playsoundCooldowns.set(filename, Date.now());
              console.log(`[PLAYSOUND] ${chatterName} played audio: ${filename}.ogg (-${activeCost} point(s))`);
            } else {
              broadcastAudio(filename + '.mp3');
              playsoundCooldowns.set(filename, Date.now());
              console.log(`[PLAYSOUND] ${chatterName} played audio: ${filename}.mp3 (-${activeCost} point(s))`);
            }
          } else {
            console.log(`[PLAYSOUND] Audio not found for: ${filename}`);
            if (activeCost > 0) {
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [activeCost, chatterName]);
            }
          }
        }
      }
    },
    '!deleteplaysound': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to delete playsounds!`, chatterName);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`${chatterName} invalid format! Use: !deleteplaysound <soundname>`, chatterName);
          return;
        }

        const filename = args.join('').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        if (!filename) {
          await sendChatMessage(`${chatterName} invalid sound name!`, chatterName);
          return;
        }

        const oggPath = path.join(__dirname, 'data', 'playsounds', filename + '.ogg');
        const mp3Path = path.join(__dirname, 'data', 'playsounds', filename + '.mp3');
        
        let deleted = false;
        if (fs.existsSync(oggPath)) { fs.unlinkSync(oggPath); deleted = true; }
        if (fs.existsSync(mp3Path)) { fs.unlinkSync(mp3Path); deleted = true; }

        if (deleted) {
          await sendChatMessage(`Successfully deleted playsound: ${filename}`);
        } else {
          await sendChatMessage(`${chatterName} could not find a playsound named: ${filename}`, chatterName);
        }
      }
    },
    '!refreshemotes': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (hasPermission) {
          if (Date.now() - lastRefreshTime > REFRESH_COOLDOWN_MS) {
            lastRefreshTime = Date.now();
            console.log(`* [COMMAND] ${chatterName} triggered !refreshemotes. Reloading all emotes...`);
            await loadThirdPartyEmotes(BROADCASTER_USER_ID);
          } else {
            console.log(`\n* [COMMAND] ${chatterName} triggered !refreshemotes, but it is currently on cooldown.`);
          }
        }
      }
    },
    '!emotesize': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (hasPermission || chatterName === TARGET_CHANNEL) {
          const newSize = args[0];
          if (newSize && !isNaN(Number(newSize))) {
            currentEmoteSizePx = Number(newSize);
            console.log(`\n${chatterName} set emote size to ${newSize}.`);
            await sendChatMessage(`${chatterName} set emote size to ${newSize}.`, chatterName);
          } else {
            console.log(`\n${chatterName} invalid value: ${newSize}. ex. !emotesize 150`);
            await sendChatMessage(`Invalid value. Ex: !emotesize 150`);
          }
        }
      }
    },
    '!givepoints': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid command! Try !givepoints 50 username or !givepoints 50 username1 username2`, chatterName);
          return;
        }

        const amountInput = args[0].toLowerCase();
        const targetUsers = args.slice(1).map(u => u.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()).filter(u => u.length > 0);

        for (const target of targetUsers) {
          const tUser = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (!tUser) {
            await sendChatMessage(`${target} has not typed yet in this chat!`, target);
            return;
          }
        }

        let totalAmountToDeduct = 0;
        let amountPerUser = 0;

        const isMod = hasPermission || chatterName === TARGET_CHANNEL;

        if (!isMod) {
          const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
          if (!user || user.points <= 0) {
            await sendChatMessage(`${chatterName} you don't have any points!`, chatterName);
            return;
          }

          if (amountInput === 'all') {
            totalAmountToDeduct = user.points;
          } else if (amountInput.endsWith('%')) {
            const percent = parseFloat(amountInput.replace('%', ''));
            if (!isNaN(percent) && percent > 0 && percent <= 100) {
              totalAmountToDeduct = Math.floor(user.points * (percent / 100));
            }
          } else {
            totalAmountToDeduct = parseAmount(amountInput);
          }

          if (isNaN(totalAmountToDeduct) || totalAmountToDeduct <= 0 || totalAmountToDeduct > user.points) {
            await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
            return;
          }

          amountPerUser = Math.floor(totalAmountToDeduct / targetUsers.length);
          if (amountPerUser <= 0) {
            await sendChatMessage(`${chatterName} the amount is too small to split!`, chatterName);
            return;
          }
          
          const actualDeduction = amountPerUser * targetUsers.length;
          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [actualDeduction, chatterName]);

        } else {
          if (amountInput === 'all' || amountInput.endsWith('%')) {
            const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
            const userPoints = user ? user.points : 0;
            if (userPoints <= 0) {
              await sendChatMessage(`${chatterName} you don't have any points!`, chatterName);
              return;
            }
            if (amountInput === 'all') {
              totalAmountToDeduct = userPoints;
            } else {
              const percent = parseFloat(amountInput.replace('%', ''));
              if (!isNaN(percent) && percent > 0 && percent <= 100) {
                totalAmountToDeduct = Math.floor(userPoints * (percent / 100));
              } else {
                totalAmountToDeduct = 0;
              }
            }
            // For mods, we'll actually deduct it from them if they use 'all' or '%', 
            // so they can play fairly with their own points when they choose to!
            await db.run('UPDATE users SET points = points - ? WHERE username = ?', [totalAmountToDeduct, chatterName]);
          } else {
            totalAmountToDeduct = parseAmount(amountInput);
          }

          if (isNaN(totalAmountToDeduct) || totalAmountToDeduct <= 0) {
            await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
            return;
          }
          amountPerUser = totalAmountToDeduct; 
        }

        for (const target of targetUsers) {
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [amountPerUser, target]);
        }

        await sendChatMessage(`${chatterName} gave ${amountPerUser} points to: ${targetUsers.join(', ')}`, chatterName);
      }
    },
    '!removepoints': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`@${chatterName}, you do not have permission to remove points!`, chatterName);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid command! Try !removepoints 50 username`, chatterName);
          return;
        }

        const amountInput = args[0].toLowerCase();
        const targetUsers = args.slice(1).map(u => u.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()).filter(u => u.length > 0);
        
        const amountToDeduct = parseAmount(amountInput);
        if (isNaN(amountToDeduct) || amountToDeduct <= 0) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        for (const target of targetUsers) {
          const tUser = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (!tUser) {
            await sendChatMessage(`${target} has not typed yet in this chat!`, target);
            return;
          }
        }

        for (const target of targetUsers) {
          const tUser = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (tUser) {
            // Prevent going below 0 points
            const newPoints = Math.max(0, tUser.points - amountToDeduct);
            await db.run('UPDATE users SET points = ? WHERE username = ?', [newPoints, target]);
          }
        }

        await sendChatMessage(`${chatterName} removed ${amountToDeduct} points from: ${targetUsers.join(', ')}`, chatterName);
      }
    },
    '!masspointsadd': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
       
        if( chatterName === 'aurorynaru' || hasPermission || chatterName === TARGET_CHANNEL  ) {
          if (args.length < 1) {
            await sendChatMessage(`${chatterName} invalid command! Try !masspointsadd 1000 10m`, chatterName);
            return;
          }
  
          const amount = parseAmount(args[0]);
          if (isNaN(amount) || amount <= 0) {
            await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
            return;
          }
  
          const timeStr = args[1] ? args[1].toLowerCase() : '5m';
          const durationMs = parseTime(timeStr);
          const threshold = Date.now() - durationMs;
          const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
  
          await db.run(`UPDATE users SET points = points + ? WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [amount, threshold]);
          await sendChatMessage(`${chatterName} mass added ${amount} points to everyone who chatted in the last ${timeStr}!`, chatterName);
        
        } else {
        //  await sendChatMessage(`${chatterName} you do not have permission to mass add points!`, chatterName);
          return;
        }


      }
    },
    '!masspointssub': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
       

        if ( chatterName === 'aurorynaru' ||  hasPermission || chatterName === TARGET_CHANNEL) { 

          
                  if (args.length < 1) {
                    await sendChatMessage(`${chatterName} invalid command! Try !masspointssub 1000 10m`, chatterName);
                    return;
                  }
          
                  const amount = parseAmount(args[0]);
                  if (isNaN(amount) || amount <= 0) {
                    await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
                    return;
                  }
          
                  const timeStr = args[1] ? args[1].toLowerCase() : '5m';
                  const durationMs = parseTime(timeStr);
                  const threshold = Date.now() - durationMs;
                  const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
          
                  await db.run(`UPDATE users SET points = MAX(0, points - ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [amount, threshold]);
                  await sendChatMessage(`${chatterName} mass removed ${amount} points from everyone who chatted in the last ${timeStr}!`, chatterName);
        } else {
          
         //  await sendChatMessage(`${chatterName} you do not have permission to mass sub points!`, chatterName);
           return;
      
        }
      }
    },
    '!emoteduration': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (hasPermission || chatterName === TARGET_CHANNEL) {
          const newDuration = args[0];
          if (newDuration && !isNaN(Number(newDuration))) {
            currentEmoteDurationMs = Number(newDuration) * 1000;
            console.log(`\n${chatterName} set emote duration to ${newDuration} seconds.`);
            await sendChatMessage(`${chatterName} set emote duration to ${newDuration} seconds.`, chatterName);
          } else {
            console.log(`\n${chatterName} invalid value: ${newDuration}. ex. !emoteduration 10`);
            await sendChatMessage(`Invalid value. Ex: !emotesduration 10`);
          }
        }
      }
    },
    '!disablemodifier': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!hasPermission) return;
        if (args.length === 0) {
          await sendChatMessage(`Usage: !disablemodifier <modifier>. Available: wide, cursed, flipx, flipy, bounce, leave, arrive, jam, rainbow, hyper`, chatterName);
          return;
        }
        const mod = args[0].toLowerCase();
        const validModifiers = ['wide', 'cursed', 'flipx', 'flipy', 'bounce', 'leave', 'arrive', 'jam', 'rainbow', 'hyper'];
        if (!validModifiers.includes(mod)) {
          await sendChatMessage(`Invalid modifier! Valid modifiers: ${validModifiers.join(', ')}`, chatterName);
          return;
        }
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [`disabled_mod_${mod}`, 'true', 'true']);
        globalConfig[`disabled_mod_${mod}`] = 'true';
        await sendChatMessage(`Modifier '${mod}' has been disabled!`, chatterName);
      }
    },
    '!enablemodifier': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!hasPermission) return;
        if (args.length === 0) {
          await sendChatMessage(`Usage: !enablemodifier <modifier>. Available: wide, cursed, flipx, flipy, bounce, leave, arrive, jam, rainbow, hyper`, chatterName);
          return;
        }
        const mod = args[0].toLowerCase();
        const validModifiers = ['wide', 'cursed', 'flipx', 'flipy', 'bounce', 'leave', 'arrive', 'jam', 'rainbow', 'hyper'];
        if (!validModifiers.includes(mod)) {
          await sendChatMessage(`Invalid modifier! Valid modifiers: ${validModifiers.join(', ')}`, chatterName);
          return;
        }
        await db.run('DELETE FROM app_config WHERE key = ?', [`disabled_mod_${mod}`]);
        delete globalConfig[`disabled_mod_${mod}`];
        await sendChatMessage(`Modifier '${mod}' has been enabled!`, chatterName);
      }
    },
    '!duel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !duel <@user> <amount>`, chatterName);
          return;
        }

        const target = args[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
        if (!target) {
          await sendChatMessage(`${chatterName} invalid user provided!`, chatterName);
          return;
        }

        if (target === chatterName) {
          await sendChatMessage(`${chatterName} you cannot duel yourself!`, chatterName);
          return;
        }

        const amountInput = args[1].toLowerCase();
        let betAmount = 0;

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`${chatterName} you don't have enough points to duel!`, chatterName);
          return;
        }

        if (amountInput === 'all') {
          betAmount = user.points;
        } else if (amountInput.endsWith('%')) {
          const percent = parseFloat(amountInput.replace('%', ''));
          if (!isNaN(percent) && percent > 0 && percent <= 100) {
            betAmount = Math.floor(user.points * (percent / 100));
          }
        } else {
          betAmount = parseAmount(amountInput);
        }

        if (isNaN(betAmount) || betAmount <= 0 || betAmount > user.points) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        const knifeMod = await db.get('SELECT * FROM user_modifiers WHERE username = ? AND modifier = ?', [chatterName, 'auto_duel']);
        if (knifeMod && knifeMod.value > 0) {
          const targetUserObj = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (!targetUserObj || targetUserObj.points <= 0) {
            await sendChatMessage(`${chatterName} you tried to assassinate ${target}, but they have no points!`, chatterName);
            return;
          }
          
          let actualBet = betAmount;
          if (actualBet > 2500) actualBet = 2500;
          if (actualBet > targetUserObj.points) actualBet = targetUserObj.points;
          
          await db.run('UPDATE user_modifiers SET value = value - 1 WHERE username = ? AND modifier = ?', [chatterName, 'auto_duel']);
          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [actualBet, chatterName]);
          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [actualBet, target]);

          const challengerWins = Math.random() < 0.5;
          const winner = challengerWins ? chatterName : target;
          const loser = challengerWins ? target : chatterName;
          
          let taxAmount = Math.floor(actualBet * getDuelTax());
          const evaders = await getActiveEffects(winner, 'tax_evader');
          if (evaders.length > 0) {
             if (evaders[0].uses_left > 1) {
                await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [evaders[0].id]);
             } else {
                await db.run('DELETE FROM active_effects WHERE id = ?', [evaders[0].id]);
             }
             taxAmount = 0;
          }
          const finalProfit = actualBet - taxAmount;
          const reward = actualBet + finalProfit;

          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [reward, winner]);
          await distributeRobinHoodTax(taxAmount);

          await updateUserStat(winner, 'duels_played', 1);
          await updateUserStat(loser, 'duels_played', 1);
          await updateUserStat(winner, 'duels_won', 1);
          await updateUserStat(loser, 'duels_lost', 1);
          await updateUserStat(winner, 'duels_points_won', actualBet);
          await updateUserStat(loser, 'duels_points_lost', actualBet);

          await sendChatMessage(`🔪 ${chatterName} used a knife to force a duel on ${target}! ${winner} won ${reward} points!`, chatterName);
          return;
        }

        if (activeDuels.has(target)) {
          await sendChatMessage(`${chatterName} ${target} already has a pending duel!`, chatterName);
          return;
        }

        const mirrorShields = await getActiveEffects(target, 'mirror_shield');
        if (mirrorShields.length > 0) {
          const mShield = mirrorShields[0];
          await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [mShield.id]);
          
          const lossAmount = betAmount * mShield.effect_value;
          await db.run('UPDATE users SET points = MAX(0, points - ?) WHERE username = ?', [lossAmount, chatterName]);
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [lossAmount, target]);
          
          await updateUserStat(chatterName, 'duels_played', 1);
          await updateUserStat(target, 'duels_played', 1);
          await updateUserStat(chatterName, 'duels_lost', 1);
          await updateUserStat(target, 'duels_won', 1);
          await updateUserStat(chatterName, 'duels_points_lost', lossAmount);
          await updateUserStat(target, 'duels_points_won', lossAmount);

          await sendChatMessage(`🛡️ ${target}'s MIRROR SHIELD reflected ${chatterName}'s duel! ${chatterName} lost ${lossAmount} points!`, chatterName);
          return;
        }

        // Deduct points into escrow
        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [betAmount, chatterName]);

        const timeoutId = setTimeout(async () => {
          if (activeDuels.has(target)) {
            const duel = activeDuels.get(target);
            if (duel.challenger === chatterName) {
              // Refund
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [betAmount, chatterName]);
              activeDuels.delete(target);
            }
          }
        }, 60000);

        activeDuels.set(target, {
          challenger: chatterName,
          target: target,
          amount: betAmount,
          timeoutId: timeoutId
        });

        await sendChatMessage(`⚔️ ${chatterName} challenged ${target} for ${betAmount} pts! Type !acceptduel in 60s!`, chatterName);
      }
    },
    '!acceptduel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!activeDuels.has(chatterName)) {
        //  await sendChatMessage(`${chatterName} you have no pending duel requests!`, chatterName);
          return;
        }

        const duel = activeDuels.get(chatterName);
        clearTimeout(duel.timeoutId);
        activeDuels.delete(chatterName);

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points < duel.amount) {
   
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [duel.amount, duel.challenger]);
          const msg = duelBrokeMessages[Math.floor(Math.random() * duelBrokeMessages.length)]
            .replace(/{target}/g, `${chatterName}`)
            .replace(/{challenger}/g, `${duel.challenger}`)
            .replace(/{amount}/g, duel.amount);
          await sendChatMessage(msg);
          return;
        }

  
        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [duel.amount, chatterName]);

        const challengerWins = Math.random() < 0.5;
        const winner = challengerWins ? duel.challenger : chatterName;
        const loser = challengerWins ? chatterName : duel.challenger;
        
        let profit = duel.amount;
        let loserPenalty = duel.amount;


        const winBoosts = await getActiveEffects(winner, 'duel_win_boost');
        if (winBoosts.length > 0) {
           await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [winBoosts[0].id]);
           profit = Math.floor(profit * (1 + winBoosts[0].effect_value));
        }

 
        const shields = await getActiveEffects(loser, 'duel_shield');
        if (shields.length > 0) {
           await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [shields[0].id]);
           const refund = Math.floor(loserPenalty * shields[0].effect_value);
           await db.run('UPDATE users SET points = points + ? WHERE username = ?', [refund, loser]);
           loserPenalty -= refund;
        }

        let taxAmount = Math.floor(profit * getDuelTax());
        const evaders = await getActiveEffects(winner, 'tax_evader');
        if (evaders.length > 0) {
           if (evaders[0].uses_left > 1) {
              await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [evaders[0].id]);
           } else {
              await db.run('DELETE FROM active_effects WHERE id = ?', [evaders[0].id]);
           }
           taxAmount = 0;
        }
        const finalProfit = profit - taxAmount;
        
        await db.run('UPDATE users SET points = points + ? WHERE username = ?', [duel.amount + finalProfit, winner]); // refund original bet + profit
        await distributeRobinHoodTax(taxAmount);
        
        const reward = duel.amount + finalProfit; // used for stats and messages

        await updateUserStat(winner, 'duels_played', 1);
        await updateUserStat(loser, 'duels_played', 1);
        await updateUserStat(winner, 'duels_won', 1);
        await updateUserStat(loser, 'duels_lost', 1);
        await updateUserStat(winner, 'duels_points_won', reward - duel.amount); // Net win
        await updateUserStat(loser, 'duels_points_lost', loserPenalty);

        const msg = duelWinMessages[Math.floor(Math.random() * duelWinMessages.length)]
          .replace(/{winner}/g, `${winner}`)
          .replace(/{loser}/g, `${loser}`)
          .replace(/{amount}/g, reward);
        
        await sendChatMessage(msg);
      }
    },
    '!declineduel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!activeDuels.has(chatterName)) {
          //await sendChatMessage(`${chatterName} you have no pending duel requests to decline!`, chatterName);
          return;
        }

        const duel = activeDuels.get(chatterName);
        clearTimeout(duel.timeoutId);
        activeDuels.delete(chatterName);


        await db.run('UPDATE users SET points = points + ? WHERE username = ?', [duel.amount, duel.challenger]);
        
        await sendChatMessage(`${chatterName} has declined the duel from ${duel.challenger}! Points refunded.`, chatterName);
      }
    },
    '!dueltax': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) return;

        if (args.length === 0) {
          await sendChatMessage(`Current duel tax is ${getDuelTax() * 100}%.`, chatterName);
          return;
        }

        let newTaxStr = args[0].replace('%', '');
        let newTax = parseFloat(newTaxStr);
        if (!isNaN(newTax) && newTax >= 0 && newTax <= 100) {
          globalConfig['duel_tax'] = (newTax / 100).toString();
          broadcastConfig(globalConfig);
          // Also save to DB for persistence
          db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', ['duel_tax', globalConfig['duel_tax'], globalConfig['duel_tax']]);
          await sendChatMessage(`Duel tax is now set to ${newTax}%.`, chatterName);
        } else {
          await sendChatMessage(`Invalid tax amount. Use a percentage from 0 to 100.`, chatterName);
        }
      }
    },
    '!setfishtime': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) return;

        if (args.length === 0) {
          const currentFishTime = parseFloat(globalConfig['cmd_!fish_time'] !== undefined ? globalConfig['cmd_!fish_time'] : '5');
          await sendChatMessage(`Current fishing time is ${currentFishTime} minutes.`, chatterName);
          return;
        }

        let newTime = parseFloat(args[0]);
        if (!isNaN(newTime) && newTime > 0) {
          await db.run('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', ['cmd_!fish_time', newTime.toString(), newTime.toString()]);
          globalConfig['cmd_!fish_time'] = newTime.toString();
          broadcastConfig(globalConfig);
          await sendChatMessage(`Fishing time is now set to ${newTime} minutes.`, chatterName);
        } else {
          await sendChatMessage(`Invalid time amount. Use a number greater than 0.`, chatterName);
        }
      }
    },
    '!gamble': {
      cost: 0, 
      manualCost: true,
      execute: async (args, chatterName, event, hasPermission) => {
        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`${chatterName}, you don't have any points to gamble!`, chatterName);
          return;
        }

        let amountInput = args[0] ? args[0].toLowerCase() : '';
        let betAmount = 0;

        if (amountInput === 'all') {
          betAmount = user.points;
        } else if (amountInput.endsWith('%')) {
          const percent = parseFloat(amountInput.replace('%', ''));
          if (!isNaN(percent) && percent > 0 && percent <= 100) {
            betAmount = Math.floor(user.points * (percent / 100));
          }
        } else {
          betAmount = parseAmount(amountInput);
        }

        if (isNaN(betAmount) || betAmount <= 0 || betAmount > user.points) {
          await sendChatMessage(`${chatterName}, invalid amount! Try !gamble 50, !gamble 50%, or !gamble all`, chatterName);
          return;
        }

        let isWin = Math.random() < 0.5;

        // Apply loaded dice
        const guaranteedWins = await getActiveEffects(chatterName, 'gamble_guaranteed_win');
        if (guaranteedWins.length > 0) {
           let maxLimit = Infinity;
           for (const config of Object.values(ITEMS_REGISTRY)) {
               if (config.effectType === 'gamble_guaranteed_win' && config.maxGambleLimit) {
                   maxLimit = config.maxGambleLimit;
                   break;
               }
           }
           if (betAmount > maxLimit) {
               await sendChatMessage(`${chatterName}, your loaded dice only guarantees bets up to ${maxLimit}! Try a lower amount.`, chatterName);
               return;
           }

           await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [guaranteedWins[0].id]);
           isWin = true;
        }

        if (isWin) {
          let winAmount = betAmount;
          
          // Apply Midas Touch multiplier
          const multipliers = await getActiveEffects(chatterName, 'gamble_multiplier');
          if (multipliers.length > 0) {
             await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [multipliers[0].id]);
             winAmount = Math.floor(betAmount * (multipliers[0].effect_value - 1)); // -1 because we add back the bet 
          }
          
          const addedAmount = await addPointsWithBonus(chatterName, winAmount);
          const updatedUser = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
          const newPoints = updatedUser.points;

          await updateUserStat(chatterName, 'gamble_played', 1);
          await updateUserStat(chatterName, 'gamble_won', 1);
          await updateUserStat(chatterName, 'gamble_points_won', addedAmount);
          
          if (multipliers.length > 0) {
            await sendChatMessage(`✨ MIDAS TOUCH! ${chatterName} won ${addedAmount + betAmount} points in a gamble! You now have ${newPoints} points.`, chatterName);
          } else {
            await sendChatMessage(`${chatterName} won ${addedAmount} points in a gamble! You now have ${newPoints} points.`, chatterName);
          }
        } else {
          const shields = await getActiveEffects(chatterName, 'gamble_shield');
          let actualLoss = betAmount;
          let shieldedMsg = '';
          
          if (shields.length > 0) {
             const shield = shields[0];
             const refund = Math.floor(betAmount * shield.effect_value);
             actualLoss = betAmount - refund;
             if (shield.uses_left > 1) {
                await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [shield.id]);
             } else {
                await db.run('DELETE FROM active_effects WHERE id = ?', [shield.id]);
             }
             shieldedMsg = ` 🛡️ (Your shield refunded ${refund} points!)`;
          }

          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [actualLoss, chatterName]);
          const newPoints = user.points - actualLoss;
          await updateUserStat(chatterName, 'gamble_played', 1);
          await updateUserStat(chatterName, 'gamble_lost', 1);
          await updateUserStat(chatterName, 'gamble_points_lost', actualLoss);
          await sendChatMessage(`${chatterName} lost ${actualLoss} points in a gamble...${shieldedMsg} You now have ${newPoints} points.`, chatterName);
        }
      }
    },
    '!chatwar': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to start chat wars!`, chatterName);
          return;
        }

        if (activeChatWar) {
          await sendChatMessage(`${chatterName} a chat war is already active!`, chatterName);
          return;
        }

        if (args.length < 4) {
          await sendChatMessage(`${chatterName} invalid format! Use: !chatwar <emote1> <emote2> <cost> <time> (ex: !chatwar CoolCat OhMyDog 100 1m)`, chatterName);
          return;
        }

        const emote1 = args[0];
        const emote2 = args[1];
        const cost = parseInt(args[2], 10);
        const durationStr = args[3];
        
        if (isNaN(cost) || cost < 0) {
           await sendChatMessage(`${chatterName} invalid cost!`, chatterName);
           return;
        }

        const durationMs = parseFlexibleTime(durationStr);
        if (isNaN(durationMs) || durationMs <= 0) {
           await sendChatMessage(`${chatterName} invalid time format! Use 10s, 1m, 1h.`, chatterName);
           return;
        }

        const getEmoteUrl = (emoteName) => {
           if (thirdPartyEmotes.has(emoteName)) return thirdPartyEmotes.get(emoteName).url;
           const frag = event.message.fragments.find(f => f.type === 'emote' && f.text.trim() === emoteName);
           if (frag) return `https://static-cdn.jtvnw.net/emoticons/v2/${frag.emote.id}/default/dark/3.0`;
           return null;
        };

        const emoteUrl1 = getEmoteUrl(emote1);
        const emoteUrl2 = getEmoteUrl(emote2);

        if (!emoteUrl1 || !emoteUrl2) {
           await sendChatMessage(`${chatterName} one or both of those are not valid emotes! Please use actual Twitch or 3rd party emotes.`, chatterName);
           return;
        }

        activeChatWar = {
          emote1,
          emote2,
          emoteUrl1,
          emoteUrl2,
          cost,
          score1: 0,
          score2: 0,
          totalPool: 0,
          userVotes: {},
          durationMs,
          endTime: Date.now() + durationMs,
          timeoutId: null,
          reminderTimeouts: []
        };

        broadcastChatWarState(activeChatWar);

        activeChatWar.timeoutId = setTimeout(async () => {
          if (activeChatWar) {
             const war = activeChatWar;
             activeChatWar = null;

             let winningEmote = null;
             let losingEmote = null;
             let winningScore = 0;
             let losingScore = 0;
             let winningEmoteUrl = null;

             if (war.score1 > war.score2) {
               winningEmote = war.emote1; losingEmote = war.emote2;
               winningScore = war.score1; losingScore = war.score2;
               winningEmoteUrl = war.emoteUrl1;
             } else if (war.score2 > war.score1) {
               winningEmote = war.emote2; losingEmote = war.emote1;
               winningScore = war.score2; losingScore = war.score1;
               winningEmoteUrl = war.emoteUrl2;
             }

             if (!winningEmote) {
               await sendChatMessage(`CHAT WAR OVER: It's a tie between ${war.emote1} and ${war.emote2} Refunding all points.`);
               for (const [user, data] of Object.entries(war.userVotes)) {
                  await db.run('UPDATE users SET points = points + ? WHERE username = ?', [data.spent, user]);
               }
               clearChatWarState();
               return;
             }

             clearChatWarState({
               emote: winningEmote,
               url: winningEmoteUrl,
               score: winningScore * war.cost
             });

             const winningPool = winningScore * war.cost;
const totalPool = war.totalPool;

let winnersCount = 0;
const winners = [];
const losers = [];

for (const [user, data] of Object.entries(war.userVotes)) {
  await updateUserStat(user, 'chatwar_spent', data.spent);
  if (data.choice === winningEmote) {
    const payout = Math.floor((data.spent / winningPool) * totalPool);
    const profit = payout - data.spent;

    await db.run('UPDATE users SET points = points + ? WHERE username = ?', [data.spent, user]);
    let finalProfit = profit;
    if (profit > 0) {
      finalProfit = await addPointsWithBonus(user, profit);
    } else if (profit < 0) {
      await db.run('UPDATE users SET points = MAX(0, points + ?) WHERE username = ?', [profit, user]);
    }

    winnersCount++;
    winners.push({ user, won: profit });
  } else {
    losers.push({ user, lost: data.spent });
    await updateUserStat(user, 'chatwar_lost', data.spent);
  }
}

        await updateEmoteStat(winningEmote, true);
        await updateEmoteStat(losingEmote, false);

        winners.sort((a, b) => b.won - a.won);
        losers.sort((a, b) => b.lost - a.lost);

        const messages = [
          `CHAT WAR OVER: ${winningEmote} destroyed ${losingEmote} ${winnersCount} warriors share the spoils!`
        ];

        if (winners.length > 0) {
          const topWinners = winners
            .slice(0, 3)
            .map(w => `${w.user} (+${w.won})`)
            .join(', ');

          messages.push(`🏆 MVP Warriors: ${topWinners}`);
        }

        if (losers.length > 0) {
          const topLosers = losers
            .slice(0, 3)
            .map(l => `${l.user} (-${l.lost})`)
            .join(', ');

          messages.push(`💀 Fallen Warriors: ${topLosers}`);
        }

        await sendChatMessage(messages.join(' | '));
          }
        }, durationMs);

        const reminders = [
          { time: 300000, msg: "5 minutes" },
          { time: 60000, msg: "1 minute" },
          { time: 10000, msg: "10 seconds" }
        ];

        for (const r of reminders) {
          if (durationMs > r.time) {
            const delay = durationMs - r.time;
            const tid = setTimeout(async () => {
              if (activeChatWar) {
                await sendChatMessage(`Reminder: Chat War ( ${emote1} vs ${emote2} ) closes in ${r.msg}! Spam your emote to fight! (Cost: ${cost} pts per vote)`);
              }
            }, delay);
            activeChatWar.reminderTimeouts.push(tid);
          }
        }

        await sendChatMessage(`⚔️ CHAT WAR STARTED: ${emote1} vs ${emote2}! Type your emote to fight! Each vote costs ${cost} points. War ends in ${durationStr}.`);
      }
    },
    '!shoot': {
      cost: 0,
      manualCost: true,
      execute: async (args, chatterName, event, hasPermission) => {
        if (args.length < 1) {
          await sendChatMessage(`${chatterName} usage: !shoot @username`);
          return;
        }

        const target = args[0].replace('@', '').toLowerCase();
        if (target === TARGET_CHANNEL.toLowerCase() || target === BOT_USERNAME.toLowerCase()) {
           await sendChatMessage(`${chatterName} you cannot shoot the broadcaster or bot!`);
           return;
        }

        const cost = parseInt(globalConfig['cmd_!shoot_cost'] !== undefined ? globalConfig['cmd_!shoot_cost'] : '1000', 10);
        let durationMs = parseInt(globalConfig['cmd_!shoot_duration'] !== undefined ? globalConfig['cmd_!shoot_duration'] : '60000', 10);
        const duration = Math.floor(durationMs / 1000);

        if (cost > 0) {
          const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
          if (!user || user.points < cost) {
            await sendChatMessage(`${chatterName} you need ${cost} points to use !shoot!`);
            return;
          }
        }

        try {
          const targetId = await getTwitchUserId(target);
          if (!targetId) {
            await sendChatMessage(`${chatterName} could not find Twitch user ${target}!`);
            return;
          }

          // Fetch current timeout_until
          await db.run('INSERT OR IGNORE INTO users (username) VALUES (?)', target);
          const userObj = await db.get('SELECT timeout_until FROM users WHERE username = ?', target);
          const currentTimeoutUntil = userObj && userObj.timeout_until ? userObj.timeout_until : 0;
          
          const now = Date.now();
          let newTimeoutUntil = 0;
          
          if (currentTimeoutUntil > now) {
            newTimeoutUntil = currentTimeoutUntil + durationMs;
          } else {
            newTimeoutUntil = now + durationMs;
          }
          
          const totalDurationSeconds = Math.ceil((newTimeoutUntil - now) / 1000);

          const success = await timeoutTwitchUser(targetId, totalDurationSeconds, `Shot by ${chatterName} using points`);
          if (success) {
            await db.run('UPDATE users SET timeout_until = ? WHERE username = ?', [newTimeoutUntil, target]);
            if (cost > 0) {
              await db.run('UPDATE users SET points = points - ? WHERE username = ?', [cost, chatterName]);
            }
            await sendChatMessage(`${chatterName} paid ${cost} points to shoot ${target}! They are now timed out for a total of ${totalDurationSeconds} seconds!`);
          } else {
            await sendChatMessage(`${chatterName} failed to shoot ${target}. (Bot might be missing moderator:manage:banned_users scope in its token, or ${target} is a mod/VIP!)`);
          }
        } catch (e) {
          console.error('Error shooting user:', e);
          await sendChatMessage(`${chatterName} failed to shoot ${target}. Check bot console.`);
        }
      }
    },
    '!chatwarcancel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to cancel chat war!`, chatterName);
          return;
        }

        if (!activeChatWar) {
         // await sendChatMessage(`${chatterName} there is no active chat war!`, chatterName);
          return;
        }

        if (activeChatWar.timeoutId) clearTimeout(activeChatWar.timeoutId);
        if (activeChatWar.reminderTimeouts) activeChatWar.reminderTimeouts.forEach(clearTimeout);

        let refunded = 0;
        for (const [user, data] of Object.entries(activeChatWar.userVotes)) {
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [data.spent, user]);
          refunded += data.spent;
        }

        activeChatWar = null;
        clearChatWarState();
        await sendChatMessage(`CHAT WAR CANCELLED: All points (${refunded} total) have been refunded!`);
      }
    },
    '!fish': {
      cost: 0,
      manualCost: true,
      execute: async (args, chatterName, event, hasPermission) => {
        const pending = await db.get('SELECT * FROM pending_fish WHERE username = ?', chatterName);
        if (pending) {
          const timeLeft = Math.max(0, Math.ceil((pending.catch_time - Date.now()) / 1000));
          if (timeLeft > 0) {
            await sendChatMessage(`${chatterName} you are already fishing! Wait ${timeLeft} more seconds.`, chatterName);
            return;
          }
        }

        let isFree = false;
        const ticket = await db.get('SELECT * FROM user_modifiers WHERE username = ? AND modifier = ?', [chatterName, 'free_fish']);
        if (ticket && ticket.value > 0) {
          isFree = true;
          await db.run('UPDATE user_modifiers SET value = value - 1 WHERE username = ? AND modifier = ?', [chatterName, 'free_fish']);
        } else {
          const fishCost = parseInt(globalConfig['cmd_!fish_cost'] !== undefined ? globalConfig['cmd_!fish_cost'] : '2000', 10);
          if (fishCost > 0) {
            const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
            if (!user || user.points < fishCost) {
              await sendChatMessage(`${chatterName} you need ${fishCost} points to fish! (Or use a fishing ticket)`, chatterName);
              return;
            }
            await db.run('UPDATE users SET points = points - ? WHERE username = ?', [fishCost, chatterName]);
          }
        }

        const reductions = await getActiveEffects(chatterName, 'fishing_time_reduction');
        let multiplier = 1.0;
        for (const r of reductions) {
          multiplier *= (1 - r.effect_value);
        }
        
        const baseTimeMinutes = parseFloat(globalConfig['cmd_!fish_time'] !== undefined ? globalConfig['cmd_!fish_time'] : '5');
        const finalTimeMinutes = baseTimeMinutes * multiplier;
        const finalTimeMs = Math.floor(finalTimeMinutes * 60 * 1000);

        const catchTime = Date.now() + finalTimeMs;
        
        // Handle target debuffs and instant catches
        let extraTimeMs = 0;
        const delayedFish = await db.get('SELECT * FROM user_modifiers WHERE username = ? AND modifier = ?', [chatterName, 'delayed_fish']);
        if (delayedFish && delayedFish.value > 0) {
           extraTimeMs = delayedFish.value;
           await db.run('DELETE FROM user_modifiers WHERE username = ? AND modifier = ?', [chatterName, 'delayed_fish']);
        }

        const instantCatch = await db.get('SELECT * FROM active_effects WHERE target_user = ? AND effect_type = ? AND uses_left > 0', [chatterName, 'instant_catch']);
        let finalCatchTime = Date.now() + finalTimeMs + extraTimeMs;
        let usedInstant = false;
        
        if (instantCatch) {
           finalCatchTime = 0;
           usedInstant = true;
           if (instantCatch.uses_left > 1) {
              await db.run('UPDATE active_effects SET uses_left = uses_left - 1 WHERE id = ?', [instantCatch.id]);
           } else {
              await db.run('DELETE FROM active_effects WHERE id = ?', [instantCatch.id]);
           }
        }

        await db.run('INSERT INTO pending_fish (username, catch_time, is_free) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET catch_time = ?, is_free = ?', [chatterName, finalCatchTime, isFree ? 1 : 0, finalCatchTime, isFree ? 1 : 0]);
        
        if (usedInstant) {
           await sendChatMessage(`🎣 ${chatterName} cast their line and immediately felt a tug! (Instant Catch used!)`, chatterName);
        } else {
           const totalMinutes = Math.ceil((finalTimeMs + extraTimeMs) / 60000);
           let msg = `🎣 ${chatterName} cast their line! Wait ${totalMinutes} minutes to see what bites...`;
           if (extraTimeMs > 0) msg += " (Your rod felt cursed, taking longer!)";
           await sendChatMessage(msg, chatterName);
        }
      }
    },
    '!inventory': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const items = await db.all('SELECT * FROM user_inventory WHERE username = ? AND quantity > 0', chatterName);
        if (items.length === 0) {
          await sendChatMessage(`${chatterName} your inventory is empty!`, chatterName);
          return;
        }
        
        const rarityOrder = { 'Legendary': 1, 'Rare': 2, 'Uncommon': 3, 'Common': 4 };
        items.sort((a, b) => {
          let rarityA = 4, rarityB = 4;
          for (const [r, list] of Object.entries(FISHING_ITEMS)) {
            if (list.some(i => i.name === a.item_name)) rarityA = rarityOrder[list[0].rarity];
            if (list.some(i => i.name === b.item_name)) rarityB = rarityOrder[list[0].rarity];
          }
          if (rarityA !== rarityB) return rarityA - rarityB;
          return a.item_name.localeCompare(b.item_name);
        });

        const displayItems = items.slice(0, 3).map(i => ` ${i.item_name} (${i.quantity}x)`);
        let msg = `${chatterName} inv: ${displayItems.join(', ')}`;
        if (items.length > 3) {
          msg += `... visit {site} to see more`;
        }
        await sendChatMessage(msg);
      }
    },
    '!buffs': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        // Query active effects that haven't expired
        const now = Date.now();
        await db.run('DELETE FROM active_effects WHERE expires_at IS NOT NULL AND expires_at < ?', [now]);
        await db.run('DELETE FROM active_effects WHERE uses_left IS NOT NULL AND uses_left <= 0');

        const effects = await db.all('SELECT * FROM active_effects WHERE target_user = ?', chatterName);
        const globalEffects = await db.all('SELECT * FROM active_effects WHERE target_user = "GLOBAL"');
        const modifiers = await db.all('SELECT * FROM user_modifiers WHERE username = ? AND value > 0', chatterName);

        const userRow = await db.get('SELECT xp FROM users WHERE username = ?', chatterName);
        const lvl = userRow ? getLvl(userRow.xp) : 1;
        const lvlPtBonusRate = lvl * (globalConfig['lvl_bonus_rate'] || 0.001);

        const personalBoosts = effects.filter(e => e.effect_type === 'personal_point_boost');
        const globalBoosts = globalEffects.filter(e => e.effect_type === 'global_point_boost');
        const globalDebuffs = globalEffects.filter(e => e.effect_type === 'global_point_debuff');

        let multiplier = 1.0;
        for (const b of personalBoosts) multiplier *= (1 + b.effect_value);
        for (const b of globalBoosts) multiplier *= (1 + b.effect_value);
        for (const b of globalDebuffs) {
           if (b.caster !== chatterName) {
             multiplier *= (1 - b.effect_value);
           }
        }
        
        const totalBonusRate = lvlPtBonusRate + (multiplier - 1);
        const ptGainPct = (totalBonusRate * 100).toFixed(1);
        const ptGainStr = totalBonusRate > 0 ? `+${ptGainPct}%` : `${ptGainPct}%`;

        if (effects.length === 0 && globalEffects.length === 0 && modifiers.length === 0 && totalBonusRate === 0) {
          await sendChatMessage(`${chatterName} you have no active buffs or effects!`, chatterName);
          return;
        }

        await sendChatMessage(`@${chatterName} Point Gain Bonus: ${ptGainStr} ... visit {site} to see more`);
      }
    },

    '!clearoverlay': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to clear the overlay!`, chatterName);
          return;
        }

        let cleared = false;
        
        if (activeBets.has('default')) {
          const bet = activeBets.get('default');
          bet.isHidden = true;
          clearBetState(null);
          cleared = true;
        }
        
        if (activeChatWar) {
          activeChatWar.isHidden = true;
          clearChatWarState(null);
          cleared = true;
        }

        clearEmotes();

        if (cleared) {
          await sendChatMessage(`Overlay cleared by ${chatterName}! (Bets and Chatwars will still continue in the background)`, chatterName);
        } else {
          await sendChatMessage(`Overlay emotes cleared!`);
        }
      }
    },
    '!betstart': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
         // await sendChatMessage(`${chatterName} you do not have permission to start bets!`, chatterName);
          return;
        }

        if (activeBets.has('default')) {
          await sendChatMessage(`${chatterName} there is already an active or unresolved bet! Use !betstop or !betcancel first.`, chatterName);
          return;
        }

        const rawArgs = args.join(' ');
        
        let description, choicesRaw, durationStr;
        const match = rawArgs.match(/"([^"]+)"\s+"([^"]+)"(?:\s+(\w+))?/);
        
        if (match) {
          description = match[1];
          choicesRaw = match[2].split(',').map(c => c.trim().toLowerCase()).filter(c => c);
          durationStr = match[3] || null;
        } else {
          // Fallback for unquoted format like: !betstart Will we win yes,no 1m
          if (args.length < 2) {
            await sendChatMessage(`${chatterName} invalid format! Use: !betstart "Will we win?" "yes,no" 5m`, chatterName);
            return;
          }

          const lastArg = args[args.length - 1];
          const secondLastArg = args[args.length - 2];
          const isDuration = /^\d+[smh]$/i.test(lastArg);

          if (isDuration && secondLastArg && secondLastArg.includes(',')) {
            durationStr = lastArg;
            choicesRaw = secondLastArg.split(',').map(c => c.trim().toLowerCase()).filter(c => c);
            description = args.slice(0, args.length - 2).join(' ');
          } else if (lastArg.includes(',')) {
            durationStr = null;
            choicesRaw = lastArg.split(',').map(c => c.trim().toLowerCase()).filter(c => c);
            description = args.slice(0, args.length - 1).join(' ');
          } else {
            await sendChatMessage(`${chatterName} invalid format! Make sure choices are separated by a comma (ex: yes,no). Example: !betstart test yes,no 1m`, chatterName);
            return;
          }
        }

        if (choicesRaw.length < 2) {
          await sendChatMessage(`${chatterName} you need at least 2 choices separated by commas!`, chatterName);
          return;
        }

        const betData = {
          id: 'default',
          description,
          choices: choicesRaw,
          isOpen: true,
          totalPool: 0,
          pools: {},
          userBets: {},
          timeoutId: null,
          reminderTimeouts: []
        };

        for (const c of choicesRaw) {
          betData.pools[c] = 0;
        }

        activeBets.set('default', betData);
        broadcastBetState(betData);

        let durationMsg = '';
        if (durationStr) {
          const durationMs = parseTime(durationStr);
          durationMsg = ` Betting closes in ${durationStr}.`;
          
          betData.durationMs = durationMs;
          betData.endTime = Date.now() + durationMs;
          

          broadcastBetState(betData);
          
          betData.timeoutId = setTimeout(async () => {
            const b = activeBets.get('default');
            if (b && b.isOpen) {
              b.isOpen = false;
              clearBetState(); 
              await sendChatMessage(`Betting is now CLOSED for: "${b.description}"! Waiting for results...`);
            }
          }, durationMs);

          const reminders = [
            { time: 300000, msg: "5 minutes" },
            { time: 60000, msg: "1 minute" },
            { time: 10000, msg: "10 seconds" }
          ];

          for (const r of reminders) {
            if (durationMs > r.time) {
              const delay = durationMs - r.time;
              const tid = setTimeout(async () => {
                const b = activeBets.get('default');
                if (b && b.isOpen) {
                  await sendChatMessage(`Reminder: Betting for "${b.description}" closes in ${r.msg}!`);
                }
              }, delay);
              betData.reminderTimeouts.push(tid);
            }
          }
        }

        await sendChatMessage(`BET STARTED: "${description}" - Choices: [${choicesRaw.join(' / ')}] Type "!bet <choice> <amount>" to play!${durationMsg}`);
      }
    },
    '!betstop': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
         //  await sendChatMessage(`${chatterName} you do not have permission to stop bets!`, chatterName);
          return;
        }

        const bet = activeBets.get('default');
        if (!bet) {
        //  await sendChatMessage(`${chatterName} there is no active bet!`, chatterName);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`${chatterName} please specify the winning choice! Example: !betstop yes`, chatterName);
          return;
        }

        const winningChoice = args[0].toLowerCase();
        if (!bet.choices.includes(winningChoice)) {
          await sendChatMessage(`${chatterName} invalid choice! Valid choices are: ${bet.choices.join(', ')}`, chatterName);
          return;
        }

        bet.isOpen = false;
        if (bet.timeoutId) clearTimeout(bet.timeoutId);
        if (bet.reminderTimeouts) bet.reminderTimeouts.forEach(clearTimeout);

        const totalPool = bet.totalPool;
        const winningPool = bet.pools[winningChoice];

        if (winningPool === 0) {
          for (const [user, userBet] of Object.entries(bet.userBets)) {
             await updateUserStat(user, 'bets_played', 1);
             await updateUserStat(user, 'bets_points_bet', userBet.amount);
             await updateUserStat(user, 'bets_lost', 1);
             await updateUserStat(user, 'bets_points_lost', userBet.amount);
          }
          await sendChatMessage(`BET RESOLVED: "${bet.description}" won by ${winningChoice}. Nobody voted for the winner! House takes the pool (${totalPool} pts)`);
          activeBets.delete('default');
          clearBetState(null);
        } else {
          let winnersCount = 0;
          const winners = [];
          const losers = [];
          
          for (const [user, userBet] of Object.entries(bet.userBets)) {
            await updateUserStat(user, 'bets_played', 1);
            await updateUserStat(user, 'bets_points_bet', userBet.amount);

            if (userBet.choice === winningChoice) {
              const payout = Math.floor((userBet.amount / winningPool) * totalPool);
              const profit = payout - userBet.amount;
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [payout, user]);
              
              await updateUserStat(user, 'bets_won', 1);
              await updateUserStat(user, 'bets_points_won', profit);

              winnersCount++;
              winners.push({ user, amount: userBet.amount, won: profit });
            } else {
              await updateUserStat(user, 'bets_lost', 1);
              await updateUserStat(user, 'bets_points_lost', userBet.amount);
              
              losers.push({ user, amount: userBet.amount, lost: userBet.amount });
            }
          }
          
          winners.sort((a, b) => b.won - a.won);
          losers.sort((a, b) => b.lost - a.lost);

         const messages = [
          `BET RESOLVED: "${bet.description}" won by ${winningChoice}! ${winnersCount} winners share the ${totalPool} point pool!`
        ];

        if (winners.length > 0) {
          const topWinners = winners
            .slice(0, 3)
            .map(w => `${w.user} (+${w.won})`)
            .join(', ');

          messages.push(`🏆 Top Winners: ${topWinners}`);
        }

        if (losers.length > 0) {
          const topLosers = losers
            .slice(0, 3)
            .map(l => `${l.user} (-${l.lost})`)
            .join(', ');

          messages.push(`💀 Top Losers: ${topLosers}`);
        }

        await sendChatMessage(messages.join(' | '));
          
          const resultData = {
            winners: winners.slice(0, 20),
            losers: losers.slice(0, 20),
            winningChoice: winningChoice,
            choiceA: bet.choices[0],
            choiceB: bet.choices[1]
          };
          
          activeBets.delete('default');
          clearBetState(resultData);
        }

      }
    },
    '!betcancel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to cancel bets!`, chatterName);
          return;
        }

        const bet = activeBets.get('default');
        if (!bet) {
         // await sendChatMessage(`${chatterName} there is no active bet!`, chatterName);
          return;
        }

        if (bet.timeoutId) clearTimeout(bet.timeoutId);
        if (bet.reminderTimeouts) bet.reminderTimeouts.forEach(clearTimeout);
        bet.isOpen = false;

        let refunded = 0;
        for (const [user, userBet] of Object.entries(bet.userBets)) {
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [userBet.amount, user]);
          refunded += userBet.amount;
        }

        await sendChatMessage(`BET CANCELLED: All points (${refunded} total) have been refunded!`);
        activeBets.delete('default');
        clearBetState();
      }
    },
    '!bet': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const bet = activeBets.get('default');
        if (!bet) {
       //   await sendChatMessage(`${chatterName} there is no active bet right now!`, chatterName);
          return;
        }
        if (!bet.isOpen) {
          await sendChatMessage(`${chatterName} betting is closed for the current bet!`, chatterName);
          return;
        }

        if (bet.userBets[chatterName]) {
          await sendChatMessage(`${chatterName} you have already bet ${bet.userBets[chatterName].amount} on [${bet.userBets[chatterName].choice}]!`, chatterName);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !bet <choice> <amount>`, chatterName);
          return;
        }

        const choice = args[0].toLowerCase();
        if (!bet.choices.includes(choice)) {
          await sendChatMessage(`${chatterName} invalid choice! Valid choices are: ${bet.choices.join(', ')}`, chatterName);
          return;
        }

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`${chatterName} you don't have enough points!`, chatterName);
          return;
        }

        const amountInput = args[1].toLowerCase();
        let betAmount = 0;

        if (amountInput === 'all') {
          betAmount = user.points;
        } else if (amountInput.endsWith('%')) {
          const percent = parseFloat(amountInput.replace('%', ''));
          if (!isNaN(percent) && percent > 0 && percent <= 100) {
            betAmount = Math.floor(user.points * (percent / 100));
          }
        } else {
          betAmount = parseAmount(amountInput);
        }

        if (isNaN(betAmount) || betAmount <= 0 || betAmount > user.points) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [betAmount, chatterName]);
        
        bet.userBets[chatterName] = { choice, amount: betAmount };
        bet.pools[choice] += betAmount;
        bet.totalPool += betAmount;

        broadcastBetState(bet);
        await sendChatMessage(`${chatterName} bet ${betAmount} on ${choice}!`, chatterName);
      }
    },
    '!betstatus': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const bet = activeBets.get('default');
        if (!bet) {
       //   await sendChatMessage(`There is no active bet right now!`);
          return;
        }

        const ratioTexts = bet.choices.map(choice => {
          const pool = bet.pools[choice];
          const odds = pool > 0 ? (bet.totalPool / pool).toFixed(2) : 0;
          return `${choice}: ${odds}x`;
        });

        await sendChatMessage(`ACTIVE BET: "${bet.description}" | ${ratioTexts.join(' | ')}`);
      }
    },
    '!editcommand': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to edit commands!`, chatterName);
          return;
        }

        if (args.length < 3) {
          await sendChatMessage(`${chatterName} invalid format! Use: !editcommand <command> <setting> <value>`, chatterName);
          return;
        }

        const targetCmd = args[0].toLowerCase();
        const setting = args[1].toLowerCase();
        const value = args[2];

        const validSettings = commandConfigSchema[targetCmd];
        if (!validSettings) {
          if (customAliasesMap.has(targetCmd) && (setting === 'cost' || setting === 'cooldown')) {
            if (setting === 'cost') {
              const costVal = parseInt(value, 10);
              if (isNaN(costVal) || costVal < 0) {
                await sendChatMessage(`${chatterName} invalid cost! It must be a number >= 0.`, chatterName);
                return;
              }
              await db.run('UPDATE custom_aliases SET cost = ? WHERE command = ?', [costVal, targetCmd]);
              const alias = customAliasesMap.get(targetCmd);
              alias.cost = costVal;
              await sendChatMessage(`Successfully updated custom command ${targetCmd} cost to ${costVal}!`);
              return;
            } else if (setting === 'cooldown') {
              const cdVal = parseFlexibleTime(value);
              if (isNaN(cdVal) || cdVal < 0) {
                await sendChatMessage(`${chatterName} invalid cooldown time! Use ms (1000), or 10s, 5m, 1h.`, chatterName);
                return;
              }
              const configKey = `cmd_${targetCmd}_cooldown`;
              await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, cdVal, cdVal]);
              globalConfig[configKey] = cdVal;
              await sendChatMessage(`Successfully updated custom command ${targetCmd} cooldown to ${cdVal} ms!`);
              return;
            }
          }
          await sendChatMessage(`${chatterName} unknown command: ${targetCmd}`, chatterName);
          return;
        }

        if (!validSettings.includes(setting)) {
          await sendChatMessage(`${chatterName} invalid setting! ${targetCmd} only supports changing: ${validSettings.join(', ')}`, chatterName);
          return;
        }

        let finalValue = value;
        if (setting === 'cooldown' || setting === 'duration') {
          const parsedTime = parseFlexibleTime(value);
          if (isNaN(parsedTime) || parsedTime < 0) {
            await sendChatMessage(`${chatterName} invalid ${setting} time! Use ms (1000), or 10s, 5m, 1h.`, chatterName);
            return;
          }
          finalValue = parsedTime.toString();
        }

        const configKey = `cmd_${targetCmd}_${setting}`;
        
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, finalValue, finalValue]);
        
        globalConfig[configKey] = finalValue;

        if (targetCmd === '!showemote' && (setting === 'duration' || setting === 'size')) {
          broadcastConfig(globalConfig);
        }

        await sendChatMessage(`Successfully updated ${targetCmd} ${setting} to ${finalValue}!`);
      }
    },
    '!editplaysound': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) return;

        if (args.length < 3) {
          await sendChatMessage(`Usage: !editplaysound <playsound_name> cost/cooldown <value|default>`);
          return;
        }

        const psName = args[0].toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '');
        const setting = args[1].toLowerCase();
        let value = args[2].toLowerCase();

        if (setting !== 'cost' && setting !== 'cooldown') {
          await sendChatMessage(`Invalid setting. Use 'cost' or 'cooldown'`);
          return;
        }

        if (value === 'default' || value === 'clear' || value === 'none') {
          value = '';
        } else {
          if (setting === 'cooldown') {
            const parsedTime = parseFlexibleTime(value);
            if (isNaN(parsedTime) || parsedTime < 0) {
              await sendChatMessage(`Invalid cooldown time! Use ms (1000), or 10s, 5m, 1h.`);
              return;
            }
            value = parsedTime.toString();
          } else {
            value = parseInt(value, 10);
            if (isNaN(value) || value < 0) {
              await sendChatMessage(`Value must be a valid number or 'default'`);
              return;
            }
            value = value.toString();
          }
        }

        const configKey = setting === 'cost' ? `cost_playsound_${psName}` : `cooldown_playsound_${psName}`;
        
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, value, value]);
        globalConfig[configKey] = value;

        if (value === '') {
          await sendChatMessage(`Playsound '${psName}' ${setting} has been reset to default.`);
        } else {
          await sendChatMessage(`Playsound '${psName}' ${setting} updated to ${value}.`);
        }
      }
    },
    '!addcommand': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to add commands!`, chatterName);
          return;
        }

        if (args.length < 3) {
          await sendChatMessage(`${chatterName} invalid format! Use: !addcommand <!command> <cost> <action>`, chatterName);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!cmdName.startsWith('!')) {
          await sendChatMessage(`${chatterName} the command must start with a ! (e.g. !mycmd)`, chatterName);
          return;
        }
        
        if (customCommands[cmdName] || cmdName === '!showemote') {
          await sendChatMessage(`${chatterName} you cannot overwrite a built-in command!`, chatterName);
          return;
        }

        const cost = parseInt(args[1], 10);
        if (isNaN(cost) || cost < 0) {
          await sendChatMessage(`${chatterName} invalid cost! It must be a number >= 0.`, chatterName);
          return;
        }

        const action = args.slice(2).join(' ');
        
        await db.run('INSERT INTO custom_aliases (command, cost, action) VALUES (?, ?, ?) ON CONFLICT(command) DO UPDATE SET cost = ?, action = ?', [cmdName, cost, action, cost, action]);
        
        customAliasesMap.set(cmdName, { cost, action });
        await sendChatMessage(`Successfully added ${cmdName} (cost: ${cost})!`);
      }
    },
    '!removecommand': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to delete commands!`, chatterName);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`${chatterName} invalid format! Use: !removecommand <!command>`, chatterName);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!customAliasesMap.has(cmdName)) {
          await sendChatMessage(`${chatterName} command ${cmdName} does not exist!`, chatterName);
          return;
        }

        await db.run('DELETE FROM custom_aliases WHERE command = ?', cmdName);
        customAliasesMap.delete(cmdName);
        await sendChatMessage(`Successfully deleted ${cmdName}!`);
      }
    },
    '!commandlist': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const builtIn = Object.keys(customCommands);
        if (!builtIn.includes('!showemote')) builtIn.push('!showemote');
        const custom = Array.from(customAliasesMap.keys());
        
        const allCommands = [...builtIn, ...custom].sort();
        await sendChatMessage(`Commands: ${allCommands.join(', ')}`);
      }
    },
    '!disable': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to disable commands!`, chatterName);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`${chatterName} invalid format! Use: !disable <!command> [time]`, chatterName);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!cmdName.startsWith('!')) {
          await sendChatMessage(`${chatterName} the command must start with a ! (e.g. !mycmd)`, chatterName);
          return;
        }
        
        if (cmdName === '!enable' || cmdName === '!disable') {
          await sendChatMessage(`${chatterName} you cannot disable ${cmdName}!`, chatterName);
          return;
        }
        
        let disabledValue = 'forever';
        if (args.length > 1) {
          const parsedTime = parseFlexibleTime(args[1]);
          if (isNaN(parsedTime) || parsedTime <= 0) {
            await sendChatMessage(`${chatterName} invalid time format! Use ms (10000), or 10s, 10m, 10h.`, chatterName);
            return;
          }
          disabledValue = (Date.now() + parsedTime).toString();
        }

        const configKey = `cmd_${cmdName}_disabled_until`;
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, disabledValue, disabledValue]);
        globalConfig[configKey] = disabledValue;

        const timeMsg = disabledValue === 'forever' ? 'forever' : `for ${args[1]}`;
        await sendChatMessage(`Successfully disabled ${cmdName} ${timeMsg}!`);
      }
    },
    '!enable': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to enable commands!`, chatterName);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`${chatterName} invalid format! Use: !enable <!command>`, chatterName);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!cmdName.startsWith('!')) {
          await sendChatMessage(`${chatterName} the command must start with a ! (e.g. !mycmd)`, chatterName);
          return;
        }
        
        const configKey = `cmd_${cmdName}_disabled_until`;
        await db.run('DELETE FROM app_config WHERE key = ?', configKey);
        delete globalConfig[configKey];
        
        await sendChatMessage(`Successfully enabled ${cmdName}!`);
      }
    },
    '!subonly': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
        if (!isMod) {
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !subonly <!command> <true/false>`, chatterName);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!cmdName.startsWith('!')) {
          await sendChatMessage(`${chatterName} the command must start with a ! (e.g. !mycmd)`, chatterName);
          return;
        }
        
        const isSubOnly = args[1].toLowerCase() === 'true';
        const configKey = `cmd_${cmdName}_sub_only`;
        
        if (isSubOnly) {
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, 'true', 'true']);
          globalConfig[configKey] = 'true';
          await sendChatMessage(`Successfully made ${cmdName} subscriber-only!`);
        } else {
          await db.run('DELETE FROM app_config WHERE key = ?', configKey);
          delete globalConfig[configKey];
          await sendChatMessage(`Successfully removed subscriber-only restriction from ${cmdName}!`);
        }
      }
    },
    '!editrewards': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to edit rewards!`, chatterName);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`Usage: !editrewards <type> <val1> [val2]. Types: sub, bits, giftsub, watchstreak, raffle, multiraffle, chat`);
          return;
        }

        const type = args[0].toLowerCase();
        const val1 = parseInt(args[1], 10);
        const val2 = args.length > 2 ? parseInt(args[2], 10) : null;

        if (isNaN(val1)) {
          await sendChatMessage(`Invalid value: ${args[1]}`);
          return;
        }

        if (type === 'sub' || type === 'bits') {
          const key = `reward_${type}`;
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [key, val1, val1]);
          globalConfig[key] = val1.toString();
          await sendChatMessage(`Reward for ${type} updated to ${val1}.`);
        } else if (type === 'giftsub' || type === 'watchstreak') {
          if (args.length < 4) {
            await sendChatMessage(`Usage for ${type}: !editrewards ${type} <base_reward> <scaling> <cap>`);
            return;
          }
          const val3 = parseInt(args[3], 10);
          if (isNaN(val2) || isNaN(val3)) {
            await sendChatMessage(`Invalid values for scaling or cap.`);
            return;
          }
          const keyBase = `reward_${type}`;
          const keyScaling = `reward_${type}_scaling`;
          const keyCap = `reward_${type}_cap`;

          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [keyBase, val1, val1]);
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [keyScaling, val2, val2]);
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [keyCap, val3, val3]);
          
          globalConfig[keyBase] = val1.toString();
          globalConfig[keyScaling] = val2.toString();
          globalConfig[keyCap] = val3.toString();
          
          await sendChatMessage(`Reward for ${type} updated! Base: ${val1} | Scaling: ${val2} | Cap: ${val3}`);
        } else if (type === 'raffle' || type === 'multiraffle') {
          if (val2 === null || isNaN(val2)) {
            await sendChatMessage(`Usage for ${type}: !editrewards ${type} <min> <max>`);
            return;
          }
          const keyMin = `reward_${type}_min`;
          const keyMax = `reward_${type}_max`;
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [keyMin, val1, val1]);
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [keyMax, val2, val2]);
          globalConfig[keyMin] = val1.toString();
          globalConfig[keyMax] = val2.toString();
          await sendChatMessage(`Reward range for ${type} updated to ${val1} - ${val2}.`);
        } else if (type === 'chat') {
          if (val2 === null || isNaN(val2) || args.length < 4) {
            await sendChatMessage(`Usage for chat: !editrewards chat <nonsub_points> <sub_points> <cooldown_minutes>`);
            return;
          }
          const val3 = parseInt(args[3], 10);
          if (isNaN(val3)) {
            await sendChatMessage(`Invalid cooldown value: ${args[3]}`);
            return;
          }
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', ['reward_chat_nonsub', val1, val1]);
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', ['reward_chat_sub', val2, val2]);
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', ['reward_chat_cooldown', val3, val3]);
          globalConfig['reward_chat_nonsub'] = val1.toString();
          globalConfig['reward_chat_sub'] = val2.toString();
          globalConfig['reward_chat_cooldown'] = val3.toString();
          await sendChatMessage(`Chat rewards updated! Non-subs: ${val1} pts | Subs: ${val2} pts | Cooldown: ${val3} mins.`);
        } else {
          await sendChatMessage(`Unknown reward type: ${type}. Valid types: sub, bits, giftsub, watchstreak, raffle, multiraffle, chat`);
        }
      }
    },
    '!giveitem': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) return;

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !giveitem <username> <item name> [amount]`);
          return;
        }

        const targetUser = args[0].replace(/@/g, '').toLowerCase();
        
        let amount = 1;
        let lastArg = args[args.length - 1];
        if (!isNaN(parseInt(lastArg, 10)) && parseInt(lastArg, 10) > 0) {
           amount = parseInt(lastArg, 10);
           args.pop(); // remove amount from args
        }
        
        const searchName = args.slice(1).join(' ').toLowerCase();
        
        let itemName = null;
        for (const key of Object.keys(ITEMS_REGISTRY)) {
           if (key.toLowerCase() === searchName) {
              itemName = key;
              break;
           }
        }

        if (!itemName) {
           await sendChatMessage(`Item "${searchName}" does not exist in the database!`);
           return;
        }

        await db.run('INSERT INTO user_inventory (username, item_name, quantity) VALUES (?, ?, ?) ON CONFLICT(username, item_name) DO UPDATE SET quantity = quantity + ?', [targetUser, itemName, amount, amount]);
        await sendChatMessage(`Given ${amount}x ${itemName} to ${targetUser} !`);
      }
    },
    '!reloaditems': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) return;

        try {
          await loadItemsConfig();
          await sendChatMessage(`Items have been reloaded successfully from the database!`);
        } catch (e) {
          console.error(e);
          await sendChatMessage(`Failed to reload items: ${e.message}`);
        }
      }
    },
    '!raffle': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        let user = await db.get('SELECT points, xp FROM users WHERE username = ?', chatterName);
        if (!user) {
          await db.run('INSERT OR IGNORE INTO users (username, points, xp) VALUES (?, 0, 0)', [chatterName]);
          user = { points: 0, xp: 0 };
        }

        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          return;
        }

        if (activeRaffle) {
          await sendChatMessage(`${chatterName} there is already an active raffle!`, chatterName);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`${chatterName} invalid format! Use: !raffle <amount> <time>`, chatterName);
          return;
        }

        const amount = parseAmount(args[0]);
        if (isNaN(amount) || amount === 0) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        const durationMs = parseFlexibleTime(args[1]);
        if (isNaN(durationMs) || durationMs <= 0) {
          await sendChatMessage(`${chatterName} invalid time!`, chatterName);
          return;
        }

        activeRaffle = {
          type: 'single',
          amount,
          durationStr: args[1],
          endTime: Date.now() + durationMs,
          users: new Set(),
          timeoutId: null
        };

        await sendChatMessage(`🎉 A RAFFLE for ${amount} points has started! Type !join to enter. You have ${args[1]}!`);

        activeRaffle.timeoutId = setTimeout(async () => {
          if (!activeRaffle) return;
          const r = activeRaffle;
          activeRaffle = null;

          if (r.users.size === 0) {
            await sendChatMessage(`The raffle has ended, but nobody joined! `);
            return;
          }

          const { expanded, guaranteed } = await buildRaffleParticipants(r.users);
          const uniqueParticipants = Array.from(r.users);

          let winner;
          if (guaranteed.length > 0) {
            winner = guaranteed[Math.floor(Math.random() * guaranteed.length)];
          } else {
            winner = expanded[Math.floor(Math.random() * expanded.length)];
          }

          const finalAdded = await addPointsWithBonus(winner, r.amount);

          await updateRaffleStats(uniqueParticipants, [winner], finalAdded);

          await sendChatMessage(`🎉 The raffle has ended! Congratulations ${winner} you won ${finalAdded} points!`);
        }, durationMs);
      }
    },
    '!multiraffle': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
        //  await sendChatMessage(`${chatterName} you do not have permission to start raffles!`, chatterName);
          return;
        }

        if (activeRaffle) {
          await sendChatMessage(`${chatterName} there is already an active raffle!`, chatterName);
          return;
        }

        if (args.length < 3) {
          await sendChatMessage(`${chatterName} invalid format! Use: !multiraffle <amount> <time> <winners>`, chatterName);
          return;
        }

        const amount = parseAmount(args[0]);
        if (isNaN(amount) || amount === 0) {
          await sendChatMessage(`${chatterName} invalid amount!`, chatterName);
          return;
        }

        const durationMs = parseFlexibleTime(args[1]);
        if (isNaN(durationMs) || durationMs <= 0) {
          await sendChatMessage(`${chatterName} invalid time!`, chatterName);
          return;
        }

        const numWinners = parseInt(args[2], 10);
        if (isNaN(numWinners) || numWinners <= 0) {
          await sendChatMessage(`${chatterName} invalid number of winners!`, chatterName);
          return;
        }

        activeRaffle = {
          type: 'multi',
          amount,
          numWinners,
          durationStr: args[1],
          endTime: Date.now() + durationMs,
          users: new Set(),
          timeoutId: null
        };

        await sendChatMessage(`🎉 A MULTI-RAFFLE for ${amount} points (split among ${numWinners} winners) has started! Type !join to enter. You have ${args[1]}!`);

        activeRaffle.timeoutId = setTimeout(async () => {
          if (!activeRaffle) return;
          const r = activeRaffle;
          activeRaffle = null;

          if (r.users.size === 0) {
            await sendChatMessage(`The multi-raffle has ended, but nobody joined!`);
            return;
          }

          const { expanded, guaranteed } = await buildRaffleParticipants(r.users);
          const uniqueParticipants = Array.from(r.users);
          
          let allWinners = [];
          
          // 1. Pick guaranteed winners first
          for (let i = guaranteed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [guaranteed[i], guaranteed[j]] = [guaranteed[j], guaranteed[i]];
          }
          for (const g of guaranteed) {
            if (allWinners.length < r.numWinners && !allWinners.includes(g)) {
              allWinners.push(g);
            }
          }

          // 2. Pick the rest from expanded pool
          for (let i = expanded.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
          }
          for (const p of expanded) {
            if (allWinners.length >= r.numWinners) break;
            if (!allWinners.includes(p)) {
              allWinners.push(p);
            }
          }

          const actualWinnersCount = allWinners.length;
          const splitAmount = Math.floor(r.amount / actualWinnersCount);

          for (const w of allWinners) {
            await addPointsWithBonus(w, splitAmount);
          }

          await updateRaffleStats(uniqueParticipants, allWinners, splitAmount);

          const displayWinners = allWinners.slice(0, 5);
          let winnersText = displayWinners.map(w => `${w}`).join(', ');
          if (actualWinnersCount > 5) {
            winnersText += ` and ${actualWinnersCount - 5} others`;
          }

          await sendChatMessage(`🎉 The multi-raffle has ended! Congratulations to our ${actualWinnersCount} winners: ${winnersText}. You each won ${splitAmount} base points (plus your personal bonuses)!`);
        }, durationMs);
      }
    },
    '!join': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!activeRaffle) {
          return;
        }
        
        if (activeRaffle.users.has(chatterName)) {
          return;
        }

        activeRaffle.users.add(chatterName);
      }
    }
  };

  async function getTwitchUserId(username) {
    try {
      let res = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
        headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
      });
      if (res.status === 401) {
        USER_ACCESS_TOKEN = await getValidAccessToken();
        res = await fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
          headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
        });
      }
      const data = await res.json();
      if (data && data.data && data.data.length > 0) {
        return data.data[0].id;
      }
      return null;
    } catch (e) {
      console.error('Error fetching twitch user ID:', e);
      return null;
    }
  }

  async function timeoutTwitchUser(targetUserId, durationSeconds, reason = '') {
    try {
      let res = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${BROADCASTER_USER_ID}&moderator_id=${YOUR_USER_ID}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
          'Client-Id': CLIENT_ID,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: {
            user_id: targetUserId,
            duration: durationSeconds,
            reason: reason
          }
        })
      });

      if (res.status === 401) {
        USER_ACCESS_TOKEN = await getValidAccessToken();
        res = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${BROADCASTER_USER_ID}&moderator_id=${YOUR_USER_ID}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
            'Client-Id': CLIENT_ID,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            data: {
              user_id: targetUserId,
              duration: durationSeconds,
              reason: reason
            }
          })
        });
      }

      const data = await res.json().catch(() => ({}));
      if (res.ok) return true;
      
      console.error('Failed to timeout user via Helix API:', data);
      return false;
    } catch (e) {
      console.error('Error sending timeout request:', e);
      return false;
    }
  }

  let isStreamLiveCached = false;
  let lastStreamCheckTime = 0;

  async function isStreamerLive() {
    if (Date.now() - lastStreamCheckTime < 10000) {
      return isStreamLiveCached;
    }
    try {
      let res = await fetch(`https://api.twitch.tv/helix/streams?user_id=${BROADCASTER_USER_ID}`, {
        headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
      });
      
      if (res.status === 401) {
        console.log('* Twitch token expired during runtime. Attempting to refresh...');
        USER_ACCESS_TOKEN = await getValidAccessToken();
        res = await fetch(`https://api.twitch.tv/helix/streams?user_id=${BROADCASTER_USER_ID}`, {
          headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
        });
      }

      const data = await res.json();
      if (data && data.data) {
        isStreamLiveCached = data.data.length > 0;
        lastStreamCheckTime = Date.now();
        if (isStreamLiveCached && data.data[0].started_at) {
          streamStartTime = new Date(data.data[0].started_at).getTime();
        }
      } else {
        console.error('! Twitch API Error during isStreamerLive:', data);
      }
    } catch (e) {
      console.error('! Failed to check stream status:', e);
    }
    return isStreamLiveCached;
  }

  function connect7TV(broadcasterId) {
    if (!sevenTvEmoteSetId) return;
    const sTvWs = new WebSocket('wss://events.7tv.io/v3');

    sTvWs.on('open', () => {
      console.log('* Connected to 7TV Real-Time Updates.');
      sTvWs.send(JSON.stringify({
        op: 35,
        d: {
          type: "emote_set.update",
          condition: { object_id: sevenTvEmoteSetId }
        }
      }));
    });

    sTvWs.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.op === 0 && msg.d.type === 'emote_set.update') {
        console.log(`\n* [7TV UPDATE DETECTED] Auto-reloading all emotes...`);
        loadThirdPartyEmotes(broadcasterId);
      }
    });

    sTvWs.on('close', () => {
      setTimeout(() => connect7TV(broadcasterId), 5000);
    });
  }

  connect7TV(BROADCASTER_USER_ID);

  
  // --- Helper Function: Simulate EventSub Emote Fragments ---
  function buildFragmentsFromIrc(text, emotesTag) {
    const fragments = [];
    if (!emotesTag) {
      fragments.push({ type: 'text', text: text });
      return fragments;
    }

    const emotePlacements = [];
    emotesTag.split('/').forEach(emoteGroup => {
      const [emoteId, positions] = emoteGroup.split(':');
      positions.split(',').forEach(pos => {
        const [start, end] = pos.split('-').map(Number);
        emotePlacements.push({ id: emoteId, start, end });
      });
    });

    emotePlacements.sort((a, b) => a.start - b.start);

    let currentIndex = 0;
    const chars = Array.from(text);
    
    emotePlacements.forEach(placement => {
      if (placement.start > currentIndex) {
        fragments.push({ type: 'text', text: chars.slice(currentIndex, placement.start).join('') });
      }
      fragments.push({ 
        type: 'emote', 
        emote: { id: placement.id }, 
        text: chars.slice(placement.start, placement.end + 1).join('') 
      });
      currentIndex = placement.end + 1;
    });

    if (currentIndex < chars.length) {
      fragments.push({ type: 'text', text: chars.slice(currentIndex).join('') });
    }

    return fragments;
  }

  let activeWs = null;
  const userCooldowns = new Map();
  const commandCooldowns = new Map();
  const playsoundCooldowns = new Map();
  const activeBets = new Map();
  let activeChatWar = null;
  let activeRaffle = null;
  let lastChatWideCommandTime = 0;

  async function triggerRandomRaffle(triggerName) {
    if (activeRaffle) return; 

    const isMulti = Math.random() < 0.5;
    
    const minPoints = parseInt(globalConfig['reward_raffle_min'] || '1500', 10);
    const maxPoints = parseInt(globalConfig['reward_raffle_max'] || '25000', 10);
    const amount = Math.floor(Math.random() * (maxPoints - minPoints + 1)) + minPoints;
    
    const durationMinutes = 1;
    const durationMs = durationMinutes * 30000;
    const durationStr = `30 seconds`;

    if (isMulti) {
      const minWinnersRaffle = parseInt(globalConfig['reward_multiraffle_min'] || '3', 10);
      const maxWinnersRaffle = parseInt(globalConfig['reward_multiraffle_max'] || '12', 10);
      const numWinners = Math.floor(Math.random() * (maxWinnersRaffle - minWinnersRaffle + 1)) + minWinnersRaffle;
      activeRaffle = {
        type: 'multi',
        amount,
        numWinners,
        durationStr,
        endTime: Date.now() + durationMs,
        users: new Set(),
        timeoutId: null
      };
      await sendChatMessage(`🎉 A random MULTI-RAFFLE was triggered by a ${triggerName}! ${amount} points will be split among ${numWinners} winners! Type !join to enter. You have ${durationStr}!`);
    } else {
      activeRaffle = {
        type: 'single',
        amount,
        durationStr,
        endTime: Date.now() + durationMs,
        users: new Set(),
        timeoutId: null
      };
      await sendChatMessage(`🎉 A random RAFFLE was triggered by a ${triggerName}! 1 winner will get ${amount} points! Type !join to enter. You have ${durationStr}!`);
    }

    activeRaffle.timeoutId = setTimeout(async () => {
      if (!activeRaffle) return;
      const r = activeRaffle;
      activeRaffle = null;

      if (r.users.size === 0) {
        await sendChatMessage(`The random ${r.type === 'multi' ? 'multi-raffle' : 'raffle'} ended, but nobody joined!`);
        return;
      }

      const { expanded, guaranteed } = await buildRaffleParticipants(r.users);
      const uniqueParticipants = Array.from(r.users);
      
      if (r.type === 'multi') {
        let allWinners = [];
        
        // 1. Pick guaranteed winners first
        for (let i = guaranteed.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [guaranteed[i], guaranteed[j]] = [guaranteed[j], guaranteed[i]];
        }
        for (const g of guaranteed) {
          if (allWinners.length < r.numWinners && !allWinners.includes(g)) {
            allWinners.push(g);
          }
        }

        // 2. Pick the rest from expanded pool
        for (let i = expanded.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [expanded[i], expanded[j]] = [expanded[j], expanded[i]];
        }
        for (const p of expanded) {
          if (allWinners.length >= r.numWinners) break;
          if (!allWinners.includes(p)) {
            allWinners.push(p);
          }
        }

        const actualWinnersCount = allWinners.length;
        const splitAmount = Math.floor(r.amount / actualWinnersCount);

        for (const w of allWinners) {
          await addPointsWithBonus(w, splitAmount);
        }
        await updateRaffleStats(uniqueParticipants, allWinners, splitAmount);
        const winnersText = allWinners.map(w => `${w}`).join(', ');
        await sendChatMessage(`🎉 The random multi-raffle has ended! Congratulations to our ${actualWinnersCount} winners: ${winnersText}. You each won ${splitAmount} base points (plus your personal bonuses)!`);
      } else {
        let winner;
        if (guaranteed.length > 0) {
          winner = guaranteed[Math.floor(Math.random() * guaranteed.length)];
        } else {
          winner = expanded[Math.floor(Math.random() * expanded.length)];
        }
        
        const finalAdded = await addPointsWithBonus(winner, r.amount);
        await updateRaffleStats(uniqueParticipants, [winner], finalAdded);
        await sendChatMessage(`🎉 The random raffle has ended! Congratulations ${winner} you won ${finalAdded} points!`);
      }
    }, durationMs);
  }

  async function connectTwitch() {
    try {
      USER_ACCESS_TOKEN = await getValidAccessToken();
    } catch (err) {
      console.error('! Failed to refresh token before reconnecting:', err);
    }

    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    let isReconnecting = false;
    let watchdogTimer = null;

    function resetWatchdog() {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        console.log('! No messages from Twitch for 6 minutes. Connection is likely dead. Terminating to force reconnect...');
        ws.terminate();
      }, 6 * 60 * 1000);
    }

    ws.on('open', () => {
      resetWatchdog();
      isReconnecting = false;
      console.log(`* Connected to Twitch IRC at ${TARGET_CHANNEL}...`);
      
      // Request all capabilities
      ws.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${USER_ACCESS_TOKEN}`);
      ws.send(`NICK ${BOT_USERNAME}`);

    });

    ws.on('message', async (data) => {
      resetWatchdog();
      const rawMessage = data.toString().trim();
      const lines = rawMessage.split('\r\n');

      for (const line of lines) {
        if (!line) continue;

        if (line.startsWith('PING')) {
          ws.send('PONG :tmi.twitch.tv');
          continue;
        }

        let tags = {};
        let remaining = line;

        if (remaining.startsWith('@')) {
          const spaceIndex = remaining.indexOf(' ');
          const tagsStr = remaining.substring(1, spaceIndex);
          remaining = remaining.substring(spaceIndex + 1);

          tagsStr.split(';').forEach(tag => {
            const [key, value] = tag.split('=');
            tags[key] = value;
          });
        }

        const parts = remaining.split(' ');
        const source = parts[0];
        const command = parts[1];
        const channel = parts[2];

        // Join channel only after successfully authenticating
        if (command === '001' || command === '376') {
          ws.send(`JOIN #${TARGET_CHANNEL.toLowerCase()}`);
          console.log(`* Authentication successful! Joining #${TARGET_CHANNEL}...`);
        }

        if (command === 'PRIVMSG') {
          const messageText = parts.slice(3).join(' ').substring(1);
          const chatterName = tags['display-name'] ? tags['display-name'].toLowerCase() : source.split('!')[0].substring(1).toLowerCase();
          const isSub = tags['subscriber'] === '1' || (tags['badges'] && tags['badges'].includes('founder'));
          
          const subRewardAmt = parseInt(globalConfig['reward_chat_sub'] || '750', 10);
          const nonsubRewardAmt = parseInt(globalConfig['reward_chat_nonsub'] || '500', 10);
          const pointReward = isSub ? subRewardAmt : nonsubRewardAmt;
          const bits = parseInt(tags['bits']) || 0;
          if (bits > 0) {
            console.log(`[BITS EVENT DETECTED] Raw tags:`, JSON.stringify(tags));
          }

          if (bits > 0 && chatterName && !ignoredBots.includes(chatterName)) {
            const pointsPerBit = parseInt(globalConfig['reward_bits'] || '10', 10);
            const pointsToAward = bits * pointsPerBit;
            if (db) {
              const finalAwarded = await addPointsWithBonus(chatterName, pointsToAward);
              console.log(`* [POINTS] Awarded ${finalAwarded} points to ${chatterName} for cheering ${bits} bits!`);
              await sendChatMessage(`🎉 ${chatterName} cheered ${bits} bits! You received ${finalAwarded} points! 🎉`);
              setTimeout(async () => {
                await triggerRandomRaffle('bit cheer');
              }, 3000);
            }
          }

          if (db && chatterName && !ignoredBots.includes(chatterName)) {
            const now = Date.now();
            let user = await db.get('SELECT last_message_time FROM users WHERE username = ?', chatterName);
            const isLive = await isStreamerLive();

            let pending = pendingActivityUpdates.get(chatterName);
            let lastMsgTime = pending && pending.lastMessageTime ? pending.lastMessageTime : (user ? user.last_message_time : 0);
            
            if (!user && !pending) {
              pendingActivityUpdates.set(chatterName, {
                isNew: true,
                pointsReward: isLive ? pointReward : 0,
                lastMessageTime: now,
                trueLastChatTime: now,
                awardedPoints: true
              });
            } else {
              let record = pending || { isNew: false, pointsReward: 0, awardedPoints: false, lastMessageTime: lastMsgTime };
              record.trueLastChatTime = now;
              
              const chatCdMins = parseInt(globalConfig['reward_chat_cooldown'] || '25', 10);
              if (now - lastMsgTime >= chatCdMins * 60 * 1000) {
                record.lastMessageTime = now;
                if (isLive) {
                  record.pointsReward += pointReward;
                  record.awardedPoints = true;
                }
              }
              pendingActivityUpdates.set(chatterName, record);
            }
          }

          let event = {
            chatter_user_login: chatterName,
            badges: tags['badges'] ? tags['badges'].split(',').map(b => {
              const [set_id, id] = b.split('/');
              return { set_id, id };
            }) : [],
            message: {
              text: messageText,
              fragments: buildFragmentsFromIrc(messageText, tags['emotes'])
            },
            message_id: tags['id']
          };

          let chatText = event.message.text.trim();

          // --- COMMAND LOGIC START ---
     
          if (ignoredBots.includes(chatterName.toLowerCase())) {
            return;
          }

          if (activeChatWar) {
            const words = chatText.split(' ');
            const isVote1 = words.includes(activeChatWar.emote1);
            const isVote2 = words.includes(activeChatWar.emote2);
            if (isVote1 || isVote2) {
              const choice = isVote1 ? activeChatWar.emote1 : activeChatWar.emote2;
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              
              if (activeChatWar && user && user.points >= activeChatWar.cost) {
                if (!activeChatWar.userVotes[chatterName]) {
                  activeChatWar.userVotes[chatterName] = { choice, spent: 0 };
                }
                   
                if (activeChatWar.userVotes[chatterName].choice === choice) {
                  await db.run('UPDATE users SET points = points - ? WHERE username = ?', [activeChatWar.cost, chatterName]);
                  
                  if (activeChatWar) {
                    activeChatWar.userVotes[chatterName].spent += activeChatWar.cost;
                    activeChatWar.totalPool += activeChatWar.cost;
                    if (choice === activeChatWar.emote1) activeChatWar.score1++;
                    else activeChatWar.score2++;
                        
                    broadcastChatWarState(activeChatWar);
                  }
                }
              }
            }
          }

          let args = chatText.split(' ').filter(arg => arg.trim() !== '');
          if (args.length === 0) return;
          let commandName = args.shift().toLowerCase();
          
          if (builtInAliases[commandName]) {
            commandName = builtInAliases[commandName];
          }

          // Global disable check
          const disabledUntilRaw = globalConfig[`cmd_${commandName}_disabled_until`];
          if (disabledUntilRaw) {
            if (disabledUntilRaw === 'forever' || Date.now() < parseInt(disabledUntilRaw, 10)) {
              return;
            }
          }

          // Global sub-only check
          const isSubOnly = globalConfig[`cmd_${commandName}_sub_only`] === 'true';
          if (isSubOnly) {
            const isSubOrMod = event.badges && event.badges.some(b => ['broadcaster', 'moderator', 'subscriber', 'founder'].includes(b.set_id)) || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
            if (!isSubOrMod) {
              return;
            }
          }
          
          if (customAliasesMap.has(commandName)) {
            const alias = customAliasesMap.get(commandName);
            if (alias.cost > 0) {
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              if (!user || user.points < alias.cost) {
                console.log(`[COMMAND] ${chatterName} tried to use alias ${commandName} but lacks points.`);
                return;
              }
              await db.run('UPDATE users SET points = points - ? WHERE username = ?', [alias.cost, chatterName]);
            }

            if (alias.action.startsWith('!')) {
              chatText = alias.action;
              args = chatText.split(' ');
              commandName = args.shift().toLowerCase();
              

              event = {
                ...event,
                message: {
                  ...event.message,
                  text: chatText,
                  fragments: chatText.split(' ').map(word => ({ type: 'text', text: word + ' ' }))
                }
              };

              // Re-check disable for the new resolved command
              const newDisabledUntilRaw = globalConfig[`cmd_${commandName}_disabled_until`];
              if (newDisabledUntilRaw) {
                if (newDisabledUntilRaw === 'forever' || Date.now() < parseInt(newDisabledUntilRaw, 10)) {
                  return;
                }
              }

              // Re-check sub-only for the new resolved command
              const newIsSubOnly = globalConfig[`cmd_${commandName}_sub_only`] === 'true';
              if (newIsSubOnly) {
                const isSubOrMod = event.badges && event.badges.some(b => ['broadcaster', 'moderator', 'subscriber', 'founder'].includes(b.set_id)) || chatterName === TARGET_CHANNEL || chatterName === 'aurorynaru';
                if (!isSubOrMod) {
                  return;
                }
              }
            } else {
              await sendChatMessage(alias.action);
              return;
            }
          }
       
          if (customCommands[commandName]) {

            const command = customCommands[commandName];
            
            const dynamicCostRaw = globalConfig[`cmd_${commandName}_cost`];
            const activeCost = dynamicCostRaw !== undefined ? parseInt(dynamicCostRaw, 10) : command.cost;

            if (activeCost > 0 && !command.manualCost) {
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              if (!user || user.points < activeCost) {
                console.log(`[COMMAND] ${chatterName} tried to use ${commandName} but lacks points.`);
                return;
              }
              await db.run('UPDATE users SET points = points - ? WHERE username = ?', [activeCost, chatterName]);
            }

            const hasPermission = event.badges && event.badges.some(b => ['broadcaster', 'moderator'].includes(b.set_id)) || chatterName == "aurorynaru";
            const isMod = hasPermission || chatterName === TARGET_CHANNEL || chatterName == "aurorynaru";

            if (!isMod) {
              const now = Date.now();
              
              const chatWideCdRaw = globalConfig['chat_wide_cooldown'];
              const chatWideCd = chatWideCdRaw !== undefined ? parseInt(chatWideCdRaw, 10) : 1500;
              
              if (now - lastChatWideCommandTime < chatWideCd) {
                console.log(`[RATE LIMIT] Chat-wide cooldown active. Ignoring command from ${chatterName}.`);
                return;
              }

              const globalCdRaw = globalConfig['cmd_!global_cooldown'];
              const globalCd = globalCdRaw !== undefined ? parseInt(globalCdRaw, 10) : COMMAND_COOLDOWN;
              const lastGlobalTime = userCooldowns.get(chatterName) || 0;
              
              if (now - lastGlobalTime < globalCd) {
                console.log(`[COOLDOWN] ${chatterName} is on global cooldown.`);
                return;
              }

              const cmdCdRaw = globalConfig[`cmd_${commandName}_cooldown`];
              const cmdCd = cmdCdRaw !== undefined ? parseInt(cmdCdRaw, 10) : 0;
              
              if (cmdCd > 0) {
                const lastCmdTime = commandCooldowns.get(`${chatterName}_${commandName}`) || 0;
                if (now - lastCmdTime < cmdCd) {
                  console.log(`[COOLDOWN] ${chatterName} is on command cooldown for ${commandName}.`);
                  return;
                }
                commandCooldowns.set(`${chatterName}_${commandName}`, now);
              }

              const globalCmdCdRaw = globalConfig[`cmd_${commandName}_global_chat_cooldown`];
              const globalCmdCd = globalCmdCdRaw !== undefined ? parseInt(globalCmdCdRaw, 10) : 0;
              
              if (globalCmdCd > 0) {
                const lastGlobalCmdTime = commandCooldowns.get(`GLOBAL_${commandName}`) || 0;
                if (now - lastGlobalCmdTime < globalCmdCd) {
                  console.log(`[RATE LIMIT] ${commandName} is on global chat cooldown.`);
                  return;
                }
                commandCooldowns.set(`GLOBAL_${commandName}`, now);
              }

              userCooldowns.set(chatterName, now);
              lastChatWideCommandTime = now;
            }
            
            await command.execute(args, chatterName, event, hasPermission);
            return;
          }

 
          if (chatText.toLowerCase().startsWith('!showemote ')) {
            // if (!await isStreamerLive()) return;

            const hasPermission = event.badges && event.badges.some(b => ['broadcaster', 'moderator'].includes(b.set_id));
            const isMod = hasPermission || chatterName === TARGET_CHANNEL;

            if (!isMod) {
              const now = Date.now();
              
              const chatWideCdRaw = globalConfig['chat_wide_cooldown'];
              const chatWideCd = chatWideCdRaw !== undefined ? parseInt(chatWideCdRaw, 10) : 1500;
              
              if (now - lastChatWideCommandTime < chatWideCd) {
                console.log(`[RATE LIMIT] Chat-wide cooldown active. Ignoring !showemote from ${chatterName}.`);
                return;
              }

              const globalCdRaw = globalConfig['cmd_!global_cooldown'];
              const globalCd = globalCdRaw !== undefined ? parseInt(globalCdRaw, 10) : COMMAND_COOLDOWN;
              const lastGlobalTime = userCooldowns.get(chatterName) || 0;
              
              if (now - lastGlobalTime < globalCd) {
                console.log(`[COOLDOWN] ${chatterName} is on global cooldown.`);
                return;
              }

              const cmdCdRaw = globalConfig[`cmd_!showemote_cooldown`];
              const cmdCd = cmdCdRaw !== undefined ? parseInt(cmdCdRaw, 10) : 0;
              
              if (cmdCd > 0) {
                const lastCmdTime = commandCooldowns.get(`${chatterName}_!showemote`) || 0;
                if (now - lastCmdTime < cmdCd) {
                  console.log(`[COOLDOWN] ${chatterName} is on command cooldown for !showemote.`);
                  return;
                }
                commandCooldowns.set(`${chatterName}_!showemote`, now);
              }

              const globalCmdCdRaw = globalConfig[`cmd_!showemote_global_chat_cooldown`];
              const globalCmdCd = globalCmdCdRaw !== undefined ? parseInt(globalCmdCdRaw, 10) : 0;
              
              if (globalCmdCd > 0) {
                const lastGlobalCmdTime = commandCooldowns.get(`GLOBAL_!showemote`) || 0;
                if (now - lastGlobalCmdTime < globalCmdCd) {
                  console.log(`[RATE LIMIT] !showemote is on global chat cooldown.`);
                  return;
                }
                commandCooldowns.set(`GLOBAL_!showemote`, now);
              }

              userCooldowns.set(chatterName, now);
              lastChatWideCommandTime = now;
            }
        
            const tokens = [];
            let currentEmoteGroup = [];
            const validModifiers = ['wide', 'cursed', 'flipx', 'flipy', 'bounce', 'leave', 'arrive', 'jam', 'rainbow', 'hyper'];

            event.message.fragments.forEach(fragment => {
              if (fragment.type === 'emote') {
                const disabledRaw = globalConfig[`disabled_emote_${fragment.text}`];
                if (disabledRaw === 'true' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw))) {
                  console.log(`[SHOWEMOTE] Emote ${fragment.text} is disabled.`);
                  return;
                }
                const twitchEmoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emote.id}/default/dark/3.0`;
                const token = { type: 'emote', url: twitchEmoteUrl, isZeroWidth: false, modifiers: [], original: `Twitch Emote: ${twitchEmoteUrl}` };
                tokens.push(token);
                currentEmoteGroup = [token];
              } else if (fragment.type === 'text') {
                const words = fragment.text.split(' ');
                words.forEach(word => {
                  const lowerWord = word.toLowerCase();
                  if (thirdPartyEmotes.has(word)) {
                    const disabledRaw = globalConfig[`disabled_emote_${word}`];
                    if (disabledRaw === 'true' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw))) {
                      console.log(`[SHOWEMOTE] Emote ${word} is disabled.`);
                      return;
                    }
                    const emoteData = thirdPartyEmotes.get(word);
                    const token = { type: 'emote', url: emoteData.url, isZeroWidth: emoteData.isZeroWidth, modifiers: [], original: `3rd-Party Emote: ${emoteData.url}` };
                    tokens.push(token);
                    if (emoteData.isZeroWidth) {
                      currentEmoteGroup.push(token);
                    } else {
                      currentEmoteGroup = [token];
                    }
                  } else if (validModifiers.includes(lowerWord) && currentEmoteGroup.length > 0) {
                    const disabledRaw = globalConfig[`disabled_mod_${lowerWord}`];
                    if (disabledRaw === 'true' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw))) {
                      console.log(`[SHOWEMOTE] Modifier ${lowerWord} is disabled.`);
                    } else {
                      currentEmoteGroup.forEach(t => {
                        if (!t.modifiers.includes(lowerWord)) t.modifiers.push(lowerWord);
                      });
                    }
                  } else if (word.trim() !== '') {
                    tokens.push({ type: 'text', text: word, original: word });
                    currentEmoteGroup = [];
                  }
                });
              } else if (fragment.type === 'mention') {
                tokens.push({ type: 'text', text: `${fragment.mention.user_name}` , original: `@${fragment.mention.user_name}` });
                currentEmoteGroup = [];
              }
            });

            const hasAnyEmote = tokens.some(t => t.type === 'emote');
            if (!hasAnyEmote) {
              return;
            }

            const dynamicShowEmoteCost = parseInt(globalConfig['cmd_!showemote_cost'], 10) || 0;
            
            let hasBaseEmote = false;
            let broadcastTokens = [];

            for (let i = 0; i < tokens.length; i++) {
              const current = tokens[i];
              if (current.type === 'emote') {
                let shouldBroadcast = true;
                if (!current.isZeroWidth) {
                  if (hasBaseEmote) {
                    shouldBroadcast = false;
                  } else {
                    hasBaseEmote = true;
                  }
                }
                if (shouldBroadcast) {
                  broadcastTokens.push({ token: current, originalIndex: i });
                }
              }
            }

            let uniqueModifiers = new Set();
            broadcastTokens.forEach(b => {
              if (b.token.modifiers) {
                b.token.modifiers.forEach(mod => uniqueModifiers.add(mod));
              }
            });

            let modifierCost = 0;
            uniqueModifiers.forEach(mod => {
              modifierCost += parseInt(globalConfig[`mod_${mod}_cost`], 10) || 0;
            });

            const totalCost = dynamicShowEmoteCost + modifierCost;

            if (dynamicShowEmoteCost > 0 || modifierCost > 0) {
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              const userPoints = user ? user.points : 0;

              if (userPoints < dynamicShowEmoteCost) {
                console.log(`[COMMAND] ${chatterName} tried to use !showemote but lacks base points.`);
                return;
              }

              let finalCost = dynamicShowEmoteCost;
              if (userPoints >= totalCost) {
                finalCost = totalCost;
              } else {
                console.log(`[COMMAND] ${chatterName} cannot afford modifiers. Dropping modifiers.`);
                broadcastTokens.forEach(b => {
                  b.token.modifiers = [];
                });
              }

              if (finalCost > 0) {
                await db.run('UPDATE users SET points = points - ? WHERE username = ?', [finalCost, chatterName]);
              }
            }
  
            for (let b of broadcastTokens) {
              const current = b.token;
              const i = b.originalIndex;
              let customX = null;
              let customY = null;

              if (i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                const match = tokens[i + 1].text.match(/^(\d+),(\d+)$/);
                if (match) {
                  customX = parseInt(match[1], 10);
                  customY = parseInt(match[2], 10);
                }
              }

              broadcastEmote(current.url, current.isZeroWidth, event.message_id, customX, customY, current.modifiers || []);
            }
          
            // --- COMMAND LOGIC END ---
          }
        } else if (command === 'USERNOTICE') {
            const chatterName = tags['display-name'] ? tags['display-name'].toLowerCase() : (tags['login'] || '').toLowerCase();
            const msgId = tags['msg-id'];
            
            console.log(`[USERNOTICE DETECTED] MsgId: ${msgId}, Chatter: ${chatterName}, Raw Tags:`, JSON.stringify(tags));
          
            if (msgId === 'sub' || msgId === 'resub') {
              if (db && chatterName) {
                const subReward = parseInt(globalConfig['reward_sub'] || '5000', 10);
                const finalAwarded = await addPointsWithBonus(chatterName, subReward);
                console.log(`* [POINTS] Awarded ${finalAwarded} points to ${chatterName} for subscribing!`);
                await sendChatMessage(`🎉 ${chatterName} subscribed! You received ${finalAwarded} points! 🎉`);
                setTimeout(async () => {
                  await triggerRandomRaffle('subscription');
                }, 3000);
              }
            } else if (msgId === 'submysterygift') {
              if (db && chatterName) {
                const baseReward = parseInt(globalConfig['reward_giftsub'] || '5000', 10);
                const scalingBonus = parseInt(globalConfig['reward_giftsub_scaling'] || '10', 10);
                const maxCap = parseInt(globalConfig['reward_giftsub_cap'] || '100000', 10);
                const totalGifts = parseInt(tags['msg-param-mass-gift-count'], 10) || 1;
                const giftReward = Math.min(maxCap, baseReward + Math.round((totalGifts * totalGifts) * scalingBonus));
                const finalAwarded = await addPointsWithBonus(chatterName, giftReward);
                console.log(`* [POINTS] Awarded ${finalAwarded} points to ${chatterName} for gifting ${totalGifts} sub(s)!`);
                await sendChatMessage(`🎉 ${chatterName} gifted ${totalGifts} sub(s)! You were awarded ${finalAwarded} points! 🎉`);
                setTimeout(async () => {
                  await triggerRandomRaffle('gift sub');
                }, 3000);
              }
            } else if (msgId === 'subgift') {

              if (db && chatterName && !tags['msg-param-communitygift-id']) {
                const baseReward = parseInt(globalConfig['reward_giftsub'] || '5000', 10);
                const scalingBonus = parseInt(globalConfig['reward_giftsub_scaling'] || '10', 10);
                const maxCap = parseInt(globalConfig['reward_giftsub_cap'] || '100000', 10);
                const totalGifts = 1;
                const giftReward = Math.min(maxCap, baseReward + Math.round((totalGifts * totalGifts / 3) * scalingBonus));
                const finalAwarded = await addPointsWithBonus(chatterName, giftReward);
                console.log(`* [POINTS] Awarded ${finalAwarded} points to ${chatterName} for gifting a direct sub!`);
                await sendChatMessage(`🎉 ${chatterName} gifted a sub! You were awarded ${finalAwarded} points! 🎉`);
                setTimeout(async () => {
                  await triggerRandomRaffle('gift sub');
                }, 3000);
              }
            } else if (msgId === 'viewermilestone') {
              if (tags['msg-param-category'] === 'watch-streak') {
                const streak = parseInt(tags['msg-param-value'], 10) || 0;
                if (streak > 0 && db && chatterName) {
                  const baseRate = parseInt(globalConfig['reward_watchstreak'] || '1000', 10);
                  const scalingBonus = parseInt(globalConfig['reward_watchstreak_scaling'] || '20', 10);
                  const maxCap = parseInt(globalConfig['reward_watchstreak_cap'] || '100000', 10);
                  const reward = Math.min(maxCap, baseRate + Math.round((streak * streak / 3) * scalingBonus));
                  
                  const finalAwarded = await addPointsWithBonus(chatterName, reward);
                  console.log(`* [POINTS] Awarded ${finalAwarded} points to ${chatterName} for a ${streak} watch streak!`);
                  await sendChatMessage(`🔥 ${chatterName} is on a ${streak} stream watch streak! They were awarded ${finalAwarded} points! 🔥`);
                }
              }
            }
          } else if (command === 'CAP') {
            console.log(`[CAPABILITY RESPONSE] ${line}`);
          } else if (command !== 'PONG' && command !== '353' && command !== '366' && command !== '001' && command !== '002' && command !== '003' && command !== '004' && command !== '375' && command !== '372' && command !== '376' && command !== 'JOIN' && command !== 'PART' && command !== 'ROOMSTATE' && command !== 'USERSTATE' && command !== 'GLOBALUSERSTATE') {
            console.log(`[UNHANDLED IRC COMMAND] Command: ${command}, Line: ${line}`);
          }
      }
    });

    ws.on('close', () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      console.log('* Disconnected from Twitch IRC WebSocket');
      if (ws === activeWs && !isReconnecting) {
        console.log('! Connection dropped unexpectedly! Reconnecting in 5 seconds...');
        setTimeout(() => connectTwitch(), 5000);
      }
    });

    activeWs = ws;
  }

  connectTwitch();
}

start();

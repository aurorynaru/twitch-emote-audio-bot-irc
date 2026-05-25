import WebSocket from 'ws';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import cors from 'cors';
import { ZipArchive } from 'archiver';
dotenv.config({override:true});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const AUTH_CODE = process.env.AUTH_CODE
const TARGET_CHANNEL = process.env.TARGET_CHANNEL;
let USER_ACCESS_TOKEN = '';
let BOT_USERNAME = ''
const TOKEN_FILE = path.join(__dirname, 'tokens.json');
let COMMAND_COOLDOWN=process.env.COMMAND_COOLDOWN || 1000

const DB_PATH = path.join(__dirname, 'data', 'database.sqlite');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(path.join(__dirname, 'data', 'playsounds'))) {
  fs.mkdirSync(path.join(__dirname, 'data', 'playsounds'));
}

const globalConfig = {};
const customAliasesMap = new Map();

const commandConfigSchema = {
  '!playsound': ['cost', 'cooldown'],
  '!showemote': ['cost', 'duration', 'size', 'cooldown'],
  '!betstart': ['cost', 'cooldown'],
  '!betstop': ['cost', 'cooldown'],
  '!betstatus': ['cost', 'cooldown'],
  '!points': ['cost', 'cooldown'],
  '!editcommand': ['cost', 'cooldown'],
  '!gamble': ['cost', 'cooldown'],
  '!refreshemotes': ['cost', 'cooldown'],
  '!addcommand': ['cost', 'cooldown'],
  '!removecommand': ['cost', 'cooldown'],
  '!commandlist': ['cost', 'cooldown'],
  '!chatwar': ['cost', 'cooldown'],
  '!chatwarcancel': ['cost', 'cooldown'],
  '!global': ['cooldown'],
  '!duel': ['cooldown'],
  '!acceptduel': ['cooldown'],
  '!declineduel': ['cooldown']
};

const activeDuels = new Map();

const duelWinMessages = [
  "{winner} absolutely destroyed {loser} and took their {amount} points!",
  "{winner} styled on {loser} and walked away with {amount} points!",
  "{loser} tripped on a rock, giving {winner} an easy {amount} points victory!",
  "It was a close battle, but {winner} came out on top against {loser} for {amount} points!"
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
  } catch (err) {
    // ignore
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

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

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'data', 'playsounds'))
  },
  filename: function (req, file, cb) {

    const originalExt = path.extname(file.originalname).toLowerCase();
    const baseName = path.basename(file.originalname, originalExt).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    cb(null, baseName + originalExt);
  }
});
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (!name.endsWith('.ogg') && !name.endsWith('.mp3')) {
      return cb(null, false);
    }
    cb(null, true);
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/playsounds', express.static(path.join(__dirname, 'data', 'playsounds')));


function adminAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
   const user = process.env.ADMIN_USER
  if (!password) {
    return res.status(401).send('Admin access disabled. Please set ADMIN_PASSWORD in your environment variables.');
  }

  const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
  const [login, pwd] = Buffer.from(b64auth, 'base64').toString().split(':');

  if (login === user && pwd === password) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
  res.status(401).send('Authentication required.');
}

app.get('/addsound', adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'addsound.html'));
});

app.post('/api/upload-sound', adminAuth, upload.array('soundFiles', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded or files were not .ogg or .mp3!' });
  }
  res.json({ success: true, filenames: req.files.map(f => f.filename) });
});

app.get('/api/config', (req, res) => {
  res.json({
    durationMs: parseInt(globalConfig['cmd_!showemote_duration']) || parseInt(process.env.EMOTE_DURATION_MS) || 5000,
    sizePx: parseInt(globalConfig['cmd_!showemote_size']) || parseInt(process.env.EMOTE_SIZE_PX) || 150
  });
});

let sseClients = [];

app.get('/api/stream-emotes', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


app.get('/api/dashboard-data', (req, res) => {
  try {
    const defaultSettingsFallback = {
      '!showemote': { cost: 0, duration: parseInt(process.env.EMOTE_DURATION_MS) || 5000, size: parseInt(process.env.EMOTE_SIZE_PX) || 150, cooldown: 0 },
      '!playsound': { cost: parseInt(process.env.DEFAULT_PLAYSOUND_COST) || 0, cooldown: 0 },
      '!global': { cooldown: parseInt(process.env.COMMAND_COOLDOWN) || 1000 }
    };

    // 1. Default Commands
    const defaultCommands = Object.keys(commandConfigSchema).map(cmd => {
      return {
        command: cmd,
        settings: commandConfigSchema[cmd].reduce((acc, setting) => {
           let val = globalConfig[`cmd_${cmd}_${setting}`];
           if (val === undefined) {
             if (defaultSettingsFallback[cmd] && defaultSettingsFallback[cmd][setting] !== undefined) {
               val = defaultSettingsFallback[cmd][setting];
             } else {
               val = 0;
             }
           }
           acc[setting] = val;
           return acc;
        }, {})
      };
    });


    const customCommands = [];
    customAliasesMap.forEach((data, cmd) => {
      customCommands.push({
        command: cmd,
        action: data.action,
        cost: data.cost
      });
    });


    const soundsDir = path.join(__dirname, 'data', 'playsounds');
    let sounds = [];
    if (fs.existsSync(soundsDir)) {
      sounds = fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.ogg'));
    }

    res.json({
      success: true,
      defaultCommands,
      customCommands,
      sounds
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.get('/export-database', adminAuth, (req, res) => {
  const dbPath = path.join(__dirname, 'data', 'database.sqlite');
  if (fs.existsSync(dbPath)) {

    res.download(dbPath, `database_backup_${Date.now()}.sqlite`);
  } else {
    res.status(404).send('Database not found!');
  }
});

app.get('/export-playsounds', adminAuth, (req, res) => {
  const soundsDir = path.join(__dirname, 'data', 'playsounds');
  if (!fs.existsSync(soundsDir)) {
    return res.status(404).send('Playsounds directory not found!');
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=playsounds_backup_${Date.now()}.zip`);

  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  archive.on('error', function(err) {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);
  archive.directory(soundsDir, false);
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`* Emote Overlay Server running on port ${PORT}!`);
  console.log(`* OBS Users: Add Browser Source: http://localhost:${PORT}/overlay`);
  console.log(`==================================================\n`);
});

function broadcastEmote(url, isZeroWidth = false, messageId = null, customX = null, customY = null) {
  const payload = `data: ${JSON.stringify({ type: 'emote', url, isZeroWidth, messageId, customX, customY })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function broadcastAudio(filename) {
  const payload = `data: ${JSON.stringify({ type: 'audio', file: filename })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function broadcastConfig() {
  const duration = parseInt(globalConfig['cmd_!showemote_duration']) || parseInt(process.env.EMOTE_DURATION_MS) || 5000;
  const size = parseInt(globalConfig['cmd_!showemote_size']) || parseInt(process.env.EMOTE_SIZE_PX) || 150;
  const payload = `data: ${JSON.stringify({ type: 'config_update', durationMs: duration, sizePx: size })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function broadcastBetState(bet) {
  if (!bet) return;
  const payloadData = {
    description: bet.description,
    isOpen: bet.isOpen,
    totalPool: bet.totalPool,
    endTime: bet.endTime || null,
    durationMs: bet.durationMs || null,
    choices: []
  };

  bet.choices.forEach(choice => {
    const pool = bet.pools[choice] || 0;
    const odds = pool > 0 ? (bet.totalPool / pool).toFixed(2) : '?';
    
    let usersCount = 0;
    let topBettorName = 'N/A';
    let topBetAmount = 0;
    
    for (const [user, userBet] of Object.entries(bet.userBets)) {
      if (userBet.choice === choice) {
        usersCount++;
        if (userBet.amount > topBetAmount) {
          topBetAmount = userBet.amount;
          topBettorName = user;
        }
      }
    }

    const percentage = bet.totalPool > 0 ? Math.round((pool / bet.totalPool) * 100) : 50;

    payloadData.choices.push({
      name: choice,
      totalPoints: pool,
      ratio: odds,
      usersCount,
      topBetAmount,
      topBettorName,
      percentage
    });
  });

  const payload = `data: ${JSON.stringify({ type: 'bet_update', bet: payloadData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function clearBetState(resultData = null) {
  const payload = `data: ${JSON.stringify({ type: 'bet_clear', result: resultData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function broadcastChatWarState(war) {
  if (!war) return;
  const payloadData = {
    emote1: war.emote1,
    emote2: war.emote2,
    emoteUrl1: war.emoteUrl1,
    emoteUrl2: war.emoteUrl2,
    cost: war.cost,
    score1: war.score1,
    score2: war.score2,
    endTime: war.endTime || null,
    durationMs: war.durationMs || null
  };
  const payload = `data: ${JSON.stringify({ type: 'chatwar_update', war: payloadData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

function clearChatWarState(winnerData = null) {
  const payload = `data: ${JSON.stringify({ type: 'chatwar_clear', winner: winnerData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}



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
  console.log('* SQLite Database Initialized!');

  try {
    USER_ACCESS_TOKEN = await getValidAccessToken();
  } catch (err) {
    console.error('\n! Authentication Error:', err.message);
    console.error('! Did you forget to paste your CLIENT_SECRET or AUTH_CODE?\n');
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


  async function sendChatMessage(messageText) {
    try {
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

  const parseTime = (timeStr) => {
    if (!timeStr) return 5 * 60 * 1000; 
    const match = timeStr.match(/^(\d+)([smh])$/);
    if (!match) return 5 * 60 * 1000;
    const val = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    return 5 * 60 * 1000;
  };

  const parseFlexibleTime = (timeStr) => {
    if (/^\d+$/.test(timeStr)) return parseInt(timeStr, 10);
    const match = timeStr.match(/^(\d+)([smh])$/i);
    if (!match) return NaN;
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 's') return val * 1000;
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 60 * 60 * 1000;
    return NaN;
  };

  const parseAmount = (amountStr) => {
    if (!amountStr) return NaN;
    amountStr = amountStr.toLowerCase();
    
    let multiplier = 1;
    if (amountStr.endsWith('k')) multiplier = 1000;
    else if (amountStr.endsWith('m')) multiplier = 1000000;
    else if (amountStr.endsWith('b')) multiplier = 1000000000;

    if (multiplier !== 1) {
      amountStr = amountStr.slice(0, -1);
    }
    
    const val = parseFloat(amountStr);
    return isNaN(val) ? NaN : Math.floor(val * multiplier);
  };

  // --- COMMANDS LIST ---
  const customCommands = {
    '!points': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        let targetUser = chatterName;
        if (args.length > 0) {
          targetUser = args[0].replace('@', '').toLowerCase();
        }

        const user = await db.get('SELECT points FROM users WHERE username = ?', targetUser);
        if (!user) {
          await sendChatMessage(`${targetUser} has not typed yet in this chat!`);
          return;
        }

        const points = user.points;

        if (targetUser === chatterName) {
          await sendChatMessage(`${chatterName}, you have ${points} points!`);
        } else {
          await sendChatMessage(`${targetUser} has ${points} points!`);
        }
      }
    },
    '!playsound': {
      cost: 1,
      execute: async (args, chatterName, event, hasPermission) => {
        // if (!await isStreamerLive()) return;
        args = [args[0]]
        const dynamicCostRaw = globalConfig['cmd_!playsound_cost'];
        const activeCost = dynamicCostRaw !== undefined ? parseInt(dynamicCostRaw, 10) : 1;

        const filename = args.join('').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
        if (filename) {
          const oggPath = path.join(__dirname, 'data', 'playsounds', filename + '.ogg');
          const mp3Path = path.join(__dirname, 'data', 'playsounds', filename + '.mp3');
          
          if (fs.existsSync(oggPath) || fs.existsSync(mp3Path)) {
            if (fs.existsSync(oggPath)) {
              broadcastAudio(filename + '.ogg');
              console.log(`[PLAYSOUND] ${chatterName} played audio: ${filename}.ogg (-${activeCost} point(s))`);
            } else {
              broadcastAudio(filename + '.mp3');
              console.log(`[PLAYSOUND] ${chatterName} played audio: ${filename}.mp3 (-${activeCost} point(s))`);
            }
          } else {
            console.log(`[PLAYSOUND] Audio not found for: ${filename}`);
            if (activeCost > 0) {
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [activeCost, chatterName]);
            }
          }
        } else {
          if (activeCost > 0) {
            await db.run('UPDATE users SET points = points + ? WHERE username = ?', [activeCost, chatterName]);
          }
        }
      }
    },
    '!refreshemotes': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (hasPermission) {
          if (Date.now() - lastRefreshTime > REFRESH_COOLDOWN_MS) {
            lastRefreshTime = Date.now();
            console.log(`\n* [COMMAND] ${chatterName} triggered !refreshemotes. Reloading all emotes...`);
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
            await sendChatMessage(`${chatterName} set emote size to ${newSize}.`);
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
          await sendChatMessage(`@${chatterName}, invalid command! Try !givepoints 50 username or !givepoints 50 username1 username2`);
          return;
        }

        const amountInput = args[0].toLowerCase();
        const targetUsers = args.slice(1).map(u => u.replace('@', '').toLowerCase());

        for (const target of targetUsers) {
          const tUser = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (!tUser) {
            await sendChatMessage(`${target} has not typed yet in this chat!`);
            return;
          }
        }

        let totalAmountToDeduct = 0;
        let amountPerUser = 0;

        const isMod = hasPermission || chatterName === TARGET_CHANNEL;

        if (!isMod) {
          const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
          if (!user || user.points <= 0) {
            await sendChatMessage(`@${chatterName}, you don't have any points!`);
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
            await sendChatMessage(`@${chatterName}, invalid amount!`);
            return;
          }

          amountPerUser = Math.floor(totalAmountToDeduct / targetUsers.length);
          if (amountPerUser <= 0) {
            await sendChatMessage(`@${chatterName}, the amount is too small to split!`);
            return;
          }
          
          const actualDeduction = amountPerUser * targetUsers.length;
          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [actualDeduction, chatterName]);

        } else {

          totalAmountToDeduct = parseAmount(amountInput);
          if (isNaN(totalAmountToDeduct) || totalAmountToDeduct <= 0) {
            await sendChatMessage(`@${chatterName}, invalid amount!`);
            return;
          }
          amountPerUser = totalAmountToDeduct; 
        }

        for (const target of targetUsers) {
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [amountPerUser, target]);
        }

        await sendChatMessage(`@${chatterName} gave ${amountPerUser} points to: ${targetUsers.join(', ')}`);
      }
    },
    '!removepoints': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          await sendChatMessage(`@${chatterName}, you do not have permission to remove points!`);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`@${chatterName}, invalid command! Try !removepoints 50 username`);
          return;
        }

        const amountInput = args[0].toLowerCase();
        const targetUsers = args.slice(1).map(u => u.replace('@', '').toLowerCase());
        
        const amountToDeduct = parseAmount(amountInput);
        if (isNaN(amountToDeduct) || amountToDeduct <= 0) {
          await sendChatMessage(`@${chatterName}, invalid amount!`);
          return;
        }

        for (const target of targetUsers) {
          const tUser = await db.get('SELECT points FROM users WHERE username = ?', target);
          if (!tUser) {
            await sendChatMessage(`${target} has not typed yet in this chat!`);
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

        await sendChatMessage(`@${chatterName} removed ${amountToDeduct} points from: ${targetUsers.join(', ')}`);
      }
    },
    '!masspointsadd': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (chatterName !== TARGET_CHANNEL) {
          await sendChatMessage(`@${chatterName}, you do not have permission to mass add points!`);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`@${chatterName}, invalid command! Try !masspointsadd 1000 10m`);
          return;
        }

        const amount = parseAmount(args[0]);
        if (isNaN(amount) || amount <= 0) {
          await sendChatMessage(`@${chatterName}, invalid amount!`);
          return;
        }

        const timeStr = args[1] ? args[1].toLowerCase() : '5m';
        const durationMs = parseTime(timeStr);
        const threshold = Date.now() - durationMs;

        await db.run('UPDATE users SET points = points + ? WHERE true_last_chat_time >= ?', [amount, threshold]);
        await sendChatMessage(`${TARGET_CHANNEL} mass added ${amount} points to everyone who chatted in the last ${timeStr}!`);
      }
    },
    '!masspointssub': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (chatterName !== TARGET_CHANNEL) {
          await sendChatMessage(`@${chatterName}, you do not have permission to mass sub points!`);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`@${chatterName}, invalid command! Try !masspointssub 1000 10m`);
          return;
        }

        const amount = parseAmount(args[0]);
        if (isNaN(amount) || amount <= 0) {
          await sendChatMessage(`@${chatterName}, invalid amount!`);
          return;
        }

        const timeStr = args[1] ? args[1].toLowerCase() : '5m';
        const durationMs = parseTime(timeStr);
        const threshold = Date.now() - durationMs;

        await db.run('UPDATE users SET points = MAX(0, points - ?) WHERE true_last_chat_time >= ?', [amount, threshold]);
        await sendChatMessage(`${TARGET_CHANNEL} mass removed ${amount} points from everyone who chatted in the last ${timeStr}!`);
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
            await sendChatMessage(`${chatterName} set emote duration to ${newDuration} seconds.`);
          } else {
            console.log(`\n${chatterName} invalid value: ${newDuration}. ex. !emoteduration 10`);
            await sendChatMessage(`Invalid value. Ex: !emoteduration 10`);
          }
        }
      }
    },
    '!duel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (args.length < 2) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !duel <@user> <amount>`);
          return;
        }

        const targetRaw = args[0];
        const target = targetRaw.startsWith('@') ? targetRaw.slice(1).toLowerCase() : targetRaw.toLowerCase();

        if (target === chatterName) {
          await sendChatMessage(`@${chatterName}, you cannot duel yourself!`);
          return;
        }

        const amountInput = args[1].toLowerCase();
        let betAmount = 0;

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`@${chatterName}, you don't have enough points to duel!`);
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
          await sendChatMessage(`@${chatterName}, invalid amount!`);
          return;
        }

        if (activeDuels.has(target)) {
          await sendChatMessage(`@${chatterName}, ${target} already has a pending duel!`);
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
              const msg = duelTimeoutMessages[Math.floor(Math.random() * duelTimeoutMessages.length)]
                .replace('{target}', `@${target}`)
                .replace('{challenger}', `@${chatterName}`);
              await sendChatMessage(msg);
            }
          }
        }, 60000);

        activeDuels.set(target, {
          challenger: chatterName,
          target: target,
          amount: betAmount,
          timeoutId: timeoutId
        });

        await sendChatMessage(`@${target}, you have been challenged to a duel by @${chatterName} for ${betAmount} points! Type !acceptduel within 60s to accept!`);
      }
    },
    '!acceptduel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!activeDuels.has(chatterName)) {
          await sendChatMessage(`@${chatterName}, you have no pending duel requests!`);
          return;
        }

        const duel = activeDuels.get(chatterName);
        clearTimeout(duel.timeoutId);
        activeDuels.delete(chatterName);

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points < duel.amount) {
          // Refund challenger
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [duel.amount, duel.challenger]);
          const msg = duelBrokeMessages[Math.floor(Math.random() * duelBrokeMessages.length)]
            .replace(/{target}/g, `@${chatterName}`)
            .replace(/{challenger}/g, `@${duel.challenger}`)
            .replace(/{amount}/g, duel.amount);
          await sendChatMessage(msg);
          return;
        }

        // Deduct from target
        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [duel.amount, chatterName]);

        const challengerWins = Math.random() < 0.5;
        const winner = challengerWins ? duel.challenger : chatterName;
        const loser = challengerWins ? chatterName : duel.challenger;
        const reward = duel.amount * 2;

        await db.run('UPDATE users SET points = points + ? WHERE username = ?', [reward, winner]);

        const msg = duelWinMessages[Math.floor(Math.random() * duelWinMessages.length)]
          .replace(/{winner}/g, `@${winner}`)
          .replace(/{loser}/g, `@${loser}`)
          .replace(/{amount}/g, reward);
        
        await sendChatMessage(msg);
      }
    },
    '!declineduel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        if (!activeDuels.has(chatterName)) {
          await sendChatMessage(`@${chatterName}, you have no pending duel requests to decline!`);
          return;
        }

        const duel = activeDuels.get(chatterName);
        clearTimeout(duel.timeoutId);
        activeDuels.delete(chatterName);


        await db.run('UPDATE users SET points = points + ? WHERE username = ?', [duel.amount, duel.challenger]);
        
        await sendChatMessage(`@${chatterName} has declined the duel from @${duel.challenger}! Points refunded.`);
      }
    },
    '!gamble': {
      cost: 0, 
      execute: async (args, chatterName, event, hasPermission) => {
        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`${chatterName}, you don't have any points to gamble!`);
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
          await sendChatMessage(`${chatterName}, invalid amount! Try !gamble 50, !gamble 50%, or !gamble all`);
          return;
        }

        
        const isWin = Math.random() < 0.5;

        if (isWin) {
          await db.run('UPDATE users SET points = points + ? WHERE username = ?', [betAmount, chatterName]);
          const newPoints = user.points + betAmount;
          await sendChatMessage(`${chatterName} won ${betAmount} points in a gamble! You now have ${newPoints} points.`);
        } else {
          await db.run('UPDATE users SET points = points - ? WHERE username = ?', [betAmount, chatterName]);
          const newPoints = user.points - betAmount;
          await sendChatMessage(`${chatterName} lost ${betAmount} points in a gamble... You now have ${newPoints} points.`);
        }
      }
    },
    '!chatwar': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          await sendChatMessage(`@${chatterName}, you do not have permission to start chat wars!`);
          return;
        }

        if (activeChatWar) {
          await sendChatMessage(`@${chatterName}, a chat war is already active!`);
          return;
        }

        if (args.length < 4) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !chatwar <emote1> <emote2> <cost> <time> (ex: !chatwar CoolCat OhMyDog 100 1m)`);
          return;
        }

        const emote1 = args[0];
        const emote2 = args[1];
        const cost = parseInt(args[2], 10);
        const durationStr = args[3];
        
        if (isNaN(cost) || cost < 0) {
           await sendChatMessage(`@${chatterName}, invalid cost!`);
           return;
        }

        const durationMs = parseFlexibleTime(durationStr);
        if (isNaN(durationMs) || durationMs <= 0) {
           await sendChatMessage(`@${chatterName}, invalid time format! Use 10s, 1m, 1h.`);
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
  if (data.choice === winningEmote) {
    const payout = Math.floor((data.spent / winningPool) * totalPool);
    const profit = payout - data.spent;

    await db.run(
      'UPDATE users SET points = points + ? WHERE username = ?',
      [payout, user]
    );

    winnersCount++;
    winners.push({ user, won: profit });
  } else {
    losers.push({ user, lost: data.spent });
  }
}

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

        await sendChatMessage(messages.join('\n'));
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
                await sendChatMessage(`Reminder: Chat War (${emote1} vs ${emote2}) closes in ${r.msg}! Spam your emote to fight! (Cost: ${cost} pts per vote)`);
              }
            }, delay);
            activeChatWar.reminderTimeouts.push(tid);
          }
        }

        await sendChatMessage(`⚔️ CHAT WAR STARTED: ${emote1} vs ${emote2}! Type your emote to fight! Each vote costs ${cost} points. War ends in ${durationStr}.`);
      }
    },
    '!chatwarcancel': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          await sendChatMessage(`@${chatterName}, you do not have permission to cancel chat wars!`);
          return;
        }

        if (!activeChatWar) {
          await sendChatMessage(`@${chatterName}, there is no active chat war!`);
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
    '!betstart': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          await sendChatMessage(`@${chatterName}, you do not have permission to start bets!`);
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
            await sendChatMessage(`@${chatterName}, invalid format! Use: !betstart "Will we win?" "yes,no" 5m`);
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
            await sendChatMessage(`@${chatterName}, invalid format! Make sure choices are separated by a comma (ex: yes,no). Example: !betstart test yes,no 1m`);
            return;
          }
        }

        if (choicesRaw.length < 2) {
          await sendChatMessage(`@${chatterName}, you need at least 2 choices separated by commas!`);
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
          await sendChatMessage(`@${chatterName}, you do not have permission to stop bets!`);
          return;
        }

        const bet = activeBets.get('default');
        if (!bet) {
          await sendChatMessage(`@${chatterName}, there is no active bet!`);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`@${chatterName}, please specify the winning choice! Example: !betstop yes`);
          return;
        }

        const winningChoice = args[0].toLowerCase();
        if (!bet.choices.includes(winningChoice)) {
          await sendChatMessage(`@${chatterName}, invalid choice! Valid choices are: ${bet.choices.join(', ')}`);
          return;
        }

        bet.isOpen = false;
        if (bet.timeoutId) clearTimeout(bet.timeoutId);
        if (bet.reminderTimeouts) bet.reminderTimeouts.forEach(clearTimeout);

        const totalPool = bet.totalPool;
        const winningPool = bet.pools[winningChoice];

        if (winningPool === 0) {
          await sendChatMessage(`BET RESOLVED: "${bet.description}" won by ${winningChoice}. Nobody voted for the winner! House takes the pool (${totalPool} pts)`);
          activeBets.delete('default');
          clearBetState(null);
        } else {
          let winnersCount = 0;
          const winners = [];
          const losers = [];
          
          for (const [user, userBet] of Object.entries(bet.userBets)) {
            if (userBet.choice === winningChoice) {
              const payout = Math.floor((userBet.amount / winningPool) * totalPool);
              const profit = payout - userBet.amount;
              await db.run('UPDATE users SET points = points + ? WHERE username = ?', [payout, user]);
              winnersCount++;
              winners.push({ user, amount: userBet.amount, won: profit });
            } else {
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

        await sendChatMessage(messages.join('\n')); 
          
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
          await sendChatMessage(`@${chatterName}, you do not have permission to cancel bets!`);
          return;
        }

        const bet = activeBets.get('default');
        if (!bet) {
          await sendChatMessage(`@${chatterName}, there is no active bet!`);
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
          await sendChatMessage(`@${chatterName}, there is no active bet right now!`);
          return;
        }
        if (!bet.isOpen) {
          await sendChatMessage(`@${chatterName}, betting is closed for the current bet!`);
          return;
        }

        if (bet.userBets[chatterName]) {
          await sendChatMessage(`@${chatterName}, you have already bet ${bet.userBets[chatterName].amount} on [${bet.userBets[chatterName].choice}]!`);
          return;
        }

        if (args.length < 2) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !bet <choice> <amount>`);
          return;
        }

        const choice = args[0].toLowerCase();
        if (!bet.choices.includes(choice)) {
          await sendChatMessage(`@${chatterName}, invalid choice! Valid choices are: ${bet.choices.join(', ')}`);
          return;
        }

        const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
        if (!user || user.points <= 0) {
          await sendChatMessage(`@${chatterName}, you don't have enough points!`);
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
          await sendChatMessage(`@${chatterName}, invalid amount!`);
          return;
        }

        await db.run('UPDATE users SET points = points - ? WHERE username = ?', [betAmount, chatterName]);
        
        bet.userBets[chatterName] = { choice, amount: betAmount };
        bet.pools[choice] += betAmount;
        bet.totalPool += betAmount;

        broadcastBetState(bet);
        await sendChatMessage(`@${chatterName} bet ${betAmount} on ${choice}!`);
      }
    },
    '!betstatus': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const bet = activeBets.get('default');
        if (!bet) {
          await sendChatMessage(`There is no active bet right now!`);
          return;
        }

        const ratioTexts = bet.choices.map(choice => {
          const pool = bet.pools[choice];
          const odds = pool > 0 ? (bet.totalPool / pool).toFixed(2) : '?';
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
          await sendChatMessage(`@${chatterName}, you do not have permission to edit commands!`);
          return;
        }

        if (args.length < 3) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !editcommand <command> <setting> <value>`);
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
                await sendChatMessage(`@${chatterName}, invalid cost! It must be a number >= 0.`);
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
                await sendChatMessage(`@${chatterName}, invalid cooldown time! Use ms (1000), or 10s, 5m, 1h.`);
                return;
              }
              const configKey = `cmd_${targetCmd}_cooldown`;
              await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, cdVal, cdVal]);
              globalConfig[configKey] = cdVal;
              await sendChatMessage(`Successfully updated custom command ${targetCmd} cooldown to ${cdVal} ms!`);
              return;
            }
          }
          await sendChatMessage(`@${chatterName}, unknown command: ${targetCmd}`);
          return;
        }

        if (!validSettings.includes(setting)) {
          await sendChatMessage(`@${chatterName}, invalid setting! ${targetCmd} only supports changing: ${validSettings.join(', ')}`);
          return;
        }

        let finalValue = value;
        if (setting === 'cooldown' || setting === 'duration') {
          const parsedTime = parseFlexibleTime(value);
          if (isNaN(parsedTime) || parsedTime < 0) {
            await sendChatMessage(`@${chatterName}, invalid ${setting} time! Use ms (1000), or 10s, 5m, 1h.`);
            return;
          }
          finalValue = parsedTime.toString();
        }

        const configKey = `cmd_${targetCmd}_${setting}`;
        
        await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [configKey, finalValue, finalValue]);
        
        globalConfig[configKey] = finalValue;

        if (targetCmd === '!showemote' && (setting === 'duration' || setting === 'size')) {
          broadcastConfig();
        }

        await sendChatMessage(`Successfully updated ${targetCmd} ${setting} to ${finalValue}!`);
      }
    },
    '!addcommand': {
      cost: 0,
      execute: async (args, chatterName, event, hasPermission) => {
        const isMod = hasPermission || chatterName === TARGET_CHANNEL;
        if (!isMod) {
          await sendChatMessage(`@${chatterName}, you do not have permission to add commands!`);
          return;
        }

        if (args.length < 3) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !addcommand <!command> <cost> <action>`);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!cmdName.startsWith('!')) {
          await sendChatMessage(`@${chatterName}, the command must start with a ! (e.g. !mycmd)`);
          return;
        }
        
        if (customCommands[cmdName] || cmdName === '!showemote') {
          await sendChatMessage(`@${chatterName}, you cannot overwrite a built-in command!`);
          return;
        }

        const cost = parseInt(args[1], 10);
        if (isNaN(cost) || cost < 0) {
          await sendChatMessage(`@${chatterName}, invalid cost! It must be a number >= 0.`);
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
          await sendChatMessage(`@${chatterName}, you do not have permission to delete commands!`);
          return;
        }

        if (args.length < 1) {
          await sendChatMessage(`@${chatterName}, invalid format! Use: !removecommand <!command>`);
          return;
        }

        const cmdName = args[0].toLowerCase();
        if (!customAliasesMap.has(cmdName)) {
          await sendChatMessage(`@${chatterName}, command ${cmdName} does not exist!`);
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
    }
  };

  let isStreamLiveCached = false;
  let lastStreamCheckTime = 0;

  async function isStreamerLive() {
    if (Date.now() - lastStreamCheckTime < 10000) {
      return isStreamLiveCached;
    }
    try {
      const res = await fetch(`https://api.twitch.tv/helix/streams?user_id=${BROADCASTER_USER_ID}`, {
        headers: { 'Authorization': `Bearer ${USER_ACCESS_TOKEN}`, 'Client-Id': CLIENT_ID }
      });
      const data = await res.json();
      if (data && data.data) {
        isStreamLiveCached = data.data.length > 0;
        lastStreamCheckTime = Date.now();
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
  const activeBets = new Map();
  let activeChatWar = null;

  function connectTwitch() {
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    let isReconnecting = false;

    ws.on('open', () => {
      console.log(`* Connected to Twitch IRC at ${TARGET_CHANNEL}...`);
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send(`PASS oauth:${USER_ACCESS_TOKEN}`);
      ws.send(`NICK ${BOT_USERNAME}`);
      ws.send(`JOIN #${TARGET_CHANNEL.toLowerCase()}`);
    });

    ws.on('message', async (data) => {
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

        if (command === 'PRIVMSG') {
          const messageText = parts.slice(3).join(' ').substring(1);
          const chatterName = tags['display-name'] ? tags['display-name'].toLowerCase() : source.split('!')[0].substring(1).toLowerCase();
          const isSub = tags['subscriber'] === '1' || (tags['badges'] && tags['badges'].includes('founder'));
          const pointReward = isSub ? 750 : 500;
          const bits = parseInt(tags['bits']) || 0;

          if (bits > 0) {
            const pointsToAward = bits * 10;
            if (db && chatterName) {
              await db.run('INSERT INTO users (username, points) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET points = points + ?', [chatterName, pointsToAward, pointsToAward]);
              console.log(`* [POINTS] Awarded ${pointsToAward} points to ${chatterName} for cheering ${bits} bits!`);
            }
          }

          if (db) {
            const now = Date.now();
            const user = await db.get('SELECT * FROM users WHERE username = ?', chatterName);
            // const isLive = await isStreamerLive();
            const isLive = true

            if (!user) {
              await db.run('INSERT INTO users (username, points, last_message_time, true_last_chat_time) VALUES (?, ?, ?, ?)', [chatterName, isLive ? pointReward : 0, now, now]);
            } else {
              if (now - user.last_message_time >= 5 * 60 * 1000) {
                if (isLive) {
                  await db.run('UPDATE users SET points = points + ?, last_message_time = ?, true_last_chat_time = ? WHERE username = ?', [pointReward, now, now, chatterName]);
                } else {
                  await db.run('UPDATE users SET last_message_time = ?, true_last_chat_time = ? WHERE username = ?', [now, now, chatterName]);
                }
              } else {
                await db.run('UPDATE users SET true_last_chat_time = ? WHERE username = ?', [now, chatterName]);
              }
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
          const ignoredBots = ['admiralclanker', 'moobot', 'streamelements'];
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
              if (user && user.points >= activeChatWar.cost) {
                if (!activeChatWar.userVotes[chatterName]) {
                  activeChatWar.userVotes[chatterName] = { choice, spent: 0 };
                }
                   
                if (activeChatWar.userVotes[chatterName].choice === choice) {
                  await db.run('UPDATE users SET points = points - ? WHERE username = ?', [activeChatWar.cost, chatterName]);
                  activeChatWar.userVotes[chatterName].spent += activeChatWar.cost;
                  activeChatWar.totalPool += activeChatWar.cost;
                  if (choice === activeChatWar.emote1) activeChatWar.score1++;
                  else activeChatWar.score2++;
                      
                  broadcastChatWarState(activeChatWar);
                }
              }
            }
          }

          let args = chatText.split(' ');
          let commandName = args.shift().toLowerCase();
          
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
            } else {
              await sendChatMessage(alias.action);
              return;
            }
          }
       
          if (customCommands[commandName]) {
            const command = customCommands[commandName];
            
            const dynamicCostRaw = globalConfig[`cmd_${commandName}_cost`];
            const activeCost = dynamicCostRaw !== undefined ? parseInt(dynamicCostRaw, 10) : command.cost;

            if (activeCost > 0) {
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              if (!user || user.points < activeCost) {
                console.log(`[COMMAND] ${chatterName} tried to use ${commandName} but lacks points.`);
                return;
              }
              await db.run('UPDATE users SET points = points - ? WHERE username = ?', [activeCost, chatterName]);
            }

            const hasPermission = event.badges && event.badges.some(b => ['broadcaster', 'moderator', 'vip'].includes(b.set_id));
            const isMod = hasPermission || chatterName === TARGET_CHANNEL;

            if (!isMod) {
              const now = Date.now();
              
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

              userCooldowns.set(chatterName, now);
            }
            
            await command.execute(args, chatterName, event, hasPermission);
            return;
          }

 
          if (chatText.toLowerCase().startsWith('!showemote ')) {
            // if (!await isStreamerLive()) return;

            const hasPermission = event.badges && event.badges.some(b => ['broadcaster', 'moderator', 'vip'].includes(b.set_id));
            const isMod = hasPermission || chatterName === TARGET_CHANNEL;

            if (!isMod) {
              const now = Date.now();
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

              userCooldowns.set(chatterName, now);
            }

            const dynamicShowEmoteCost = parseInt(globalConfig['cmd_!showemote_cost'], 10) || 0;
            if (dynamicShowEmoteCost > 0) {
              const user = await db.get('SELECT points FROM users WHERE username = ?', chatterName);
              if (!user || user.points < dynamicShowEmoteCost) {
                console.log(`[COMMAND] ${chatterName} tried to use !showemote but lacks points.`);
                return;
              }
              await db.run('UPDATE users SET points = points - ? WHERE username = ?', [dynamicShowEmoteCost, chatterName]);
            }

            let parsedMessageParts = [];
  
            const tokens = [];
            event.message.fragments.forEach(fragment => {
              if (fragment.type === 'emote') {
                const twitchEmoteUrl = `https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emote.id}/default/dark/3.0`;
                tokens.push({ type: 'emote', url: twitchEmoteUrl, isZeroWidth: false, original: `Twitch Emote: ${twitchEmoteUrl}` });
              } else if (fragment.type === 'text') {
                const words = fragment.text.split(' ');
                words.forEach(word => {
                  if (thirdPartyEmotes.has(word)) {
                    const emoteData = thirdPartyEmotes.get(word);
                    tokens.push({ type: 'emote', url: emoteData.url, isZeroWidth: emoteData.isZeroWidth, original: `3rd-Party Emote: ${emoteData.url}` });
                  } else if (word.trim() !== '') {
                    tokens.push({ type: 'text', text: word, original: word });
                  }
                });
              } else if (fragment.type === 'mention') {
                tokens.push({ type: 'text', text: `@${fragment.mention.user_name}`, original: `@${fragment.mention.user_name}` });
              }
            });
  
            let hasBaseEmote = false;
  
            for (let i = 0; i < tokens.length; i++) {
              const current = tokens[i];
  
              if (current.type === 'emote') {
                let customX = null;
                let customY = null;
  
                if (i + 1 < tokens.length && tokens[i + 1].type === 'text') {
                  const match = tokens[i + 1].text.match(/^(\d+),(\d+)$/);
                  if (match) {
                    customX = parseInt(match[1], 10);
                    customY = parseInt(match[2], 10);
                    i++;
                    parsedMessageParts.push(`{${current.original} AT ${customX}%,${customY}%}`);
                  } else {
                    parsedMessageParts.push(`{${current.original}}`);
                  }
                } else {
                  parsedMessageParts.push(`{${current.original}}`);
                }
  
                let shouldBroadcast = true;
                if (!current.isZeroWidth) {
                  if (hasBaseEmote) {
                    shouldBroadcast = false;
                  } else {
                    hasBaseEmote = true;
                  }
                }
  
                if (shouldBroadcast) {
                  broadcastEmote(current.url, current.isZeroWidth, event.message_id, customX, customY);
                }
  
              } else if (current.type === 'text') {
                parsedMessageParts.push(current.original);
              }
            }
            if (!hasBaseEmote && parsedMessageParts.length > 0) {
              broadcastEmote(parsedMessageParts[0], true, event.message_id);
            }
          
            // --- COMMAND LOGIC END ---
          } else if (command === 'USERNOTICE') {
            const chatterName = tags['display-name'] ? tags['display-name'].toLowerCase() : (tags['login'] || '').toLowerCase();
            const msgId = tags['msg-id'];
          
            if (msgId === 'sub' || msgId === 'resub') {
              if (db && chatterName) {
                await db.run('INSERT INTO users (username, points) VALUES (?, 5000) ON CONFLICT(username) DO UPDATE SET points = points + 5000', [chatterName]);
                console.log(`* [POINTS] Awarded 5000 points to ${chatterName} for subscribing!`);
              }
            } else if (msgId === 'subgift') {
              if (db && chatterName) {
                await db.run('INSERT INTO users (username, points) VALUES (?, 5000) ON CONFLICT(username) DO UPDATE SET points = points + 5000', [chatterName]);
                console.log(`* [POINTS] Awarded 5000 points to ${chatterName} for gifting sub(s)!`);
              }
            }
          }
        }
      }
    });

    ws.on('close', () => {
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

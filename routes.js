import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';
import multer from 'multer';
import { adminAuth } from './utils.js';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let sseClients = [];

export function setupRoutes(app, {
  db,
  globalConfig,
  customAliasesMap,
  commandConfigSchema
}) {
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
        const files = fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.ogg'));
        sounds = files.map(f => {
          const stats = fs.statSync(path.join(soundsDir, f));
          return { filename: f, uploadedAt: stats.mtimeMs };
        });
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
}

export function broadcastEmote(url, isZeroWidth = false, messageId = null, customX = null, customY = null) {
  const payload = `data: ${JSON.stringify({ type: 'emote', url, isZeroWidth, messageId, customX, customY })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastAudio(filename) {
  const payload = `data: ${JSON.stringify({ type: 'audio', file: filename })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastConfig(globalConfig) {
  const duration = parseInt(globalConfig['cmd_!showemote_duration']) || parseInt(process.env.EMOTE_DURATION_MS) || 5000;
  const size = parseInt(globalConfig['cmd_!showemote_size']) || parseInt(process.env.EMOTE_SIZE_PX) || 150;
  const payload = `data: ${JSON.stringify({ type: 'config_update', durationMs: duration, sizePx: size })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastBetState(bet) {
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

export function clearBetState(resultData = null) {
  const payload = `data: ${JSON.stringify({ type: 'bet_clear', result: resultData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastChatWarState(war) {
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

export function clearChatWarState(winnerData = null) {
  const payload = `data: ${JSON.stringify({ type: 'chatwar_clear', winner: winnerData })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import { ZipArchive } from 'archiver';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { exec } from 'child_process';
import express from 'express';
import crypto from 'crypto';
import { parseTime } from './utils.js';
import dotenv from 'dotenv';
import { normalizeAudio } from './normalize_all_sounds.js';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export let sseClients = [];

export function setupRoutes(app, {
  getDb,
  globalConfig,
  customAliasesMap,
  commandConfigSchema,
  FISHING_ITEMS,
  FISHING_RARITIES,
  swapDatabase,
  clearOverlaySystem,
  loadItemsConfig
}) {

  const adminAuth = async (req, res, next) => {
    const password = process.env.ADMIN_PASSWORD;
    const user = process.env.ADMIN_USER;

    if (!password) {
      return res.status(401).send('Admin access disabled. Please set ADMIN_PASSWORD in your environment variables.');
    }

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, pwd] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login === user && pwd === password) {
      req.adminUser = { username: login, permissions: ["all"] };
      return next();
    }

    if (login && pwd) {
      try {
        const db = getDb();
        const subAdmin = await db.get('SELECT * FROM admin_users WHERE username = ?', [login]);
        if (subAdmin) {
          const hash = crypto.scryptSync(pwd, subAdmin.salt, 64).toString('hex');
          if (hash === subAdmin.password_hash) {
            req.adminUser = { username: login, permissions: JSON.parse(subAdmin.permissions || '[]') };
            return next();
          }
        }
      } catch (err) {
        console.error('Error checking sub-admin auth:', err);
      }
    }

    console.log(`[adminAuth] Failed auth for ${req.method} ${req.url} - login=${login} pwd=${pwd ? '***' : 'none'}`);
    res.set('WWW-Authenticate', 'Basic realm="Admin Panel"');
    res.status(401).send('Authentication required.');
  };

  const requirePermission = (permission) => {
    return (req, res, next) => {
      if (req.adminUser.permissions.includes('all') || req.adminUser.permissions.includes(permission)) {
        return next();
      }
      return res.status(403).json({ success: false, error: 'Forbidden: Insufficient permissions' });
    };
  };

  const headAdminOnly = (req, res, next) => {
    if (req.adminUser.permissions.includes('all')) {
      return next();
    }
    return res.status(403).json({ success: false, error: 'Forbidden: Head admin only' });
  };

  const logAudit = async (admin_username, action_type, target_entity, old_value, new_value) => {
    try {
      const db = getDb();
      await db.run(
        'INSERT INTO audit_logs (admin_username, action_type, target_entity, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
        [admin_username, action_type, target_entity, old_value, new_value]
      );
    } catch (e) {
      console.error('Failed to write audit log:', e);
    }
  };

  // --- Admin User Management (Head Admin Only) ---
  app.get('/api/admin/me', adminAuth, (req, res) => {
    res.json({ success: true, user: req.adminUser });
  });

  app.get('/api/admin/audit', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const logs = await db.all('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200');
      res.json({ success: true, logs });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.get('/api/admin/subadmins', adminAuth, headAdminOnly, async (req, res) => {
    try {
      const db = getDb();
      const admins = await db.all('SELECT username, permissions, created_at FROM admin_users');
      res.json({ success: true, admins: admins.map(a => ({ ...a, permissions: JSON.parse(a.permissions || '[]') })) });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.post('/api/admin/subadmins', adminAuth, headAdminOnly, express.json(), async (req, res) => {
    try {
      const { username, password, permissions } = req.body;
      if (!username || !password) return res.status(400).json({ success: false, error: 'Username and password required' });
      const db = getDb();
      const existing = await db.get('SELECT username FROM admin_users WHERE username = ?', [username]);
      if (existing) return res.status(400).json({ success: false, error: 'Username already exists' });
      
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      
      await db.run('INSERT INTO admin_users (username, password_hash, salt, permissions) VALUES (?, ?, ?, ?)', [
        username, hash, salt, JSON.stringify(permissions || [])
      ]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'create_subadmin', username, '', JSON.stringify(permissions || []));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.put('/api/admin/subadmins/:username', adminAuth, headAdminOnly, express.json(), async (req, res) => {
    try {
      const { username } = req.params;
      const { password, permissions } = req.body;
      const db = getDb();
      const existing = await db.get('SELECT * FROM admin_users WHERE username = ?', [username]);
      if (!existing) return res.status(404).json({ success: false, error: 'User not found' });
      
      if (password && password.trim() !== '') {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.scryptSync(password, salt, 64).toString('hex');
        await db.run('UPDATE admin_users SET password_hash = ?, salt = ?, permissions = ? WHERE username = ?', [
          hash, salt, JSON.stringify(permissions || []), username
        ]);
      } else {
        await db.run('UPDATE admin_users SET permissions = ? WHERE username = ?', [
          JSON.stringify(permissions || []), username
        ]);
      }
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'update_subadmin', username, existing.permissions, JSON.stringify(permissions || []));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  app.delete('/api/admin/subadmins/:username', adminAuth, headAdminOnly, async (req, res) => {
    try {
      const db = getDb();
      await db.run('DELETE FROM admin_users WHERE username = ?', [req.params.username]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_subadmin', req.params.username, '', '');
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

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
      if (!name.endsWith('.ogg') && !name.endsWith('.mp3') && !name.endsWith('.zip')) {
        return cb(null, false);
      }
      cb(null, true);
    }
  });

  const dbStorage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, path.join(__dirname, 'data'))
    },
    filename: function (req, file, cb) {
      cb(null, 'database_staging.sqlite');
    }
  });

  const dbUpload = multer({
    storage: dbStorage,
    fileFilter: (req, file, cb) => {
      const name = file.originalname.toLowerCase();
      if (!name.endsWith('.sqlite') && !name.endsWith('.db')) {
        return cb(null, false);
      }
      cb(null, true);
    }
  });

  app.get('/addsound', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'addsound.html'));
  });

  app.get('/upload-database', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'upload-database.html'));
  });

  app.post('/api/upload-sound', adminAuth, upload.array('soundFiles', 50), async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded or files were not .ogg, .mp3, or .zip!' });
    }
    const finalFilenames = [];
    for (const file of req.files) {
      if (file.filename.endsWith('.zip')) {
        try {
          const zip = new AdmZip(file.path);
          const zipEntries = zip.getEntries();
          for (const zipEntry of zipEntries) {
             const name = zipEntry.entryName.toLowerCase();
             if (!zipEntry.isDirectory && (name.endsWith('.mp3') || name.endsWith('.ogg'))) {
                const outPath = path.join(__dirname, 'data', 'playsounds', path.basename(zipEntry.entryName));
                fs.writeFileSync(outPath, zipEntry.getData());
                await normalizeAudio(outPath);
                finalFilenames.push(path.basename(zipEntry.entryName));
             }
          }
          fs.unlinkSync(file.path);
        } catch (e) {
          console.error("Failed to extract zip", e);
        }
      } else {
        await normalizeAudio(file.path);
        finalFilenames.push(file.filename);
      }
    }
    res.json({ success: true, filenames: finalFilenames });
  });

  app.post('/api/upload-database', adminAuth, dbUpload.single('database'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No valid database file uploaded!' });
    }
    try {
      if (swapDatabase) {
         await swapDatabase();
      }
      res.json({ success: true, message: 'Database successfully replaced and reloaded.' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: 'Error swapping database: ' + e.message });
    }
  });

  app.get('/admin-dashboard', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
  });

  app.get('/admin-dashboard.html', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
  });

  app.get('/api/admin/config', adminAuth, (req, res) => {
    res.json({
      success: true,
      globalConfig,
      commandConfigSchema
    });
  });

  app.post('/api/admin/config', adminAuth, express.json(), async (req, res) => {
    try {
      const updates = req.body.updates;
      if (!Array.isArray(updates)) {
         return res.status(400).json({ success: false, error: 'Invalid payload' });
      }

      const db = getDb();
      for (const update of updates) {
        if (!update.key) continue;
        const val = update.value == null ? '' : String(update.value);
        const oldVal = globalConfig[update.key];
        if (String(oldVal || '') !== val) {
          await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [update.key, val, val]);
          globalConfig[update.key] = val;
          await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'update_config', update.key, String(oldVal || ''), val);
        }
      }
      
      broadcastConfig(globalConfig);
      res.json({ success: true });
    } catch (e) {
      console.error('Error updating config from dashboard:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/config/client_id', (req, res) => {
    res.json({ success: true, client_id: process.env.CLIENT_ID });
  });

  app.post('/api/auth/verify', express.json(), async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ success: false, error: 'No token provided' });
      
      const response = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${token}` }
      });
      const data = await response.json();
      
      if (!response.ok || !data.login) {
        return res.status(401).json({ success: false, error: 'Invalid token' });
      }
      
      res.json({ success: true, username: data.login, user_id: data.user_id });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/submissions', express.json(), async (req, res) => {
    try {
      const { token, type, content, answer } = req.body;
      if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const authRes = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${token}` }
      });
      const authData = await authRes.json();
      if (!authRes.ok || !authData.login) return res.status(401).json({ success: false, error: 'Invalid token' });

      const username = authData.login;
      const db = getDb();
      
      // We will store both playsounds and trivia in user_submissions initially for admin review
      const submissionContent = type === 'trivia' ? JSON.stringify({ question: content, answer }) : content;

      await db.run('INSERT INTO user_submissions (username, type, content) VALUES (?, ?, ?)', [username, type, submissionContent]);
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/user/submissions', express.json(), async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

      const authRes = await fetch('https://id.twitch.tv/oauth2/validate', {
        headers: { 'Authorization': `OAuth ${token}` }
      });
      const authData = await authRes.json();
      if (!authRes.ok || !authData.login) return res.status(401).json({ success: false, error: 'Invalid token' });

      const db = getDb();
      const submissions = await db.all('SELECT * FROM user_submissions WHERE username = ? ORDER BY created_at DESC', [authData.login]);
      res.json({ success: true, submissions });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/submissions', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const status = req.query.status || 'pending';
      const order = status === 'pending' ? 'ASC' : 'DESC';
      const submissions = await db.all(`SELECT * FROM user_submissions WHERE status = ? ORDER BY created_at ${order}`, [status]);
      res.json({ success: true, submissions });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/categories/:type', async (req, res) => {
    try {
      const type = req.params.type;
      const db = getDb();
      const categories = await db.all('SELECT name FROM categories WHERE type = ?', [type]);
      res.json({ success: true, categories: categories.map(c => c.name) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/admin/submissions/:id', adminAuth, express.json(), async (req, res) => {
    try {
      const id = req.params.id;
      const { content } = req.body;
      const db = getDb();
      const sub = await db.get('SELECT * FROM user_submissions WHERE id = ?', [id]);
      if (!sub) return res.status(404).json({ success: false, error: 'Not found' });
      await db.run('UPDATE user_submissions SET content = ? WHERE id = ?', [content, id]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'edit_submission', 'Submission ID: ' + id, sub.content, content);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/submissions/:id/review', adminAuth, express.json(), async (req, res) => {
    try {
      const { status, action } = req.body;
      const finalStatus = status || (action === 'approve' ? 'approved' : 'rejected');
      const id = req.params.id;
      const db = getDb();
      const reviewer = req.adminUser ? req.adminUser.username : 'admin';
      
      const sub = await db.get('SELECT * FROM user_submissions WHERE id = ?', [id]);
      if (!sub) return res.status(404).json({ success: false, error: 'Not found' });

      await db.run('UPDATE user_submissions SET status = ?, reviewer = ? WHERE id = ?', [finalStatus, reviewer, id]);
      await logAudit(reviewer, 'review_submission', `Submission ID: ${id} (${sub.type})`, sub.status, finalStatus);

      if (finalStatus === 'approved') {
        if (sub.type === 'trivia') {
          let q = '';
          let a = sub.answer;
          let h = null;
          let cats = [];

          try {
            const parsed = JSON.parse(sub.content);
            q = parsed.question;
            h = parsed.hint || null;
            if (parsed.answer) a = parsed.answer;
            if (parsed.categories) cats = parsed.categories;

            // Handle buggy older double-encoded JSON submissions
            try {
              const inner = JSON.parse(parsed.question);
              if (inner.question) q = inner.question;
              if (inner.hint) h = inner.hint || null;
              if (inner.categories) cats = inner.categories || [];
            } catch (e) {}
          } catch (e) {
            q = sub.content;
          }

          cats = cats.map(c => typeof c === 'string' ? c.toLowerCase() : c);
          const catsStr = JSON.stringify(cats);
          await db.run('INSERT INTO trivia_questions (question, answer, hint, submitter, categories, submission_id) VALUES (?, ?, ?, ?, ?, ?)', [q, a, h, sub.username, catsStr, id]);
          
          for (const c of cats) {
            await db.run('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)', [c, 'trivia']);
          }
        } else if (sub.type === 'playsound') {
          // Playsounds will be added manually via the addsound endpoint.
          // Save metadata
          let nameMatch = sub.content.match(/^Command Name:\s*!playsound\s+(.+)$/m);
          let linkMatch = sub.content.match(/^Link:\s*(.+)$/m);
          let descMatch = sub.content.match(/^Description:\s*([\s\S]*?)(?:\nCategories:|$)/m);
          let catsMatch = sub.content.match(/^Categories:\s*(.+)$/m);
          
          let name = nameMatch ? nameMatch[1].trim() : `playsound_${Date.now()}`;
          let link = linkMatch ? linkMatch[1].trim() : '';
          let desc = descMatch ? descMatch[1].trim() : '';
          let cats = catsMatch ? catsMatch[1].split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
          
          if (action === 'approve') {
            if (!link) return res.status(400).json({ success: false, error: 'No link found in submission.' });
            
            const linkLower = link.toLowerCase();
            if (!linkLower.includes('nuuls.com')) {
              return res.status(400).json({ success: false, error: 'Only nuuls.com links are allowed.' });
            }
            if (!linkLower.endsWith('.mp3') && !linkLower.endsWith('.ogg')) {
              return res.status(400).json({ success: false, error: 'The link must end with .mp3 or .ogg' });
            }
            
            const ext = linkLower.endsWith('.ogg') ? '.ogg' : '.mp3';
            const filePath = path.join(__dirname, 'data', 'playsounds', `${name}${ext}`);
            
            try {
              const response = await fetch(link);
              if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
              
              const fileStream = fs.createWriteStream(filePath);
              await new Promise((resolve, reject) => {
                 Readable.fromWeb(response.body).pipe(fileStream)
                   .on('finish', resolve)
                   .on('error', reject);
              });
              
              await normalizeAudio(filePath);
            } catch (err) {
              return res.status(500).json({ success: false, error: `Failed to download audio file: ${err.message}` });
            }
          }
          
          await db.run('INSERT INTO playsounds_metadata (name, description, submitter, categories, submission_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = ?, submitter = ?, categories = ?, submission_id = ?', 
            [name, desc, sub.username, JSON.stringify(cats), id, desc, sub.username, JSON.stringify(cats), id]);
            
          for (const c of cats) {
            await db.run('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)', [c, 'playsound']);
          }
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });


  app.get('/api/admin/custom-commands', adminAuth, (req, res) => {
    const commands = [];
    for (const [cmd, details] of customAliasesMap.entries()) {
      commands.push({ command: cmd, cost: details.cost, action: details.action });
    }
    res.json({ success: true, commands });
  });

  app.post('/api/admin/custom-commands', adminAuth, express.json(), async (req, res) => {
    try {
      const { command, cost, action } = req.body;
      if (!command || !command.startsWith('!')) return res.status(400).json({ success: false, error: 'Command must start with !' });
      const c = parseInt(cost, 10) || 0;
      
      const db = getDb();
      await db.run('INSERT INTO custom_aliases (command, cost, action) VALUES (?, ?, ?) ON CONFLICT(command) DO UPDATE SET cost = ?, action = ?', [command, c, action, c, action]);
      
      const oldCmd = customAliasesMap.get(command);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'update_command', command, JSON.stringify(oldCmd || {}), JSON.stringify({cost: c, action}));
      
      customAliasesMap.set(command, { cost: c, action });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/admin/custom-commands/:cmd', adminAuth, async (req, res) => {
    try {
      const command = req.params.cmd;
      const db = getDb();
      await db.run('DELETE FROM custom_aliases WHERE command = ?', [command]);
      const oldCmd = customAliasesMap.get(command);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_command', command, JSON.stringify(oldCmd || {}), '');
      customAliasesMap.delete(command);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/users/points', adminAuth, express.json(), async (req, res) => {
    try {
      const { username, points } = req.body;
      if (!username || points === undefined) return res.status(400).json({ success: false, error: 'Invalid input' });
      const db = getDb();
      await db.run('UPDATE users SET points = ? WHERE username = ?', [parseInt(points, 10), username.toLowerCase()]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/admin/items', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const items = await db.all('SELECT * FROM items');
      res.json({ success: true, items });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/items', adminAuth, express.json(), async (req, res) => {
    try {
      let { originalName, name, rarity, description, effectType, effectValue, effectDurationMinutes, isGlobal, uses, autoConsume, isPercentage, maxGambleLimit } = req.body;
      if (!name || name.trim() === '') return res.status(400).json({ success: false, error: 'Name is required' });
      name = name.trim();
      
      const db = getDb();
      
      if (originalName && originalName !== name) {
        await db.run('DELETE FROM items WHERE name COLLATE NOCASE = ?', [originalName]);
        
        // Safely migrate the renamed item in user inventories, merging quantities if necessary
        await db.run(`
          INSERT INTO user_inventory (username, item_name, quantity)
          SELECT username, ?, quantity FROM user_inventory WHERE item_name COLLATE NOCASE = ? AND item_name != ?
          ON CONFLICT(username, item_name) DO UPDATE SET quantity = user_inventory.quantity + excluded.quantity
        `, [name, originalName, name]);
        await db.run('DELETE FROM user_inventory WHERE item_name COLLATE NOCASE = ? AND item_name != ?', [originalName, name]);
      }

      await db.run(`
        INSERT INTO items (name, rarity, description, effectType, effectValue, effectDurationMinutes, isGlobal, uses, autoConsume, isPercentage, maxGambleLimit)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET 
          rarity=excluded.rarity, description=excluded.description, effectType=excluded.effectType,
          effectValue=excluded.effectValue, effectDurationMinutes=excluded.effectDurationMinutes,
          isGlobal=excluded.isGlobal, uses=excluded.uses, autoConsume=excluded.autoConsume,
          isPercentage=excluded.isPercentage, maxGambleLimit=excluded.maxGambleLimit
      `, [
        name, rarity, description, effectType, parseFloat(effectValue) || 0,
        parseInt(effectDurationMinutes) || 0, isGlobal ? 1 : 0, parseInt(uses) || 1, autoConsume ? 1 : 0,
        isPercentage ? 1 : 0, parseInt(maxGambleLimit) || 0
      ]);
      
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', originalName ? 'update_item' : 'create_item', name, originalName || '', JSON.stringify({rarity, description, effectType, effectValue, effectDurationMinutes, isGlobal, uses, autoConsume, isPercentage, maxGambleLimit}));
      
      if (loadItemsConfig) await loadItemsConfig();
      res.json({ success: true, message: 'Item saved.' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/admin/items/:name', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      await db.run('DELETE FROM items WHERE name = ?', [req.params.name]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_item', req.params.name, '', '');
      if (loadItemsConfig) await loadItemsConfig();
      res.json({ success: true, message: 'Item deleted.' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/admin/masspointsadd', adminAuth, express.json(), async (req, res) => {
    try {
      const { amount, timeStr } = req.body;
      const parsedAmount = parseInt(amount, 10);
      if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });
      const durationMs = parseTime(timeStr || '5m');
      const threshold = Date.now() - durationMs;
      const ignoredBots = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'dotabod', 'wizebot', 'fossabot', 'kofibot', 'soundalerts'];
      const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
      const db = getDb();
      await db.run(`UPDATE users SET points = points + ? WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [parsedAmount, threshold]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'mass_points_add', `active_users_past_${timeStr}`, '', String(parsedAmount));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/masspointssub', adminAuth, express.json(), async (req, res) => {
    try {
      const { amount, timeStr } = req.body;
      const parsedAmount = parseInt(amount, 10);
      if (isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ success: false, error: 'Invalid amount' });
      const durationMs = parseTime(timeStr || '5m');
      const threshold = Date.now() - durationMs;
      const ignoredBots = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'dotabod', 'wizebot', 'fossabot', 'kofibot', 'soundalerts'];
      const ignoredBotsStr = ignoredBots.map(b => `'${b}'`).join(',');
      const db = getDb();
      await db.run(`UPDATE users SET points = MAX(0, points - ?) WHERE true_last_chat_time >= ? AND username NOT IN (${ignoredBotsStr})`, [parsedAmount, threshold]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'mass_points_sub', `active_users_past_${timeStr}`, '', String(parsedAmount));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/actions/clear', adminAuth, async (req, res) => {
    if (clearOverlaySystem) {
      clearOverlaySystem();
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'clear_overlay', 'system', '', '');
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'clearOverlaySystem not available' });
    }
  });

  // Admin Playsound Management
  app.put('/api/admin/playsounds/:name', adminAuth, express.json(), async (req, res) => {
    try {
      const db = getDb();
      const { description, categories } = req.body;
      const catsJson = JSON.stringify(categories || []);
      const nameOnly = req.params.name.replace(/\.(mp3|ogg)$/i, '');
      
      const exists = await db.get('SELECT name FROM playsounds_metadata WHERE name = ?', [nameOnly]);
      if (exists) {
        await db.run('UPDATE playsounds_metadata SET description = ?, categories = ? WHERE name = ?', [description, catsJson, nameOnly]);
      } else {
        await db.run('INSERT INTO playsounds_metadata (name, description, categories) VALUES (?, ?, ?)', [nameOnly, description, catsJson]);
      }
      
      if (categories && Array.isArray(categories)) {
        for (const c of categories) {
          await db.run('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)', [c.toLowerCase(), 'playsound']);
        }
      }
      
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', exists ? 'update_playsound' : 'create_playsound', nameOnly, exists ? JSON.stringify(exists) : '', JSON.stringify({description, categories}));
      
      res.json({ success: true, message: 'Playsound updated successfully.' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/admin/playsounds/:name', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const filename = req.params.name;
      const oggPath = path.join(__dirname, 'data', 'playsounds', filename + '.ogg');
      const mp3Path = path.join(__dirname, 'data', 'playsounds', filename + '.mp3');
      
      let deleted = false;
      if (fs.existsSync(oggPath)) { fs.unlinkSync(oggPath); deleted = true; }
      if (fs.existsSync(mp3Path)) { fs.unlinkSync(mp3Path); deleted = true; }

      await db.run('DELETE FROM playsounds_metadata WHERE name = ?', [filename]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_playsound', filename, '', '');
      
      if (deleted) {
        res.json({ success: true, message: `Playsound ${filename} deleted.` });
      } else {
        res.status(404).json({ success: false, error: 'Playsound file not found, but metadata was removed.' });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Admin Trivia Management
  app.get('/api/admin/trivia', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const triviaRows = await db.all('SELECT * FROM trivia_questions');
      const trivia = triviaRows.map(row => {
        let cats = [];
        try { cats = JSON.parse(row.categories || '[]'); } catch (e) {}
        return {
          id: row.id,
          question: row.question,
          answer: row.answer,
          hint: row.hint,
          submitter: row.submitter,
          categories: cats
        };
      });
      res.json({ success: true, trivia });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.put('/api/admin/trivia/:id', adminAuth, express.json(), async (req, res) => {
    try {
      const id = req.params.id;
      const { question, answer, hint, categories } = req.body;
      const db = getDb();
      
      const catsStr = JSON.stringify(categories || []);
      await db.run('UPDATE trivia_questions SET question = ?, answer = ?, hint = ?, categories = ? WHERE id = ?', 
        [question, answer, hint || '', catsStr, id]);
        
      for (const c of (categories || [])) {
        await db.run('INSERT OR IGNORE INTO categories (name, type) VALUES (?, ?)', [c, 'trivia']);
      }
      
      res.json({ success: true, message: 'Trivia updated successfully.' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete('/api/admin/trivia/:id', adminAuth, async (req, res) => {
    try {
      const id = req.params.id;
      const db = getDb();
      await db.run('DELETE FROM trivia_questions WHERE id = ?', [id]);
      res.json({ success: true, message: 'Trivia deleted successfully.' });
    } catch (e) {
      console.error(e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const users = await db.all('SELECT username FROM users ORDER BY username ASC');
      res.json({ success: true, users: users.map(u => u.username) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/admin/user-details/:username', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      const username = req.params.username.toLowerCase();
      const userRow = await db.get('SELECT points, xp FROM users WHERE username = ?', [username]);
      if (!userRow) return res.status(404).json({ success: false, error: 'User not found' });
      
      const levelBase = parseInt(globalConfig['level_base_cost'] || '200', 10);
      const level = Math.floor(Math.sqrt((userRow.xp || 0) / levelBase)) + 1;
      
      const inventory = await db.all('SELECT item_name, quantity FROM user_inventory WHERE username = ? AND quantity > 0', [username]);
      const now = Date.now();
      const activeEffects = await db.all('SELECT * FROM active_effects WHERE target_user = ? AND (expires_at > ? OR uses_left > 0)', [username, now]);
      const modifiers = await db.all('SELECT * FROM user_modifiers WHERE username = ?', [username]);
      
      res.json({ success: true, points: userRow.points, xp: userRow.xp || 0, level, inventory, activeEffects, modifiers });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.delete('/api/admin/users/:username/effect/:id', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      await db.run('DELETE FROM active_effects WHERE target_user = ? AND id = ?', [req.params.username.toLowerCase(), req.params.id]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_user_effect', req.params.username, req.params.id, '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.delete('/api/admin/users/:username/modifier/:modifier', adminAuth, async (req, res) => {
    try {
      const db = getDb();
      await db.run('DELETE FROM user_modifiers WHERE username = ? AND modifier = ?', [req.params.username.toLowerCase(), req.params.modifier]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'delete_user_modifier', req.params.username, req.params.modifier, '');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/users/xp', adminAuth, express.json(), async (req, res) => {
    try {
      const { username, xp } = req.body;
      if (!username || xp === undefined) return res.status(400).json({ success: false, error: 'Invalid input' });
      const db = getDb();
      await db.run('UPDATE users SET xp = ? WHERE username = ?', [parseInt(xp, 10), username.toLowerCase()]);
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'set_user_xp', username, '', String(xp));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/users/inventory', adminAuth, express.json(), async (req, res) => {
    try {
      const { username, itemName, quantityChange } = req.body;
      if (!username || !itemName || quantityChange === undefined) return res.status(400).json({ success: false, error: 'Invalid input' });
      const db = getDb();
      const uname = username.toLowerCase();
      const item = itemName.toLowerCase();
      
      const currentItem = await db.get('SELECT item_name, quantity FROM user_inventory WHERE username = ? AND item_name COLLATE NOCASE = ?', [uname, item]);
      const currentQty = currentItem ? currentItem.quantity : 0;
      const dbItemName = currentItem ? currentItem.item_name : itemName; // Use existing casing or the one provided
      const newQty = Math.max(0, currentQty + parseInt(quantityChange, 10));
      
      if (currentItem) {
        if (newQty > 0) {
          await db.run('UPDATE user_inventory SET quantity = ? WHERE username = ? AND item_name = ?', [newQty, uname, dbItemName]);
        } else {
          await db.run('DELETE FROM user_inventory WHERE username = ? AND item_name = ?', [uname, dbItemName]);
        }
      } else if (newQty > 0) {
        await db.run('INSERT INTO user_inventory (username, item_name, quantity) VALUES (?, ?, ?)', [uname, dbItemName, newQty]);
      }
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'update_user_inventory', username, `${dbItemName}: ${currentQty}`, `${dbItemName}: ${newQty}`);
      res.json({ success: true, newQuantity: newQty });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/admin/playsounds', adminAuth, (req, res) => {
    try {
      const dir = path.join(__dirname, 'data', 'playsounds');
      if (!fs.existsSync(dir)) return res.json({ success: true, sounds: [] });
      const files = fs.readdirSync(dir);
      const sounds = files.map(f => f.split('.')[0]).filter((v, i, a) => a.indexOf(v) === i);
      res.json({ success: true, sounds });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.delete('/api/admin/playsounds/:name', adminAuth, (req, res) => {
    try {
      const filename = req.params.name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
      const oggPath = path.join(__dirname, 'data', 'playsounds', filename + '.ogg');
      const mp3Path = path.join(__dirname, 'data', 'playsounds', filename + '.mp3');
      
      let deleted = false;
      if (fs.existsSync(oggPath)) { fs.unlinkSync(oggPath); deleted = true; }
      if (fs.existsSync(mp3Path)) { fs.unlinkSync(mp3Path); deleted = true; }
      
      if (deleted) res.json({ success: true });
      else res.json({ success: false, error: 'Sound not found' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/commands/disable', adminAuth, express.json(), async (req, res) => {
    try {
      const { command, durationMs } = req.body;
      if (!command) return res.status(400).json({ success: false, error: 'Command required' });
      
      const val = durationMs > 0 ? (Date.now() + durationMs).toString() : 'forever';
      const key = `cmd_${command}_disabled_until`;
      
      const db = getDb();
      await db.run('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?', [key, val, val]);
      globalConfig[key] = val;
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'disable_command', command, '', val);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.post('/api/admin/commands/enable', adminAuth, express.json(), async (req, res) => {
    try {
      const { command } = req.body;
      if (!command) return res.status(400).json({ success: false, error: 'Command required' });
      
      const key = `cmd_${command}_disabled_until`;
      
      const db = getDb();
      await db.run('DELETE FROM app_config WHERE key = ?', [key]);
      delete globalConfig[key];
      await logAudit(req.adminUser ? req.adminUser.username : 'admin', 'enable_command', command, 'disabled', 'enabled');
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/admin/commands/disabled', adminAuth, (req, res) => {
    try {
      const disabled = [];
      for (const [key, val] of Object.entries(globalConfig)) {
        if (key.startsWith('cmd_') && key.endsWith('_disabled_until')) {
          const cmd = key.replace('cmd_', '').replace('_disabled_until', '');
          if (val === 'forever') {
            disabled.push(cmd);
          } else if (!isNaN(val) && parseInt(val, 10) > Date.now()) {
            disabled.push(cmd);
          }
        }
      }
      res.json({ success: true, disabled });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  app.get('/api/config', (req, res) => {
    res.json({
      durationMs: parseInt(globalConfig['cmd_!showemote_duration']) || parseInt(process.env.EMOTE_DURATION_MS) || 5000,
      sizePx: parseInt(globalConfig['cmd_!showemote_size']) || parseInt(process.env.EMOTE_SIZE_PX) || 150
    });
  });

  app.get('/api/economy-rates', (req, res) => {
    res.json({
      level_base_cost: parseInt(globalConfig['level_base_cost'] || '200', 10),
      points_to_xp_rate: parseFloat(globalConfig['points_to_xp_rate'] || '1'),
      leg_bonus_rate: parseFloat(globalConfig['leg_bonus_rate'] || '0.01'),
      rare_bonus_rate: parseFloat(globalConfig['rare_bonus_rate'] || '0.05'),
      lvl_bonus_rate: parseFloat(globalConfig['lvl_bonus_rate'] || '0.001')
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
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
  });

  app.get('/api/force-reset-tokens', (req, res) => {
    const tokenPath = path.join(__dirname, 'data', 'tokens.json');
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
      res.send('tokens.json deleted! Restarting bot to fetch new tokens from AUTH_CODE...');
      setTimeout(() => process.exit(1), 1000);
    } else {
      res.send('tokens.json not found. The bot will naturally use your AUTH_CODE on its next startup.');
    }
  });


  app.get('/api/dashboard/commands', (req, res) => {
    try {
      const defaultSettingsFallback = {
        '!showemote': { cost: 0, duration: parseInt(process.env.EMOTE_DURATION_MS) || 5000, size: parseInt(process.env.EMOTE_SIZE_PX) || 150, cooldown: 0 },
        '!playsound': { cost: parseInt(process.env.DEFAULT_PLAYSOUND_COST) || 0, cooldown: 0 },
        '!global': { cooldown: parseInt(process.env.COMMAND_COOLDOWN) || 1000 }
      };

      const defaultCommands = Object.keys(commandConfigSchema).map(cmd => {
        const disabledRaw = globalConfig[`cmd_${cmd}_disabled_until`];
        const isDisabled = disabledRaw === 'forever' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw));
        
        return {
          command: cmd,
          isDisabled: isDisabled,
          isSubOnly: globalConfig[`cmd_${cmd}_sub_only`] === 'true',
          isOfflineOnly: globalConfig[`cmd_${cmd}_offline_only`] === 'true',
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
        const disabledRaw = globalConfig[`cmd_${cmd}_disabled_until`];
        const isDisabled = disabledRaw === 'forever' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw));
        
        customCommands.push({
          command: cmd,
          action: data.action,
          cost: data.cost,
          isDisabled: isDisabled,
          isSubOnly: globalConfig[`cmd_${cmd}_sub_only`] === 'true',
          isOfflineOnly: globalConfig[`cmd_${cmd}_offline_only`] === 'true'
        });
      });

      res.json({ success: true, defaultCommands, customCommands });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/dashboard/sounds', async (req, res) => {
    try {
      const db = getDb();
      const metadata = await db.all('SELECT name, categories FROM playsounds_metadata');
      const metaMap = {};
      for (const row of metadata) {
        metaMap[row.name] = row;
      }

      const soundsDir = path.join(__dirname, 'data', 'playsounds');
      let sounds = [];
      if (fs.existsSync(soundsDir)) {
        const files = fs.readdirSync(soundsDir).filter(f => f.endsWith('.mp3') || f.endsWith('.ogg'));
        sounds = files.map(f => {
          const stats = fs.statSync(path.join(soundsDir, f));
          const nameOnly = f.split('.').slice(0, -1).join('.');
          const cost = globalConfig[`cost_playsound_${nameOnly}`];
          const cooldown = globalConfig[`cooldown_playsound_${nameOnly}`];
          
          let categories = ['Uncategorized'];
          if (metaMap[nameOnly] && metaMap[nameOnly].categories) {
            try {
              const parsed = JSON.parse(metaMap[nameOnly].categories);
              if (Array.isArray(parsed) && parsed.length > 0) {
                categories = parsed;
              }
            } catch(e) {}
          }

          return { 
            filename: f, 
            uploadedAt: stats.mtimeMs, 
            customCost: cost, 
            customCooldown: cooldown,
            categories
          };
        });
      }
      res.json({ success: true, sounds });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/dashboard/config', (req, res) => {
    try {
      res.json({
        success: true,
        rewards: {
          sub: parseInt(globalConfig['reward_sub'] || '5000', 10),
          bits: parseInt(globalConfig['reward_bits'] || '10', 10),
          giftsub: parseInt(globalConfig['reward_giftsub'] || '5000', 10),
          giftsub_scaling: parseInt(globalConfig['reward_giftsub_scaling'] || '10', 10),
          giftsub_cap: parseInt(globalConfig['reward_giftsub_cap'] || '100000', 10),
          active_action_bonus_cap: parseInt(globalConfig['active_action_bonus_cap'] || '5000', 10),
          watchstreak: parseInt(globalConfig['reward_watchstreak'] || '1000', 10),
          watchstreak_scaling: parseInt(globalConfig['reward_watchstreak_scaling'] || '20', 10),
          watchstreak_cap: parseInt(globalConfig['reward_watchstreak_cap'] || '100000', 10),
          raffle_min: parseInt(globalConfig['reward_raffle_min'] || '1500', 10),
          raffle_max: parseInt(globalConfig['reward_raffle_max'] || '25000', 10),
          multiraffle_min: parseInt(globalConfig['reward_multiraffle_min'] || '3', 10),
          multiraffle_max: parseInt(globalConfig['reward_multiraffle_max'] || '12', 10),
          chat_cooldown: parseInt(globalConfig['reward_chat_cooldown'] || '25', 10)
        },
        emoteModifiers: ['wide', 'cursed', 'flipx', 'flipy', 'bounce', 'leave', 'arrive', 'jam', 'rainbow', 'hyper'].reduce((acc, mod) => {
          const disabledRaw = globalConfig[`disabled_mod_${mod}`];
          acc[mod] = {
            cost: parseInt(globalConfig[`mod_${mod}_cost`] || '0', 10),
            isDisabled: disabledRaw === 'true' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw))
          };
          return acc;
        }, {})
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/dashboard/stats', async (req, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(503).json({ success: false, error: 'Database not ready' });
      const userStatsRaw = await db.all('SELECT u.xp, u.points, s.*, u.username FROM users u LEFT JOIN user_stats s ON u.username = s.username');
      const levelBase = parseInt(globalConfig['level_base_cost'] || '200', 10);
      const userStats = userStatsRaw.map(u => {
        u.level = Math.floor(Math.sqrt((u.xp || 0) / levelBase)) + 1;
        
        // Ensure stats default to 0 if they were NULL (because the user isn't in user_stats table yet)
        u.duels_played = u.duels_played || 0;
        u.duels_won = u.duels_won || 0;
        u.duels_lost = u.duels_lost || 0;
        u.duels_points_won = u.duels_points_won || 0;
        u.duels_points_lost = u.duels_points_lost || 0;
        u.raffles_joined = u.raffles_joined || 0;
        u.raffles_won = u.raffles_won || 0;
        u.raffles_points_won = u.raffles_points_won || 0;
        u.gamble_played = u.gamble_played || 0;
        u.gamble_won = u.gamble_won || 0;
        u.gamble_lost = u.gamble_lost || 0;
        u.gamble_points_won = u.gamble_points_won || 0;
        u.gamble_points_lost = u.gamble_points_lost || 0;
        u.bets_played = u.bets_played || 0;
        u.bets_won = u.bets_won || 0;
        u.bets_lost = u.bets_lost || 0;
        u.bets_points_bet = u.bets_points_bet || 0;
        u.bets_points_won = u.bets_points_won || 0;
        u.bets_points_lost = u.bets_points_lost || 0;
        u.chatwar_spent = u.chatwar_spent || 0;
        u.chatwar_lost = u.chatwar_lost || 0;

        return u;
      });
      const emoteStats = await db.all('SELECT * FROM emote_stats');
      res.json({ success: true, userStats, emoteStats });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/dashboard/items', (req, res) => {
    try {
      const mappedItems = {};
      for (const [rarity, list] of Object.entries(FISHING_ITEMS)) {
        mappedItems[rarity] = list.map(item => ({
          ...item,
          name: item.originalName
        }));
      }
      res.json({ success: true, items: mappedItems, rarities: FISHING_RARITIES });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/dashboard/inventory', async (req, res) => {
    try {
      const db = getDb();
      if (!db) return res.status(503).json({ success: false, error: 'Database not ready' });
      const inventory = await db.all('SELECT * FROM user_inventory WHERE quantity > 0');
      const now = Date.now();
      const activeEffects = await db.all('SELECT * FROM active_effects WHERE expires_at > ? OR uses_left > 0', [now]);
      const userModifiers = await db.all('SELECT * FROM user_modifiers WHERE value > 0');
      const pendingFish = await db.all('SELECT * FROM pending_fish');
      res.json({ success: true, inventory, activeEffects, userModifiers, pendingFish });
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

export function broadcastEmote(url, isZeroWidth = false, messageId = null, customX = null, customY = null, modifiers = []) {
  const data = JSON.stringify({ 
    type: 'emote', 
    url, 
    isZeroWidth, 
    messageId,
    customX,
    customY,
    modifiers
  });
  sseClients.forEach(client => client.write(`data: ${data}\n\n`));
}

export function broadcastAudio(filename, volume = 1.0) {
  const payload = `data: ${JSON.stringify({ type: 'audio', file: filename, volume: volume })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastConfig(globalConfig) {
  const duration = parseInt(globalConfig['cmd_!showemote_duration']) || parseInt(process.env.EMOTE_DURATION_MS) || 5000;
  const size = parseInt(globalConfig['cmd_!showemote_size']) || parseInt(process.env.EMOTE_SIZE_PX) || 150;
  const payload = `data: ${JSON.stringify({ type: 'config_update', durationMs: duration, sizePx: size })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

export function broadcastBetState(bet) {
  if (!bet || bet.isHidden) return;
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
  if (!war || war.isHidden) return;
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

export function clearEmotes() {
  const payload = `data: ${JSON.stringify({ type: 'clear_emotes' })}\n\n`;
  sseClients.forEach(client => client.write(payload));
}


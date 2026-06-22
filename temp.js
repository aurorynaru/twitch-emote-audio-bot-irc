
  // Static Reference Data
  const commandInstructions = {
    '!playsound': 'Play an audio file. Usage: !playsound <sound_name>',
    '!showemote': 'Display an emote on the overlay. Usage: !showemote <emote>',
    '!betstart': 'Start a betting session. Usage: !betstart <Description> <choice1,choice2> <time_in_seconds> ',
    '!betstop': 'Resolve a bet. Usage: !betstop <winning_choice>',
    '!betstatus': 'Check current bet info. Usage: !betstatus',
    '!betcancel': 'Cancel a bet and refund points (Admin). Usage: !betcancel',
    '!bet': 'Place a bet on an active betting session. Usage: !bet <choice> <amount>',
    '!points': 'Check your points. Usage: !points',
    '!gamble': 'Gamble your points. Usage: !gamble <amount>',
    '!chatwar': 'Start a chat war. Usage: !chatwar <emote1> <emote2> <cost> <time_in_minutes>',
    '!chatwarcancel': 'Cancel the chat war. Usage: !chatwarcancel',
    '!global': 'Global command settings (cooldown).',
    '!commandlist': 'Show all commands.',
    '!addcommand': 'Add a custom command (Admin). Usage: !addcommand <cmd> <action>',
    '!removecommand': 'Remove a custom command (Admin). Usage: !removecommand <cmd>',
    '!editcommand': 'Edit custom command cost/cooldown (Admin). Usage: !editcommand <cmd> <setting> <value>',
    '!duel': 'Challenge another user for points! Usage: !duel @user <amount>',
    '!acceptduel': 'Accept a pending duel request.',
    '!declineduel': 'Decline a pending duel request.',
    '!disable': '!disable a command. Usage !disable  <cmd> optional<time>. sample !disable !playsound 10m',
    '!enable': 'Enable a command. Usage !enable <cmd>.  sample !enable !playsound',
    '!subonly': 'Make a command subscriber-only (Admin). Usage: !subonly <cmd> <true/false>. sample: !subonly !playsound true',
    '!raffle': 'Start a raffle. Usage !raffle <points amount> <time_in_minutes>. Use -<amount> to deduct points.',
    '!multiraffle': 'Start a multi-winner raffle. Usage !multiraffle <points amount> <time_in_minutes> <number_of_winners>. Use -<amount> to deduct points.',
    '!join': 'Join a raffle. Usage !join',
    '!toppoints': 'Display the top point earners. Usage: !toppoints [number] (default: 5)',
    '!editpoints': 'Edit user points. Usage: !editpoints <username> <amount>',
    '!masspointsadd': 'Add points to all users who chatted in the last <time>. Usage !masspointsadd <amount> <time>. sample !masspointsadd 1000 10m',
    '!masspointssub': 'Remove points from all users who chatted in the last <time>. Usage !masspointssub <amount> <time>. sample !masspointssub 1000 10m',
    '!chatcooldown': 'set global cooldown for chat commands. Usage: !chatcooldown <time>. sample !chatcooldown 10s or !chatcooldown !playsound 10s',
    '!givepoints': 'Give points to users. Usage !givepoints <amount> <username>. sample !givepoints 50 username',
    '!removepoints': 'Remove points from users (Admin). Usage: !removepoints <amount> <username>',
    '!deleteplaysound': 'Delete a playsound. Usage !deleteplaysound <soundname>. sample !deleteplaysound 5dollars',
    '!editrewards': 'Edit rewards. Usage !editrewards <type> <val1> [val2]. Types: sub, giftsub, watchstreak, raffle, multiraffle | !editrewards raffle 5000 50000 | !editrewards multiraffle 5 20 | !editrewards sub 10000',
    '!lvlup': 'Level up using points. Usage: !lvlup <amount>, !lvlup 30%, or !lvlup all',
    '!use': 'Use an item from your inventory. Usage: !use <item> [qty] or !use all <item>',
    '!fish': 'Go fishing to earn items. Usage: !fish',
    '!inventory': 'Check your items. Usage: !inventory or !inv',
    '!buffs': 'Check your active buffs and effects. Usage: !buffs',
    '!emotesize': 'Set the size of emotes on the overlay (Admin). Usage: !emotesize <size>',
    '!emoteduration': 'Set how long emotes stay on the overlay (Admin). Usage: !emoteduration <seconds>',
    '!clearoverlay': 'Clear all emotes and sounds from the screen (Admin). Usage: !clearoverlay',
    '!editconfig': 'Edit configuration variables (Admin). Usage: !editconfig <key> <value>',
    '!refreshemotes': 'Refresh third party emotes (Admin). Usage: !refreshemotes',
    '!dueltax': 'Check or set the duel tax percentage (Admin). Usage: !dueltax [percentage]',
    '!giveitem': 'Give an item to a user (Admin). Usage: !giveitem <username> <item name> [amount]',
    '!reloaditems': 'Reload items from items.json (Admin). Usage: !reloaditems',
  };

  const builtInAliases = {
    '!point': '!points', '!pts': '!points', '!givepoint': '!givepoints',
    '!givept': '!givepoints', '!givepts': '!givepoints', '!startbet': '!betstart',
    '!stopbet': '!betstop', '!checkbet': '!betstatus', '!statusbet': '!betstatus',
    '!editpoint': '!editpoints', '!toppoint': '!toppoints', '!top': '!toppoints',
    '!leaderboard': '!toppoints', '!addpoint': '!masspointsadd', '!subpoint': '!masspointssub',
    '!delcommand': '!removecommand', '!deletecommand': '!removecommand', '!commands': '!commandlist',
    '!cmds': '!commandlist', '!cmdlist': '!commandlist', '!roulette': '!gamble',
    '!roll': '!gamble', '!setrewards': '!editrewards', '!buylvl': '!lvlup',
    '!buylevel': '!lvlup', '!buylevels': '!lvlup', '!levelup': '!lvlup',
    '!inv': '!inventory', '!redeem': '!use'
  };

  // State
  const globalKeys = [
    { key: 'chat_wide_cooldown', label: 'Chat Wide Cooldown (ms)', type: 'number', def: 1500, tooltip: 'Global delay between any chat commands being processed' },
    { key: 'cmd_!global_cooldown', label: 'Global Default Cooldown (ms)', type: 'number', def: 1000, tooltip: "Default cooldown applied to commands that don't have a specific cooldown set" },
    { key: 'cmd_!fish_time', label: 'Base Fish Time (minutes)', type: 'number', def: 5, tooltip: 'Base duration for the fishing minigame' },
    { key: 'level_base_cost', label: 'Level Base Cost', type: 'number', def: 200, tooltip: 'Points required to reach the first level' },
    { key: 'points_to_xp_rate', label: 'Points to XP Rate', type: 'text', def: 1, tooltip: 'Multiplier for converting points to XP' },
    { key: 'leg_bonus_rate', label: 'Legendary Bonus Rate', type: 'text', def: 0.01, tooltip: 'Bonus multiplier for legendary items' },
    { key: 'rare_bonus_rate', label: 'Rare Bonus Rate', type: 'text', def: 0.05, tooltip: 'Bonus multiplier for rare items' },
    { key: 'lvl_bonus_rate', label: 'Level Bonus Rate', type: 'text', def: 0.001, tooltip: 'Additional multiplier gained per user level' },
    { key: 'reward_sub', label: 'Reward: Sub', type: 'number', def: 5000, tooltip: 'Points rewarded when someone subscribes' },
    { key: 'reward_giftsub', label: 'Reward: Gift Sub', type: 'number', def: 5000, tooltip: 'Points rewarded to the gifter per gift sub' },
    { key: 'reward_watchstreak', label: 'Reward: Watch Streak', type: 'number', def: 1000, tooltip: 'Points rewarded for consecutive streams watched' },
    { key: 'reward_chat_sub', label: 'Reward: Chat (Sub)', type: 'number', def: 750, tooltip: 'Points rewarded to subscribers for chatting (respects cooldown)' },
    { key: 'reward_chat_nonsub', label: 'Reward: Chat (Non-Sub)', type: 'number', def: 500, tooltip: 'Points rewarded to non-subscribers for chatting (respects cooldown)' },
    { key: 'reward_chat_cooldown', label: 'Reward: Chat Cooldown (mins)', type: 'number', def: 25, tooltip: 'Minutes between chat rewards' },
    { key: 'reward_raffle_min', label: 'Reward: Raffle Min', type: 'number', def: 1500, tooltip: 'Minimum points won in a random raffle trigged by subbing/resubbing/gifting subs and gifting bits' },
    { key: 'reward_raffle_max', label: 'Reward: Raffle Max', type: 'number', def: 25000, tooltip: 'Minimum points won in a random  raffle trigged by subbing/resubbing/gifting subs and gifting bits' },
    { key: 'reward_multiraffle_min', label: 'Reward: Multi-Raffle Min', type: 'number', def: 3, tooltip: 'Minimum winners in a multi-raffle' },
    { key: 'reward_multiraffle_max', label: 'Reward: Multi-Raffle Max', type: 'number', def: 12, tooltip: 'Maximum winners in a multi-raffle' },
    { key: 'duel_tax', label: 'Duel Tax Rate (0 to 1)', type: 'text', def: 0.05, tooltip: 'Percentage of points taken from winning duels (e.g. 0.05 for 5%)' }
  ];

  const commandDefaults = {
    '!showemote_duration': 5000,
    '!showemote_size': 150,
    '!playsound_cost': 0, // Fallback is DEFAULT_PLAYSOUND_COST which is in env, usually 0
  };

  let configData = {};
  
  async function loadConfig() {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      if (data.success) {
        configData = data;
        renderDashboard();
      } else {
        alert('Failed to load config');
      }

      await Promise.all([
        loadCustomCommands(),
        loadUsersForAutocomplete(),
        loadPlaysoundsForAutocomplete(),
        loadDisabledCommandsForAutocomplete()
      ]);
    } catch (e) {
      alert('Error loading config: ' + e.message);
    }
  }

  let globalUsers = [];
  let globalSounds = [];
  let globalCommands = [];
  let globalDisabledCommands = [];

  function setupAutocomplete(inputId, listId, dataArray) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);

    input.addEventListener('input', () => {
      const val = input.value.toLowerCase();
      list.innerHTML = '';
      if (!val) {
        list.style.display = 'none';
        return;
      }
      const matches = dataArray.filter(item => item.toLowerCase().includes(val));
      if (matches.length === 0) {
        list.style.display = 'none';
        return;
      }
      matches.forEach(match => {
        const li = document.createElement('li');
        li.textContent = match;
        li.addEventListener('mousedown', () => {
          input.value = match;
          list.style.display = 'none';
        });
        list.appendChild(li);
      });
      list.style.display = 'block';
    });

    input.addEventListener('focus', () => {
      if (input.value) input.dispatchEvent(new Event('input'));
    });

    input.addEventListener('blur', () => {
      list.style.display = 'none';
    });
  }

  async function loadUsersForAutocomplete() {
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (data.success) {
        globalUsers = data.users;
        setupAutocomplete('editUsername', 'usersSuggestions', globalUsers);
      }
    } catch (e) { console.error(e); }
  }

  async function loadPlaysoundsForAutocomplete() {
    try {
      const res = await fetch('/api/admin/playsounds');
      const data = await res.json();
      if (data.success) {
        globalSounds = data.sounds;
        setupAutocomplete('deleteSoundName', 'soundsSuggestions', globalSounds);
        setupAutocomplete('blacklistPlaysoundInput', 'blacklistPlaysoundSuggestions', globalSounds);
      }
    } catch (e) { console.error(e); }
  }

  async function loadDisabledCommandsForAutocomplete() {
    try {
      const res = await fetch('/api/admin/commands/disabled');
      const data = await res.json();
      if (data.success) {
        globalDisabledCommands = data.disabled;
        setupAutocomplete('enableCmdName', 'disabledCommandsSuggestions', globalDisabledCommands);
      }
    } catch (e) { console.error(e); }
  }

  async function loadCustomCommands() {
    try {
      const res = await fetch('/api/admin/custom-commands');
      const data = await res.json();
      const options = Object.keys(configData.commandConfigSchema || {});
      if (data.success) {
        renderCustomCommands(data.commands);
        data.commands.forEach(cmd => {
          if (!options.includes(cmd.command)) options.push(cmd.command);
        });
      }
      globalCommands = options;
      setupAutocomplete('disableCmdName', 'commandsSuggestions', globalCommands);
    } catch(e) {
      console.error(e);
    }
  }

  function renderCustomCommands(commands) {
    const grid = document.getElementById('customCommandsGrid');
    grid.innerHTML = '';
    commands.forEach(cmd => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3 style="color: #bf94ff;">${cmd.command}</h3>
        <p><strong>Cost:</strong> ${cmd.cost}</p>
        <p style="word-break: break-all;"><strong>Action:</strong> ${cmd.action}</p>
        <button class="save-btn" style="background-color: #ff4a4a; margin-top: 10px; padding: 6px 12px; font-size: 14px;" onclick="deleteCustomCommand('${cmd.command}')">Delete</button>
      `;
      grid.appendChild(card);
    });
  }

  window.deleteCustomCommand = async function(cmd) {
    if (!confirm('Delete custom command ' + cmd + '?')) return;
    try {
      const res = await fetch('/api/admin/custom-commands/' + encodeURIComponent(cmd), { method: 'DELETE' });
      const data = await res.json();
      if (data.success) loadCustomCommands();
      else alert('Failed to delete');
    } catch (e) { alert(e); }
  }

  function renderDashboard() {
    const globalGrid = document.getElementById('globalSettingsGrid');
    globalGrid.innerHTML = '';
    
    // Render Global Settings
    globalKeys.forEach(g => {
      const value = configData.globalConfig[g.key] !== undefined && configData.globalConfig[g.key] !== '' ? configData.globalConfig[g.key] : g.def;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="form-group">
          <label>${g.label} <span class="tooltip-icon" data-tooltip="${g.tooltip || 'Global configuration setting'}">ⓘ</span></label>
          <input type="${g.type}" data-key="${g.key}" value="${value}">
        </div>
      `;
      globalGrid.appendChild(card);
    });

    // Render Command Configs
    const commandsGrid = document.getElementById('commandsGrid');
    commandsGrid.innerHTML = '';
    
    // Render Reference Grid
    const refGrid = document.getElementById('referenceGrid');
    refGrid.innerHTML = '';

    for (const [cmdName, schema] of Object.entries(configData.commandConfigSchema)) {
      if (cmdName === '!global') continue;

      const card = document.createElement('div');
      card.className = 'card';
      
      let html = `<h3>${cmdName} <span class="tooltip-icon" data-tooltip="Configure execution rules and costs for the ${cmdName} command.">ⓘ</span></h3>`;
      
      // Sub Only toggle
      const isSubOnly = configData.globalConfig[`cmd_${cmdName}_sub_only`] === 'true';
      html += `
        <div class="form-group row">
          <label>Subscribers Only</label>
          <input type="checkbox" data-key="cmd_${cmdName}_sub_only" ${isSubOnly ? 'checked' : ''}>
        </div>
      `;

      // Disabled toggle
      const disabledRaw = configData.globalConfig[`cmd_${cmdName}_disabled_until`];
      const isDisabled = disabledRaw === 'forever' || (!isNaN(parseInt(disabledRaw)) && Date.now() < parseInt(disabledRaw));
      html += `
        <div class="form-group row">
          <label>Disable Command</label>
          <input type="checkbox" data-key="cmd_${cmdName}_disabled" ${isDisabled ? 'checked' : ''}>
        </div>
      `;

      // Schema fields (cost, cooldown, duration, size)
      schema.forEach(field => {
        const configKey = `cmd_${cmdName}_${field}`;
        const def = commandDefaults[`${cmdName}_${field}`] !== undefined ? commandDefaults[`${cmdName}_${field}`] : '0';
        const val = configData.globalConfig[configKey] !== undefined && configData.globalConfig[configKey] !== '' ? configData.globalConfig[configKey] : def;
        html += `
          <div class="form-group">
            <label>${field.charAt(0).toUpperCase() + field.slice(1)}</label>
            <input type="number" data-key="${configKey}" value="${val}">
          </div>
        `;
      });

      card.innerHTML = html;
      commandsGrid.appendChild(card);

      // --- Reference Card (Command Reference) ---
      const aliases = Object.keys(builtInAliases).filter(alias => builtInAliases[alias] === cmdName);
      const refCard = document.createElement('div');
      refCard.className = 'card';
      
      let refHtml = `
        <h3 style="color: #00ff7f; margin-bottom: 5px; margin-top: 0;">${cmdName} <span class="tooltip-icon" data-tooltip="Command usage and aliasing info for ${cmdName}">ⓘ</span></h3>
        ${commandInstructions[cmdName] ? `<p style="margin-top: 0; margin-bottom: 10px; font-size: 0.95em; line-height: 1.4;">${commandInstructions[cmdName]}</p>` : ''}
        ${aliases.length > 0 ? `<p style="margin-top: 0; margin-bottom: 10px; font-size: 0.85em; color: #adadb8;"><strong>Aliases:</strong> ${aliases.join(', ')}</p>` : ''}
        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 4px; border: 1px solid #3a3a44;">
      `;
      
      // Add current sub_only status
      refHtml += `
        <div class="stat-row" style="margin-bottom: 5px; display: flex; justify-content: space-between;">
          <span class="stat-label" style="color: #adadb8;">sub_only:</span>
          <span class="stat-value" style="font-weight: bold;">${isSubOnly ? 'true' : 'false'}</span>
        </div>
      `;
      
      schema.forEach(field => {
        const configKey = `cmd_${cmdName}_${field}`;
        const def = commandDefaults[`${cmdName}_${field}`] !== undefined ? commandDefaults[`${cmdName}_${field}`] : '0';
        const val = configData.globalConfig[configKey] !== undefined && configData.globalConfig[configKey] !== '' ? configData.globalConfig[configKey] : def;
        refHtml += `
          <div class="stat-row" style="margin-bottom: 5px; display: flex; justify-content: space-between;">
            <span class="stat-label" style="color: #adadb8;">${field}:</span>
            <span class="stat-value" style="font-weight: bold;">${val}</span>
          </div>
        `;
      });
      refHtml += `</div>`;
      refCard.innerHTML = refHtml;
      refGrid.appendChild(refCard);
    }

    renderBlacklistedItems();
  }

  function renderBlacklistedItems() {
    const list = document.getElementById('blacklistedItemsList');
    list.innerHTML = '';
    
    let hasItems = false;
    const now = Date.now();

    for (const [key, val] of Object.entries(configData.globalConfig)) {
      if ((val === 'true' || (!isNaN(parseInt(val)) && parseInt(val) > now)) && (key.startsWith('disabled_playsound_') || key.startsWith('disabled_emote_'))) {
        hasItems = true;
        const type = key.startsWith('disabled_playsound_') ? 'Playsound' : 'Emote';
        const name = key.replace('disabled_playsound_', '').replace('disabled_emote_', '');
        
        let extraText = '';
        if (val !== 'true') {
          const timeLeftMs = parseInt(val) - now;
          const timeLeftMins = Math.ceil(timeLeftMs / 60000);
          extraText = ` <span style="color: #888; font-size: 12px;">(Expires in ${timeLeftMins} min)</span>`;
        }

        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.background = '#18181b';
        div.style.padding = '10px';
        div.style.marginBottom = '5px';
        div.style.borderRadius = '4px';
        div.style.border = '1px solid #3f3f46';
        
        div.innerHTML = `
          <span><strong>${type}:</strong> <span style="color: #bf94ff;">${name}</span>${extraText}</span>
          <button class="save-btn" style="background-color: #ff4a4a; padding: 4px 10px; margin: 0; font-size: 12px;" onclick="unblacklist('${key}')">Remove</button>
        `;
        list.appendChild(div);
      }
    }
    
    if (!hasItems) {
      list.innerHTML = '<p style="color: #888; margin: 0; font-style: italic;">No specific playsounds or emotes are blacklisted.</p>';
    }
  }

  window.unblacklist = async function(key) {
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: '' })
      });
      const data = await res.json();
      if (data.success) {
        loadConfig();
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  }

  // Handle saving Global and Command config
  document.querySelectorAll('.save-global-btn, .save-commands-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const inputs = document.querySelectorAll('input[data-key]');
      const updatesArray = [];
      inputs.forEach(input => {
        let val = input.value;
        if (input.type === 'checkbox') {
          val = input.checked ? 'true' : 'false';
        }
        updatesArray.push({ key: input.dataset.key, value: val });
      });

      const statusEl = document.getElementById('status');
      statusEl.textContent = 'Saving...';
      statusEl.className = '';

      try {
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: updatesArray })
        });
        const data = await res.json();
        if (data.success) {
          statusEl.textContent = 'Changes saved successfully!';
          statusEl.className = 'success';
          setTimeout(() => statusEl.textContent = '', 3000);
        } else {
          statusEl.textContent = 'Error saving changes.';
          statusEl.className = 'error';
        }
      } catch (e) {
        statusEl.textContent = 'Network error.';
        statusEl.className = 'error';
      }
    });
  });

  // Custom Commands
  document.getElementById('saveCustomCmdBtn').addEventListener('click', async () => {
    const cmd = document.getElementById('customCmdName').value;
    const cost = document.getElementById('customCmdCost').value;
    const action = document.getElementById('customCmdAction').value;
    if (!cmd || !action) return alert('Command and Action are required.');
    
    try {
      const res = await fetch('/api/admin/custom-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, cost, action })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('customCmdName').value = '';
        document.getElementById('customCmdCost').value = '';
        document.getElementById('customCmdAction').value = '';
        loadCustomCommands();
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  // User Management
  document.getElementById('updatePointsBtn').addEventListener('click', async () => {
    const user = document.getElementById('editUsername').value;
    const points = document.getElementById('editPoints').value;
    if (!user || points === '') return alert('Username and Points are required.');

    try {
      const res = await fetch('/api/admin/users/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, points })
      });
      const data = await res.json();
      if (data.success) {
        alert('Points updated successfully!');
        document.getElementById('editUsername').value = '';
        document.getElementById('editPoints').value = '';
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  // System Actions
  document.getElementById('playSoundBtn').addEventListener('click', () => {
    const sound = document.getElementById('deleteSoundName').value;
    if (!sound) return alert('Sound name required.');
    
    // Try .ogg first, then .mp3 if it fails
    const audio = new Audio(`/playsounds/${encodeURIComponent(sound)}.ogg`);
    audio.play().catch(() => {
      const audioMp3 = new Audio(`/playsounds/${encodeURIComponent(sound)}.mp3`);
      audioMp3.play().catch(() => {
        alert('Could not play sound. It might not exist or the browser blocked it.');
      });
    });
  });

  document.getElementById('deleteSoundBtn').addEventListener('click', async () => {
    const sound = document.getElementById('deleteSoundName').value;
    if (!sound) return alert('Sound name required.');
    
    if (!confirm(`Are you sure you want to PERMANENTLY delete the sound '${sound}'?`)) return;

    try {
      const res = await fetch('/api/admin/playsounds/' + encodeURIComponent(sound), {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        alert('Sound deleted successfully!');
        document.getElementById('deleteSoundName').value = '';
        loadPlaysoundsForAutocomplete(); // Refresh list
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('blacklistPlaysoundBtn').addEventListener('click', async () => {
    const item = document.getElementById('blacklistPlaysoundInput').value;
    const duration = document.getElementById('blacklistPlaysoundDuration').value;
    if (!item) return alert('Playsound name required.');
    
    let disableValue = 'true';
    if (duration && parseInt(duration) > 0) {
      disableValue = (Date.now() + parseInt(duration)).toString();
    }

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ['disabled_playsound_' + item]: disableValue })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('blacklistPlaysoundInput').value = '';
        document.getElementById('blacklistPlaysoundDuration').value = '';
        loadConfig();
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('blacklistEmoteBtn').addEventListener('click', async () => {
    const item = document.getElementById('blacklistEmoteInput').value;
    const duration = document.getElementById('blacklistEmoteDuration').value;
    if (!item) return alert('Emote name required.');

    let disableValue = 'true';
    if (duration && parseInt(duration) > 0) {
      disableValue = (Date.now() + parseInt(duration)).toString();
    }

    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ['disabled_emote_' + item]: disableValue })
      });
      const data = await res.json();
      if (data.success) {
        document.getElementById('blacklistEmoteInput').value = '';
        document.getElementById('blacklistEmoteDuration').value = '';
        loadConfig();
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('massAddBtn').addEventListener('click', async () => {
    const amount = document.getElementById('massAddAmount').value;
    const timeStr = document.getElementById('massAddTime').value;
    if (!amount) return alert('Amount required.');
    try {
      const res = await fetch('/api/admin/masspointsadd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, timeStr })
      });
      const data = await res.json();
      if (data.success) {
        alert('Mass points added!');
        document.getElementById('massAddAmount').value = '';
        document.getElementById('massAddTime').value = '';
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('massSubBtn').addEventListener('click', async () => {
    const amount = document.getElementById('massSubAmount').value;
    const timeStr = document.getElementById('massSubTime').value;
    if (!amount) return alert('Amount required.');
    try {
      const res = await fetch('/api/admin/masspointssub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, timeStr })
      });
      const data = await res.json();
      if (data.success) {
        alert('Mass points subtracted!');
        document.getElementById('massSubAmount').value = '';
        document.getElementById('massSubTime').value = '';
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('disableCmdBtn').addEventListener('click', async () => {
    const command = document.getElementById('disableCmdName').value;
    const duration = document.getElementById('disableDuration').value;
    if (!command) return alert('Command required.');

    try {
      const res = await fetch('/api/admin/commands/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, durationMs: parseInt(duration, 10) || 0 })
      });
      const data = await res.json();
      if (data.success) {
        alert('Command disabled!');
        document.getElementById('disableCmdName').value = '';
        document.getElementById('disableDuration').value = '';
        loadConfig(); // Refresh dashboard
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('enableCmdBtn').addEventListener('click', async () => {
    const command = document.getElementById('enableCmdName').value;
    if (!command) return alert('Command required.');

    try {
      const res = await fetch('/api/admin/commands/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.success) {
        alert('Command enabled!');
        document.getElementById('enableCmdName').value = '';
        loadConfig(); // Refresh dashboard
      } else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  document.getElementById('clearOverlayBtn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to completely clear the overlay?')) return;
    try {
      const res = await fetch('/api/admin/actions/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) alert('Overlay cleared successfully!');
      else alert('Error: ' + data.error);
    } catch (e) { alert(e.message); }
  });

  // Tab Logic
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(btn.dataset.target).classList.add('active');
    });
  });

  // Initialize
  loadConfig();

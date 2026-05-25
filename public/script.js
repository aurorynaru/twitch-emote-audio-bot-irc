let durationMs = 5000;
let sizePx = 150;


fetch('/api/config')
  .then(res => res.json())
  .then(data => {
    durationMs = data.durationMs;
    sizePx = data.sizePx;

    const eventSource = new EventSource('/api/stream-emotes');

    eventSource.onmessage = function(event) {
      const parsedData = JSON.parse(event.data);
      if (parsedData.type === 'audio') {
        const audio = new Audio('/playsounds/' + parsedData.file);
        audio.play().catch(err => console.error("Error playing audio:", err));
      } else if (parsedData.type === 'bet_update') {
        updateBetUI(parsedData.bet);
      } else if (parsedData.type === 'bet_clear') {
        clearBetUI(parsedData.result);
      } else if (parsedData.type === 'chatwar_update') {
        updateChatWarUI(parsedData.war);
      } else if (parsedData.type === 'chatwar_clear') {
        clearChatWarUI(parsedData.winner);
      } else if (parsedData.type === 'config_update') {
        durationMs = parsedData.durationMs;
        sizePx = parsedData.sizePx;
      } else if (parsedData.type === 'emote') {
        const emoteUrl = parsedData.url;
        const isZeroWidth = parsedData.isZeroWidth || false;
        const messageId = parsedData.messageId || null;
        const customX = parsedData.customX !== undefined ? parsedData.customX : null;
        const customY = parsedData.customY !== undefined ? parsedData.customY : null;

        displayEmote(emoteUrl, isZeroWidth, messageId, customX, customY);
      }
    };
  })
  .catch(err => {
    console.error("Failed to load config, using defaults.", err);
  });
    
let lastMessageId = null;
let lastEmoteX = null;
let lastEmoteY = null;

function displayEmote(url, isZeroWidth = false, messageId = null, customX = null, customY = null) {
  const img = document.createElement('img');
  img.src = url;
  img.classList.add('emote-img');
  
 
  img.style.setProperty('--duration', `${durationMs}ms`);


  img.style.height = `${sizePx}px`;
  img.style.width = 'auto'; 

  let x, y;
  const margin = sizePx; 
  
  if (customX !== null && customY !== null) {

    x = (customX / 100) * (window.innerWidth - margin);
    y = (customY / 100) * (window.innerHeight - margin);
    img.style.zIndex = '5'; 
    
    lastMessageId = messageId;
    lastEmoteX = x;
    lastEmoteY = y;
  } else if (isZeroWidth && lastMessageId === messageId && lastEmoteX !== null && lastEmoteY !== null) {
   
    x = lastEmoteX;
    y = lastEmoteY;
 
    img.style.zIndex = '10';
  } else {

    x = Math.random() * (window.innerWidth - margin);
    y = Math.random() * (window.innerHeight - margin);
    
 
    lastMessageId = messageId;
    lastEmoteX = x;
    lastEmoteY = y;
    img.style.zIndex = '1';
  }
  
  img.style.left = `${x}px`;
  img.style.top = `${y}px`;

  document.body.appendChild(img);

 
  setTimeout(() => {
    if (img.parentNode) {
      img.parentNode.removeChild(img);
    }
  }, durationMs);
}

function formatPoints(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

let betTimerInterval = null;

function clearBetUI(resultData = null) {
  if (betTimerInterval) {
    clearInterval(betTimerInterval);
    betTimerInterval = null;
  }
  
  if (resultData) {
    document.getElementById('bet-container').classList.add('visible');
    const choiceAIsWinner = resultData.choiceA === resultData.winningChoice;

    const createScrollOverlay = (containerId, titleId, pctId, pointsId, users, isWinner) => {

      const t = document.getElementById(titleId);
      const p = document.getElementById(pctId);
      const pts = document.getElementById(pointsId).parentElement;
      
      t.style.transition = 'opacity 0.5s ease';
      p.style.transition = 'opacity 0.5s ease';
      pts.style.transition = 'opacity 0.5s ease';
      
      t.style.opacity = '0';
      p.style.opacity = '0';
      pts.style.opacity = '0';

      const container = document.getElementById(containerId);
      const scrollOverlay = document.createElement('div');
      scrollOverlay.className = 'scroll-container';
      
      const scrollContent = document.createElement('div');
      scrollContent.className = 'scroll-content';
      
      const textColorClass = isWinner ? 'scroll-item-winner' : 'scroll-item-loser';
      
      users.forEach(u => {
        const div = document.createElement('div');
        div.className = textColorClass + ' scroll-row';
        const ptsRaw = isWinner ? u.won : u.lost;
        const pointsStr = isWinner ? `+${formatPoints(ptsRaw)}` : `-${formatPoints(ptsRaw)}`;
        div.innerHTML = `<span class="scroll-name">${u.user}</span><span class="scroll-pts">${pointsStr}</span>`;
        scrollContent.appendChild(div);
      });

      scrollOverlay.appendChild(scrollContent);
      container.appendChild(scrollOverlay);
      return scrollOverlay;
    };

    let overlayA, overlayB;
    if (choiceAIsWinner) {
      overlayA = createScrollOverlay('choice-a-container', 'choice-a-name', 'choice-a-pct', 'choice-a-points', resultData.winners, true);
      overlayB = createScrollOverlay('choice-b-container', 'choice-b-name', 'choice-b-pct', 'choice-b-points', resultData.losers, false);
    } else {
      overlayA = createScrollOverlay('choice-a-container', 'choice-a-name', 'choice-a-pct', 'choice-a-points', resultData.losers, false);
      overlayB = createScrollOverlay('choice-b-container', 'choice-b-name', 'choice-b-pct', 'choice-b-points', resultData.winners, true);
    }

    setTimeout(() => {
      document.getElementById('bet-container').classList.remove('visible');
 
      setTimeout(() => {
        if (overlayA) overlayA.remove();
        if (overlayB) overlayB.remove();
        
        ['choice-a-name', 'choice-a-pct', 'choice-b-name', 'choice-b-pct'].forEach(id => {
          const el = document.getElementById(id);
          el.style.transition = '';
          el.style.opacity = '1';
        });
        
        ['choice-a-points', 'choice-b-points'].forEach(id => {
          const el = document.getElementById(id).parentElement;
          el.style.transition = '';
          el.style.opacity = '1';
        });
      }, 600);
    }, 6000);
    
  } else {
    document.getElementById('bet-container').classList.remove('visible');
  }
}

function startTimerAnimation(endTime, durationMs) {
  if (betTimerInterval) clearInterval(betTimerInterval);
  const bar = document.getElementById('timer-bar-fill');
  const bg = document.querySelector('.timer-bar-bg');
  
  if (!endTime || !durationMs) {
    bg.style.display = 'none';
    return;
  }
  
  bg.style.display = 'block';

  betTimerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = endTime - now;
    if (remaining <= 0) {
      bar.style.width = '0%';
      clearInterval(betTimerInterval);
      return;
    }
    const pct = (remaining / durationMs) * 100;
    bar.style.width = Math.max(0, pct) + '%';
    

    const hue = (pct / 100) * 120;
    bar.style.backgroundColor = `hsl(${hue}, 100%, 35%)`;
  }, 50);
}

function updateBetUI(bet) {
  if (!bet || !bet.choices || bet.choices.length < 2) return;
  
  const container = document.getElementById('bet-container');
  container.classList.add('visible');

  document.getElementById('bet-title').innerText = bet.description;
  
  startTimerAnimation(bet.endTime, bet.durationMs);

  const choiceA = bet.choices[0];
  const choiceB = bet.choices[1];

  document.getElementById('bet-bar').style.width = choiceA.percentage + '%';


  document.getElementById('choice-a-name').innerText = choiceA.name;
  document.getElementById('choice-a-pct').innerText = choiceA.percentage + '%';
  document.getElementById('choice-a-points').innerText = formatPoints(choiceA.totalPoints);


  document.getElementById('choice-b-name').innerText = choiceB.name;
  document.getElementById('choice-b-pct').innerText = choiceB.percentage + '%';
  document.getElementById('choice-b-points').innerText = formatPoints(choiceB.totalPoints);
}

let chatWarTimerInterval = null;

function clearChatWarUI(winnerData = null) {
  if (chatWarTimerInterval) {
    clearInterval(chatWarTimerInterval);
    chatWarTimerInterval = null;
  }

  if (winnerData) {
    const container = document.getElementById('chatwar-container');
    const name1 = document.getElementById('chatwar-name1').innerText;
    
    let winnerImgEl, loserImgEl, winnerScoreEl, loserScoreEl, winnerNameEl, loserNameEl;
    if (winnerData.emote === name1) {
      winnerImgEl = document.getElementById('chatwar-img1');
      loserImgEl = document.getElementById('chatwar-img2');
      winnerNameEl = document.getElementById('chatwar-name1');
      loserNameEl = document.getElementById('chatwar-name2');
      winnerScoreEl = document.getElementById('chatwar-score1');
      loserScoreEl = document.getElementById('chatwar-score2');
    } else {
      winnerImgEl = document.getElementById('chatwar-img2');
      loserImgEl = document.getElementById('chatwar-img1');
      winnerNameEl = document.getElementById('chatwar-name2');
      loserNameEl = document.getElementById('chatwar-name1');
      winnerScoreEl = document.getElementById('chatwar-score2');
      loserScoreEl = document.getElementById('chatwar-score1');
    }

    const targetEl = winnerImgEl.style.display !== 'none' ? winnerImgEl : winnerNameEl;


    setTimeout(() => {

      const fadeElements = [loserImgEl, loserNameEl, winnerScoreEl, loserScoreEl, document.getElementById('chatwar-bar').parentElement];
      fadeElements.forEach(el => {
        if (el) el.style.transition = 'opacity 2s ease';
      });


      if (loserImgEl) loserImgEl.style.opacity = '0';
      if (loserNameEl) loserNameEl.style.opacity = '0';
      if (winnerScoreEl) winnerScoreEl.style.opacity = '0';
      if (loserScoreEl) loserScoreEl.style.opacity = '0';
      document.getElementById('chatwar-bar').parentElement.style.opacity = '0.3';


      const clone = targetEl.cloneNode(true);
      const elRect = targetEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      clone.style.position = 'absolute';
      clone.style.top = (elRect.top - containerRect.top) + 'px';
      clone.style.left = (elRect.left - containerRect.left) + 'px';
      clone.style.width = elRect.width + 'px';
      clone.style.height = elRect.height + 'px';
      clone.style.margin = '0';
      clone.style.zIndex = '100';
      clone.style.transition = 'all 2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; 
      
      container.appendChild(clone);
      targetEl.style.opacity = '0'; 

 
      setTimeout(() => {
        clone.style.top = '50%';
        clone.style.left = '50%';
        clone.style.transform = 'translate(-50%, -50%) scale(1.5)';
        
  
        setTimeout(() => {
          if (typeof confetti !== 'undefined') {

            const screenCenterX = containerRect.left + containerRect.width / 2;
            const screenCenterY = containerRect.top + containerRect.height / 2;
            confetti({
              particleCount: 150,
              spread: 80,
              origin: { 
                x: screenCenterX / window.innerWidth, 
                y: (screenCenterY / window.innerHeight) + 0.2 
              },
              zIndex: 9999,
              scalar: 0.5
            });
          }

        
          setTimeout(() => {
            container.style.opacity = '0';
    
            setTimeout(() => {
              if (clone.parentNode) clone.parentNode.removeChild(clone);
              if (targetEl) targetEl.style.opacity = '1';
              if (loserImgEl) { loserImgEl.style.transition = ''; loserImgEl.style.opacity = '1'; }
              if (loserNameEl) { loserNameEl.style.transition = ''; loserNameEl.style.opacity = '1'; }
              if (winnerScoreEl) { winnerScoreEl.style.transition = ''; winnerScoreEl.style.opacity = '1'; }
              if (loserScoreEl) { loserScoreEl.style.transition = ''; loserScoreEl.style.opacity = '1'; }
              const barParent = document.getElementById('chatwar-bar').parentElement;
              barParent.style.transition = '';
              barParent.style.opacity = '1';
            }, 600);
          }, 5000);
        }, 4000); 

      }, 50); 
    }, 1000); 

  } else {

    document.getElementById('chatwar-container').style.opacity = '0';
  }
}

function startChatWarTimerAnimation(endTime, durationMs) {
  if (chatWarTimerInterval) clearInterval(chatWarTimerInterval);
  const bar = document.getElementById('chatwar-timer');
  
  if (!endTime || !durationMs) return;

  chatWarTimerInterval = setInterval(() => {
    const now = Date.now();
    const remaining = endTime - now;
    if (remaining <= 0) {
      bar.style.width = '0%';
      clearInterval(chatWarTimerInterval);
      return;
    }
    const pct = (remaining / durationMs) * 100;
    bar.style.width = Math.max(0, pct) + '%';
  }, 50);
}

function updateChatWarUI(war) {
  if (!war) return;
  const container = document.getElementById('chatwar-container');
  container.style.display = 'block';
  setTimeout(() => container.style.opacity = '1', 10);
  
  startChatWarTimerAnimation(war.endTime, war.durationMs);

  const img1 = document.getElementById('chatwar-img1');
  const img2 = document.getElementById('chatwar-img2');
  const name1 = document.getElementById('chatwar-name1');
  const name2 = document.getElementById('chatwar-name2');

  name1.innerText = war.emote1;
  name2.innerText = war.emote2;

  if (war.emoteUrl1) {
    img1.src = war.emoteUrl1;
    img1.style.display = 'block';
    name1.style.display = 'none';
  } else {
    img1.style.display = 'none';
    name1.style.display = 'block';
  }

  if (war.emoteUrl2) {
    img2.src = war.emoteUrl2;
    img2.style.display = 'block';
    name2.style.display = 'none';
  } else {
    img2.style.display = 'none';
    name2.style.display = 'block';
  }

  document.getElementById('chatwar-score1').innerText = formatPoints(war.score1 * war.cost);
  document.getElementById('chatwar-score2').innerText = formatPoints(war.score2 * war.cost);

  const totalScore = war.score1 + war.score2;
  const percentage = totalScore > 0 ? (war.score1 / totalScore) * 100 : 50;
  
  document.getElementById('chatwar-bar').style.width = percentage + '%';

 
  let scale1 = 1.0;
  let scale2 = 1.0;
  if (totalScore > 0) {
    
    scale1 = 0.7 + (percentage / 100) * 0.8;
    scale2 = 1.5 - (percentage / 100) * 0.8;
  }
  
  img1.style.transform = `scale(${scale1})`;
  img2.style.transform = `scale(${scale2})`;
}

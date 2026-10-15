const player = document.getElementById('player');
const playerWrapper = document.getElementById('player-wrapper');
const appContainer = document.getElementById('app-container');
const controlsBar = document.getElementById('controls-bar');
const playerHeader = document.getElementById('player-header');
const scrubber = document.getElementById('scrubber');
const scrubberFill = document.getElementById('scrubber-fill');
const scrubberHover = document.getElementById('scrubber-hover');
const timeDisplay = document.getElementById('time-display');

const btnPlayPause = document.getElementById('btn-playpause');
const btnSkipBack = document.getElementById('btn-skipback');
const btnSkipFwd = document.getElementById('btn-skipfwd');
const btnMute = document.getElementById('btn-mute');
const volumeSlider = document.getElementById('volume-slider');
const btnCC = document.getElementById('btn-cc');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnChatToggle = document.getElementById('btn-chat');
const btnChangeMedia = document.getElementById('btn-change-media');

const chatPanel = document.getElementById('chat-panel');
const btnCloseChat = document.getElementById('btn-close-chat');
const chatFeed = document.getElementById('chatFeed');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const shareBtn = document.getElementById('shareBtn');
const reactionBtns = document.querySelectorAll('.reaction-btn');

let ws;
let isRemoteUpdate = false;
let username = '';
let idleTimer;

// Modal Logic
const joinModal = document.getElementById('joinModal');
const joinForm = document.getElementById('joinForm');
const usernameInput = document.getElementById('usernameInput');
const savedUsername = localStorage.getItem('cinesync_username');
if (savedUsername) usernameInput.value = savedUsername;

joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = usernameInput.value.trim();
  if (name) {
    username = name;
    localStorage.setItem('cinesync_username', username);
    joinModal.style.display = 'none';
    initWebSocket();
  }
});

player.src = '/video';
player.controls = false;

// Idle Control Hiding
function resetIdleTimer() {
  controlsBar.style.opacity = '1';
  playerHeader.style.opacity = '1';
  appContainer.style.cursor = 'default';
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!player.paused) {
      controlsBar.style.opacity = '0';
      playerHeader.style.opacity = '0';
      appContainer.style.cursor = 'none';
    }
  }, 2500);
}
appContainer.addEventListener('mousemove', resetIdleTimer);
appContainer.addEventListener('click', resetIdleTimer);
appContainer.addEventListener('keydown', resetIdleTimer);

// Format Time
function formatTime(sec) {
  if (isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// Scrubber Logic
player.addEventListener('timeupdate', () => {
  timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
  const pct = (player.currentTime / player.duration) * 100 || 0;
  scrubberFill.style.width = `${pct}%`;
});
scrubber.addEventListener('mousemove', (e) => {
  const rect = scrubber.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  scrubberHover.style.left = `${pos * 100}%`;
  scrubberHover.textContent = formatTime(pos * player.duration);
});
scrubber.addEventListener('click', (e) => {
  const rect = scrubber.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  player.currentTime = pos * player.duration;
  broadcastSync('SEEK');
});

// Controls
btnPlayPause.addEventListener('click', () => { player.paused ? player.play() : player.pause(); });
player.addEventListener('play', () => { btnPlayPause.textContent = '⏸'; broadcastSync('PLAY'); resetIdleTimer(); });
player.addEventListener('pause', () => { btnPlayPause.textContent = '▶'; broadcastSync('PAUSE'); resetIdleTimer(); });

btnSkipBack.addEventListener('click', () => { player.currentTime -= 10; broadcastSync('SEEK'); });
btnSkipFwd.addEventListener('click', () => { player.currentTime += 10; broadcastSync('SEEK'); });

btnMute.addEventListener('click', () => {
  player.muted = !player.muted;
  btnMute.textContent = player.muted || player.volume === 0 ? '🔇' : '🔊';
  if(!player.muted && player.volume === 0) { player.volume = 0.5; volumeSlider.value = 0.5; }
});
volumeSlider.addEventListener('input', (e) => {
  player.volume = e.target.value;
  player.muted = player.volume === 0;
  btnMute.textContent = player.muted ? '🔇' : '🔊';
});

btnCC.addEventListener('click', () => {
  const track = player.textTracks[0];
  if (track) {
    track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
    btnCC.style.opacity = track.mode === 'showing' ? '1' : '0.5';
  }
});
btnCC.style.opacity = '1';

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    appContainer.requestFullscreen().catch(console.error);
  } else {
    document.exitFullscreen();
  }
}
btnFullscreen.addEventListener('click', toggleFullscreen);

playerWrapper.addEventListener('click', (e) => {
  if (e.target === playerWrapper || e.target === player) {
    if (player.paused) {
      player.play();
    } else {
      player.pause();
    }
    resetIdleTimer();
  }
});

// Chat Toggle
function toggleChat() {
  chatPanel.style.display = chatPanel.style.display === 'none' ? 'flex' : 'none';
}
btnChatToggle.addEventListener('click', toggleChat);
btnCloseChat.addEventListener('click', toggleChat);

shareBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/share-url');
    const data = await res.json();
    if (data.url) {
      await navigator.clipboard.writeText(data.url);
      shareBtn.textContent = 'Copied!';
      setTimeout(() => shareBtn.textContent = 'Share Link', 2000);
    }
  } catch (err) {}
});

if (btnChangeMedia) {
  btnChangeMedia.addEventListener('click', async () => {
    const ok = confirm("Are you sure you want to change the movie? This will interrupt playback for everyone.");
    if (ok) {
      try {
        await fetch('/api/reset-party', { method: 'POST' });
      } catch (err) {
        console.error('Reset party failed', err);
      }
      window.location.href = '/';
    }
  });
}

// Websocket
function initWebSocket() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'USER_JOIN', username }));
    ws.send(JSON.stringify({ type: 'REQUEST_STATE' }));
  };
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'SYNC_ACTION') {
      isRemoteUpdate = true;
      const drift = Math.abs(player.currentTime - data.payload.currentTime);
      if (drift > 0.5 || data.payload.action === 'SEEK') player.currentTime = data.payload.currentTime;
      if (data.payload.action === 'PLAY' && player.paused) player.play().catch(e=>console.warn(e));
      else if (data.payload.action === 'PAUSE' && !player.paused) player.pause();
      setTimeout(() => isRemoteUpdate = false, 200);
    } else if (data.type === 'CHAT_MESSAGE') {
      appendChatMessage(data);
    } else if (data.type === 'SYSTEM_MESSAGE') {
      const div = document.createElement('div');
      div.className = 'system-msg';
      div.textContent = data.text;
      chatFeed.appendChild(div);
      chatFeed.scrollTop = chatFeed.scrollHeight;
    } else if (data.type === 'USER_COUNT') {
      const b = document.getElementById('userCountBadge');
      if (b) b.textContent = `(${data.count} online)`;
    } else if (data.type === 'REACTION') {
      spawnFloatingEmoji(data.emoji);
    } else if (data.type === 'MEDIA_CHANGING') {
      player.pause();
      const overlay = document.getElementById('mediaChangingOverlay');
      if (overlay) {
        overlay.style.display = 'flex';
      }
    } else if (data.type === 'MEDIA_READY') {
      window.location.reload(true);
    }
  };
}

function broadcastSync(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN || isRemoteUpdate) return;
  ws.send(JSON.stringify({ type: 'SYNC_ACTION', payload: { action, currentTime: player.currentTime } }));
}

function appendChatMessage(data) {
  const div = document.createElement('div');
  div.className = 'msg';
  const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<div class="msg-header">${data.username} &bull; ${timeStr}</div><div class="msg-body">${data.text}</div>`;
  chatFeed.appendChild(div);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

sendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text, username, timestamp: Date.now() }));
    chatInput.value = '';
  }
});
chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendBtn.click(); });

// Reactions
reactionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.textContent;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'REACTION', emoji }));
  });
});

function spawnFloatingEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.textContent = emoji;
  const drift = (Math.random() - 0.5) * 100;
  el.style.setProperty('--drift', `${drift}px`);
  playerWrapper.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// Shortcuts
document.addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  
  switch(e.code) {
    case 'Space': e.preventDefault(); player.paused ? player.play() : player.pause(); break;
    case 'ArrowRight': player.currentTime += 10; broadcastSync('SEEK'); break;
    case 'ArrowLeft': player.currentTime -= 10; broadcastSync('SEEK'); break;
    case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
    case 'KeyC': e.preventDefault(); toggleChat(); break;
    case 'KeyM': e.preventDefault(); btnMute.click(); break;
  }
});

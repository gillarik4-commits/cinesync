const player = document.getElementById('player');
const shareBtn = document.getElementById('shareBtn');
const chatFeed = document.getElementById('chatFeed');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');

let ws;
let isRemoteUpdate = false;
let username = '';

const joinModal = document.getElementById('joinModal');
const joinForm = document.getElementById('joinForm');
const usernameInput = document.getElementById('usernameInput');

const savedUsername = localStorage.getItem('cinesync_username');
if (savedUsername) {
  usernameInput.value = savedUsername;
}

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
// Initialize player source
player.src = '/video';

shareBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/share-url');
    const data = await res.json();
    if (data.url) {
      await navigator.clipboard.writeText(data.url);
      shareBtn.textContent = 'Copied!';
      setTimeout(() => shareBtn.textContent = 'Share Link', 2000);
    }
  } catch (err) {
    console.error('Share failed', err);
  }
});

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
      
      if (drift > 0.5 || data.payload.action === 'SEEK') {
        player.currentTime = data.payload.currentTime;
      }
      
      if (data.payload.action === 'PLAY' && player.paused) {
        player.play().catch(e => console.warn('Autoplay blocked:', e));
      } else if (data.payload.action === 'PAUSE' && !player.paused) {
        player.pause();
      }
      
      setTimeout(() => isRemoteUpdate = false, 200);
    } else if (data.type === 'CHAT_MESSAGE') {
      const div = document.createElement('div');
      div.className = 'msg';
      const timeStr = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      div.textContent = `[${timeStr}] ${data.username}: ${data.text}`;
      chatFeed.appendChild(div);
      chatFeed.scrollTop = chatFeed.scrollHeight;
    } else if (data.type === 'SYSTEM_MESSAGE') {
      const div = document.createElement('div');
      div.className = 'msg';
      div.style.color = '#10b981';
      div.style.fontStyle = 'italic';
      div.textContent = data.text;
      chatFeed.appendChild(div);
      chatFeed.scrollTop = chatFeed.scrollHeight;
    } else if (data.type === 'USER_COUNT') {
      const badge = document.getElementById('userCountBadge');
      if (badge) badge.textContent = `(${data.count} online)`;
    }
  };
}

function broadcastSync(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN || isRemoteUpdate) return;
  ws.send(JSON.stringify({
    type: 'SYNC_ACTION',
    payload: { action, currentTime: player.currentTime }
  }));
}

player.addEventListener('play', () => broadcastSync('PLAY'));
player.addEventListener('pause', () => broadcastSync('PAUSE'));
player.addEventListener('seeked', () => broadcastSync('SEEK'));

// Chat logic
sendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (text && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', text, username, timestamp: Date.now() }));
    chatInput.value = '';
  }
});
chatInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendBtn.click();
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

  if (e.code === 'Space') {
    e.preventDefault();
    player.paused ? player.play() : player.pause();
  } else if (e.code === 'ArrowRight') {
    player.currentTime += 10;
  } else if (e.code === 'ArrowLeft') {
    player.currentTime -= 10;
  } else if (e.code === 'KeyF') {
    if (!document.fullscreenElement) {
      player.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen();
    }
  }
});

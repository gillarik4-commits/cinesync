const inspectBtn = document.getElementById('inspectBtn');
const startBtn = document.getElementById('startBtn');
let ws;

inspectBtn.addEventListener('click', async () => {
  const filePath = document.getElementById('filepath').value.trim();
  if (!filePath) return alert('Enter file path');

  inspectBtn.disabled = true;
  inspectBtn.textContent = 'Inspecting...';

  try {
    const res = await fetch(`/api/inspect?filePath=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const audioSelect = document.getElementById('audioTrack');
    const subSelect = document.getElementById('subTrack');

    audioSelect.innerHTML = data.audio.map(a => `<option value="${a.index}">${a.label}</option>`).join('');
    subSelect.innerHTML = `<option value="none">None</option>` + data.subtitle.map(s => `<option value="${s.index}">${s.label}</option>`).join('');

    document.getElementById('trackSelection').style.display = 'block';
    
    // Connect websocket to listen for progress
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    ws.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      if (ev.type === 'TRANSCODE_PROGRESS') {
        document.getElementById('progressFill').style.width = Math.min(100, Math.max(0, ev.percent || 0)) + '%';
      } else if (ev.type === 'TRANSCODE_COMPLETE') {
        window.location.href = '/watch.html';
      }
    };
  } catch (err) {
    alert(err.message);
  } finally {
    inspectBtn.disabled = false;
    inspectBtn.textContent = 'Inspect';
  }
});

startBtn.addEventListener('click', async () => {
  const filePath = document.getElementById('filepath').value.trim();
  startBtn.disabled = true;
  document.getElementById('progressBarContainer').style.display = 'block';

  try {
    await fetch('/api/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath,
        audioIndex: document.getElementById('audioTrack').value,
        subIndex: document.getElementById('subTrack').value
      })
    });
  } catch (err) {
    alert('Failed to start');
    startBtn.disabled = false;
  }
});

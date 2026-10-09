const WebSocket = require('ws');

let wss = null;
let roomState = {
  currentVideoTime: 0,
  isPlaying: false,
  lastUpdated: Date.now()
};

function init(server) {
  wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'REQUEST_STATE') {
          let interpolatedTime = roomState.currentVideoTime;
          if (roomState.isPlaying) {
            interpolatedTime += (Date.now() - roomState.lastUpdated) / 1000;
          }
          ws.send(JSON.stringify({
            type: 'SYNC_ACTION',
            payload: { currentTime: interpolatedTime, action: roomState.isPlaying ? 'PLAY' : 'PAUSE' }
          }));
        } 
        else if (data.type === 'SYNC_ACTION') {
          roomState.currentVideoTime = data.payload.currentTime;
          roomState.isPlaying = (data.payload.action === 'PLAY');
          roomState.lastUpdated = Date.now();
          
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'SYNC_ACTION', payload: data.payload }));
            }
          });
        }
        else if (data.type === 'CHAT_MESSAGE') {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify(data));
            }
          });
        }
      } catch (e) {
        console.error('Socket message error', e);
      }
    });
  });
}

function getWss() {
  return wss;
}

module.exports = { init, getWss };

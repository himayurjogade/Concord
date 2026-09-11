const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const syncRoutes = require('./routes/sync');
const { relaySignal } = require('./signaling/webrtc-relay');
const { pollCluster, callLeader } = require('./cluster');

const PORT = Number(process.env.PORT || 4000);

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', syncRoutes);
app.get('/', (_req, res) => res.send('concord gateway is running, websocket at /ws'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Map();

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const socket of clients.values()) {
    if (socket.readyState === 1) socket.send(data);
  }
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

wss.on('connection', async (socket) => {
  const clientId = 'u-' + crypto.randomUUID().slice(0, 4);
  clients.set(clientId, socket);
  console.log(`[gateway] ${clientId} connected, ${clients.size} online`);

  try {
    const state = await callLeader('getState');
    send(socket, { type: 'init', clientId, ...state });
  } catch (err) {
    send(socket, {
      type: 'init',
      clientId,
      text: '',
      version: 0,
      lamport: 0,
      vectorClock: {},
      log: [],
      conflicts: [],
      warning: err.message,
    });
  }

  broadcast({ type: 'peers', peers: [...clients.keys()] });

  socket.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'edit') {
      try {
        const result = await callLeader('submitEdit', {
          clientId,
          op: msg.op,
          lamport: msg.lamport,
          vectorClock: msg.vectorClock,
        });
        broadcast({ type: 'update', ...result });
      } catch (err) {
        send(socket, { type: 'error', message: err.message });
      }
      return;
    }

    if (msg.type === 'signal') {
      relaySignal(clients, clientId, msg);
      return;
    }

    if (msg.type === 'resync') {
      try {
        send(socket, { type: 'resync', ...(await callLeader('getState')) });
      } catch (err) {
        send(socket, { type: 'error', message: err.message });
      }
    }
  });

  socket.on('close', () => {
    clients.delete(clientId);
    broadcast({ type: 'peers', peers: [...clients.keys()] });
    console.log(`[gateway] ${clientId} disconnected, ${clients.size} online`);
  });
});

setInterval(async () => {
  if (clients.size === 0) return;
  try {
    broadcast({ type: 'cluster', ...(await pollCluster()) });
  } catch {
    // next poll is one second away
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`[gateway] listening on http://localhost:${PORT}`);
  console.log(`[gateway] websocket at ws://localhost:${PORT}/ws`);
  pollCluster().then((s) => console.log(`[gateway] leader: ${s.leaderId || 'none yet'}`));
});

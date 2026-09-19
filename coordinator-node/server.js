const express = require('express');
const cors = require('cors');

const LeaderElection = require('./election/leaderElection');
const { startBeacon } = require('./heartbeat/beacon');
const docState = require('./state/documentState');
const { snapshot, applySnapshot, collectGlobalState } = require('./state/globalStateSync');

const NODE_ID = process.env.NODE_ID || 'node-1';
const PORT = Number(process.env.PORT || 5001);
const SELF_URL = `http://localhost:${PORT}`;

const PEERS = (process.env.PEERS || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
  .map((url) => ({ url }));

// simulated crash, so the kill-leader demo is repeatable without restarting
let dead = false;

const election = new LeaderElection({
  nodeId: NODE_ID,
  peers: PEERS,
  getVersion: () => docState.doc.version,
  onBecomeLeader: () => console.log(`[${NODE_ID}] i am the leader, term ${election.term}`),
});

startBeacon({
  election,
  peers: PEERS,
  buildSnapshot: () => snapshot(docState.doc),
});

const methods = {
  status: () => ({
    nodeId: NODE_ID,
    url: SELF_URL,
    role: election.role,
    term: election.term,
    leaderId: election.leaderId,
    version: docState.doc.version,
    lamport: docState.doc.lamport.value,
    vectorClock: docState.doc.vectorClock,
  }),

  requestVote: (params) => election.handleVoteRequest(params),

  beacon: (params) => {
    const reply = election.handleBeacon(params);
    if (reply.ok && params.snapshot && applySnapshot(docState.doc, params.snapshot)) {
      docState.persist();
    }
    return reply;
  },

  getState: () => docState.getState(),

  submitEdit: (params) => {
    if (election.role !== 'leader') {
      throw new Error(`${NODE_ID} is not the leader, leader is ${election.leaderId || 'unknown'}`);
    }
    return docState.submitEdit(params);
  },

  globalState: () => collectGlobalState(methods.status(), docState.doc, PEERS),

  kill: () => {
    dead = true;
    election.role = 'dead';
    election.stop();
    console.log(`[${NODE_ID}] simulated crash`);
    return { nodeId: NODE_ID, dead: true };
  },

  revive: () => {
    dead = false;
    election.role = 'follower';
    election.votedFor = null;
    election.start();
    console.log(`[${NODE_ID}] recovered`);
    return { nodeId: NODE_ID, dead: false };
  },
};

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.post('/rpc', async (req, res) => {
  const { method, params = {} } = req.body || {};

  if (dead && method !== 'revive') {
    return res.status(503).json({ error: `${NODE_ID} is down` });
  }

  const procedure = methods[method];
  if (!procedure) {
    return res.status(400).json({ error: `unknown rpc method: ${method}` });
  }

  try {
    res.json({ result: await procedure(params) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ nodeId: NODE_ID, dead, role: election.role }));

app.listen(PORT, () => {
  console.log(`[${NODE_ID}] listening on ${SELF_URL}`);
  console.log(`[${NODE_ID}] peers: ${PEERS.map((p) => p.url).join(', ') || 'none'}`);
  if (docState.restore()) {
    console.log(`[${NODE_ID}] restored v${docState.doc.version} from ${docState.DATA_FILE}`);
  }
  election.start();
});

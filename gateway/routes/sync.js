const express = require('express');
const { rpc } = require('../rpc');
const { pollCluster, callLeader, getSnapshot } = require('../cluster');
const stats = require('../functions/stats');

const router = express.Router();

router.get('/cluster', async (_req, res) => {
  try {
    res.json(await pollCluster());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/document', async (_req, res) => {
  try {
    res.json(await callLeader('getState'));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// the function holds no state, the document is fetched from the stateful coordinators and passed in
router.get('/stats', async (_req, res) => {
  try {
    const { text } = await callLeader('getState');
    const out = await stats.handler({ text });
    res.status(out.statusCode).json(JSON.parse(out.body));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/edit', async (req, res) => {
  try {
    res.json(await callLeader('submitEdit', req.body));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.get('/global-state', async (_req, res) => {
  try {
    res.json(await callLeader('globalState'));
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

router.post('/node/kill', async (req, res) => {
  try {
    const out = await rpc(req.body.url, 'kill');
    await pollCluster();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/node/revive', async (req, res) => {
  try {
    const out = await rpc(req.body.url, 'revive');
    await pollCluster();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/leader', (_req, res) => res.json(getSnapshot()));

module.exports = router;

const express = require('express');
const { rpc } = require('../rpc');
const { pollCluster, callLeader, getSnapshot } = require('../cluster');

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

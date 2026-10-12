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

const STATS_URL = process.env.STATS_URL;

// runs on AWS Lambda when STATS_URL is set, falls back to the same function locally if unset or unreachable
async function runStats(text) {
  if (STATS_URL) {
    try {
      const r = await fetch(STATS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(3000),
      });
      if (r.ok) return { ...(await r.json()), ranOn: 'aws-lambda' };
    } catch {
      // fall through to the local copy
    }
  }
  const out = await stats.handler({ text });
  return { ...JSON.parse(out.body), ranOn: 'local' };
}

// the function holds no state, the document is fetched from the stateful coordinators and passed in
router.get('/stats', async (_req, res) => {
  try {
    const { text } = await callLeader('getState');
    res.json(await runStats(text));
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

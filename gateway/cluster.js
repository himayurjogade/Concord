const { rpc } = require('./rpc');

const NODES = (process.env.NODES || 'http://localhost:5001,http://localhost:5002,http://localhost:5003')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

let snapshot = { nodes: [], leader: null, leaderId: null, at: 0 };

async function pollCluster() {
  const nodes = await Promise.all(
    NODES.map(async (url) => {
      try {
        const status = await rpc(url, 'status', {}, 800);
        return { url, alive: true, ...status };
      } catch {
        return { url, alive: false, nodeId: url, role: 'unreachable' };
      }
    })
  );

  const leaderNode = nodes.find((n) => n.alive && n.role === 'leader');
  snapshot = {
    nodes,
    leader: leaderNode ? leaderNode.url : null,
    leaderId: leaderNode ? leaderNode.nodeId : null,
    at: Date.now(),
  };
  return snapshot;
}

async function callLeader(method, params) {
  if (!snapshot.leader) await pollCluster();
  if (!snapshot.leader) throw new Error('no leader elected yet, try again in a moment');

  try {
    return await rpc(snapshot.leader, method, params);
  } catch (err) {
    // leader may have died mid call, re-poll and retry once against the new one
    await pollCluster();
    if (!snapshot.leader) throw err;
    return rpc(snapshot.leader, method, params);
  }
}

function getSnapshot() {
  return snapshot;
}

module.exports = { NODES, pollCluster, callLeader, getSnapshot };

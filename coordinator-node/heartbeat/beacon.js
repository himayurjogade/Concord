const { rpc } = require('../rpc');

// must stay well under the 1500-3000ms election timeout
const BEACON_MS = 800;

function startBeacon({ election, peers, buildSnapshot }) {
  const handle = setInterval(() => {
    if (election.role !== 'leader') return;

    const payload = {
      term: election.term,
      leaderId: election.nodeId,
      snapshot: buildSnapshot(),
    };

    // fire and forget, a slow follower must never stall the leader
    for (const peer of peers) {
      rpc(peer.url, 'beacon', payload).catch(() => {});
    }
  }, BEACON_MS);

  return () => clearInterval(handle);
}

module.exports = { startBeacon, BEACON_MS };

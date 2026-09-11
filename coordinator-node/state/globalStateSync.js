const { rpc } = require('../rpc');
const { compare, format } = require('../clocks/vectorClock');

function snapshot(doc) {
  return {
    text: doc.text,
    version: doc.version,
    lamport: doc.lamport.value,
    vectorClock: doc.vectorClock,
    log: doc.log.slice(-80),
    conflicts: doc.conflicts.slice(-10),
  };
}

function applySnapshot(doc, snap) {
  if (!snap || snap.version < doc.version) return false;

  doc.text = snap.text;
  doc.version = snap.version;
  doc.lamport.time = Math.max(doc.lamport.time, snap.lamport);
  doc.vectorClock = snap.vectorClock;
  doc.log = snap.log;
  doc.conflicts = snap.conflicts;
  return true;
}

async function collectGlobalState(selfStatus, doc, peers) {
  const local = {
    ...selfStatus,
    alive: true,
    version: doc.version,
    lamport: doc.lamport.value,
    vectorClock: doc.vectorClock,
    vectorClockText: format(doc.vectorClock),
    textLength: doc.text.length,
  };

  const remote = await Promise.all(
    peers.map(async (p) => {
      try {
        const s = await rpc(p.url, 'status');
        return { ...s, alive: true, vectorClockText: format(s.vectorClock) };
      } catch {
        return { url: p.url, nodeId: p.url, alive: false };
      }
    })
  );

  const nodes = [local, ...remote];
  const live = nodes.filter((n) => n.alive);

  for (const n of live) {
    n.agreement = n.vectorClock ? compare(n.vectorClock, local.vectorClock) : 'unknown';
  }

  const versions = new Set(live.map((n) => n.version));

  return {
    capturedAt: Date.now(),
    nodes,
    consistent: versions.size <= 1,
    note:
      versions.size <= 1
        ? 'all live replicas hold the same version, consistent cut'
        : 'replicas hold different versions, backups are catching up',
  };
}

module.exports = { snapshot, applySnapshot, collectGlobalState };

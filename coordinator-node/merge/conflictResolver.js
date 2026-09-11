const { compare } = require('../clocks/vectorClock');

function range(op) {
  if (op.type === 'insert') return [op.pos, op.pos];
  return [op.pos, op.pos + (op.len || 0)];
}

function overlaps(a, b, slack = 1) {
  const [a1, a2] = range(a);
  const [b1, b2] = range(b);
  return a1 <= b2 + slack && b1 <= a2 + slack;
}

function findConflict(incoming, log, lookback = 25) {
  const start = Math.max(0, log.length - lookback);

  for (let i = log.length - 1; i >= start; i--) {
    const past = log[i];
    if (past.status === 'discarded') continue;
    if (past.clientId === incoming.clientId) continue;
    if (compare(incoming.vectorClock, past.vectorClock) !== 'concurrent') continue;
    if (!overlaps(incoming.op, past.op)) continue;
    return past;
  }
  return null;
}

// higher lamport wins, smaller clientId breaks ties
function resolve(incoming, rival) {
  if (incoming.lamport !== rival.lamport) {
    return incoming.lamport > rival.lamport ? 'incoming' : 'existing';
  }
  return incoming.clientId < rival.clientId ? 'incoming' : 'existing';
}

module.exports = { findConflict, resolve, overlaps, range };

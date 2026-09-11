const LamportClock = require('../clocks/lamportClock');
const { increment, merge } = require('../clocks/vectorClock');
const { findConflict, resolve } = require('../merge/conflictResolver');

const doc = {
  text: '',
  version: 0,
  lamport: new LamportClock(),
  vectorClock: {},
  log: [],
  conflicts: [],
};

// centralized mutual exclusion: one edit inside the critical section at a time
let locked = false;
const waiting = [];

function acquire() {
  return new Promise((grant) => {
    if (locked) waiting.push(grant);
    else {
      locked = true;
      grant();
    }
  });
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else locked = false;
}

async function withLock(fn) {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

function applyOp(text, op) {
  const pos = Math.max(0, Math.min(op.pos, text.length));
  if (op.type === 'insert') return text.slice(0, pos) + op.text + text.slice(pos);
  if (op.type === 'delete') return text.slice(0, pos) + text.slice(pos + op.len);
  if (op.type === 'replace') return text.slice(0, pos) + op.text + text.slice(pos + op.len);
  return text;
}

function publicDoc() {
  return {
    text: doc.text,
    version: doc.version,
    lamport: doc.lamport.value,
    vectorClock: doc.vectorClock,
  };
}

async function submitEdit({ clientId, op, vectorClock = {}, lamport = 0 }) {
  return withLock(async () => {
    const ts = doc.lamport.update(lamport);

    // do not merge the doc vector in here or nothing ever looks concurrent
    const editVC = increment(vectorClock, clientId);

    const entry = {
      id: doc.log.length + 1,
      clientId,
      op,
      lamport: ts,
      vectorClock: editVC,
      wallClock: Date.now(),
      status: 'applied',
    };

    const rival = findConflict(entry, doc.log);
    let conflict = null;

    if (rival) {
      const winner = resolve(entry, rival);

      conflict = {
        at: Date.now(),
        rule: 'higher lamport timestamp wins, tie broken by smaller clientId',
        winner,
        incoming: {
          clientId: entry.clientId,
          lamport: entry.lamport,
          op: entry.op,
          vectorClock: entry.vectorClock,
        },
        existing: {
          clientId: rival.clientId,
          lamport: rival.lamport,
          op: rival.op,
          vectorClock: rival.vectorClock,
        },
      };
      doc.conflicts.push(conflict);

      if (winner === 'existing') {
        entry.status = 'discarded';
        doc.log.push(entry);
        doc.vectorClock = merge(doc.vectorClock, editVC);
        return { entry, conflict, doc: publicDoc() };
      }

      entry.status = 'applied-over-conflict';
    }

    doc.text = applyOp(doc.text, op);
    doc.version += 1;
    doc.vectorClock = merge(doc.vectorClock, editVC);
    doc.log.push(entry);

    return { entry, conflict, doc: publicDoc() };
  });
}

function getState() {
  return {
    ...publicDoc(),
    log: doc.log.slice(-80),
    conflicts: doc.conflicts.slice(-10),
  };
}

module.exports = { doc, submitEdit, getState, publicDoc, applyOp, withLock };

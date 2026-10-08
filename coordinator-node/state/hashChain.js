const crypto = require('crypto');

const GENESIS = '0'.repeat(64);

function hashOf(entry) {
  const { hash, ...rest } = entry;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

// call once the entry is final, any later change to it breaks the chain
function seal(entry, prev) {
  entry.prevHash = prev ? prev.hash : GENESIS;
  entry.hash = hashOf(entry);
  return entry;
}

// replicas keep only a window of the log, so the first link points outside it and is not checked
function verify(log) {
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.hash !== hashOf(e)) return { ok: false, brokenAt: e.id, reason: 'entry was modified' };
    if (i > 0 && e.prevHash !== log[i - 1].hash) {
      return { ok: false, brokenAt: e.id, reason: 'link to previous entry broken' };
    }
  }
  return { ok: true, entries: log.length };
}

module.exports = { seal, verify, hashOf };

// node state/hashChain.js
if (require.main === module) {
  const assert = require('assert');
  const log = [];
  for (let i = 1; i <= 3; i++) {
    log.push(seal({ id: i, op: { type: 'insert', pos: 0, text: 'x' } }, log[log.length - 1]));
  }
  assert.strictEqual(verify(log).ok, true);

  log[1].op.text = 'tampered';
  assert.deepStrictEqual(verify(log), { ok: false, brokenAt: 2, reason: 'entry was modified' });

  log[1].hash = hashOf(log[1]); // attacker recomputes the edited entry's own hash
  assert.deepStrictEqual(verify(log), { ok: false, brokenAt: 3, reason: 'link to previous entry broken' });
  console.log('hashChain ok');
}

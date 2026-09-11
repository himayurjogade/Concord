function increment(vc, id) {
  return { ...vc, [id]: (vc[id] || 0) + 1 };
}

function merge(a, b) {
  const out = { ...a };
  for (const key of Object.keys(b || {})) {
    out[key] = Math.max(out[key] || 0, b[key]);
  }
  return out;
}

function compare(a, b) {
  let aAhead = false;
  let bAhead = false;

  const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const id of ids) {
    const x = (a && a[id]) || 0;
    const y = (b && b[id]) || 0;
    if (x > y) aAhead = true;
    if (y > x) bAhead = true;
  }

  if (aAhead && bAhead) return 'concurrent';
  if (aAhead) return 'after';
  if (bAhead) return 'before';
  return 'equal';
}

function format(vc) {
  const keys = Object.keys(vc || {}).sort();
  if (keys.length === 0) return '(empty)';
  return keys.map((k) => `${k}:${vc[k]}`).join(', ');
}

module.exports = { increment, merge, compare, format };

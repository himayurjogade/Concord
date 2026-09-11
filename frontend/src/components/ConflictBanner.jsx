function describeOp(op) {
  if (op.type === 'insert') return `insert "${op.text}" @${op.pos}`;
  if (op.type === 'delete') return `delete ${op.len} @${op.pos}`;
  return `replace ${op.len} with "${op.text}" @${op.pos}`;
}

function formatVC(vc) {
  const keys = Object.keys(vc || {}).sort();
  return keys.length ? keys.map((k) => `${k}:${vc[k]}`).join(' ') : '-';
}

function Side({ label, side, won }) {
  return (
    <div style={{ opacity: won ? 1 : 0.55 }}>
      <div className="row tiny">
        <span className="dim">{label}</span>
        <code>{side.clientId}</code>
        <span className="mono" style={{ color: 'var(--warn)' }}>L={side.lamport}</span>
        {won ? <span className="badge leader">kept</span> : <span className="badge dead">dropped</span>}
      </div>
      <div className="dim tiny mono">
        {describeOp(side.op)} VC [{formatVC(side.vectorClock)}]
      </div>
    </div>
  );
}

export default function ConflictBanner({ conflicts }) {
  const recent = [...conflicts].slice(-5).reverse();

  return (
    <div className="panel" style={{ borderColor: recent.length ? '#5a4410' : 'var(--line)' }}>
      <h2>Conflicts</h2>
      <p className="sub">raised when vector clocks say concurrent and the edits overlap in the text</p>

      {recent.length === 0 && (
        <div className="dim tiny">
          none yet, tick simulate network partition in one tab, type in both, untick
        </div>
      )}

      {recent.map((conflict, i) => (
        <div key={i} className="item">
          <div className="tiny" style={{ color: 'var(--warn)', marginBottom: 6 }}>
            {new Date(conflict.at).toLocaleTimeString()} rule: {conflict.rule}
          </div>
          <Side label="incoming" side={conflict.incoming} won={conflict.winner === 'incoming'} />
          <div style={{ height: 6 }} />
          <Side label="existing" side={conflict.existing} won={conflict.winner === 'existing'} />
        </div>
      ))}
    </div>
  );
}

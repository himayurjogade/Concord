function describeOp(op) {
  if (op.type === 'insert') return `insert "${op.text}" @${op.pos}`;
  if (op.type === 'delete') return `delete ${op.len} @${op.pos}`;
  return `replace ${op.len} with "${op.text}" @${op.pos}`;
}

function formatVC(vc) {
  const keys = Object.keys(vc || {}).sort();
  return keys.length ? keys.map((k) => `${k}:${vc[k]}`).join(' ') : '-';
}

export default function VersionTimeline({ log, myId }) {
  const recent = [...log].slice(-40).reverse();

  return (
    <div className="panel">
      <h2>Version Timeline</h2>
      <p className="sub">newest first, L is the lamport timestamp, VC is the vector clock</p>

      <div className="scroll">
        {recent.length === 0 && <div className="dim tiny">no edits yet</div>}

        {recent.map((entry) => {
          const discarded = entry.status === 'discarded';
          const overrode = entry.status === 'applied-over-conflict';
          return (
            <div key={entry.id} className={`item ${discarded ? 'strike' : ''}`}>
              <div className="row">
                <code style={{ color: entry.clientId === myId ? 'var(--accent)' : 'var(--fg)' }}>
                  {entry.clientId}
                </code>
                <span className="mono" style={{ color: 'var(--warn)' }}>L={entry.lamport}</span>
                {discarded && <span className="badge dead">discarded</span>}
                {overrode && <span className="badge candidate">won conflict</span>}
              </div>
              <div className="dim tiny mono">{describeOp(entry.op)}</div>
              <div className="dim tiny mono">
                VC [{formatVC(entry.vectorClock)}] wall {new Date(entry.wallClock).toLocaleTimeString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

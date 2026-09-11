import { useState } from 'react';

const API = 'http://localhost:4000/api';

export default function ArchitecturePanel({ cluster, docVersion }) {
  const [globalState, setGlobalState] = useState(null);
  const [busy, setBusy] = useState(false);

  const post = async (path, body) => {
    setBusy(true);
    try {
      await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn(err);
    } finally {
      setBusy(false);
    }
  };

  const captureGlobalState = async () => {
    setBusy(true);
    try {
      setGlobalState(await (await fetch(`${API}/global-state`)).json());
    } catch (err) {
      setGlobalState({ error: err.message });
    } finally {
      setBusy(false);
    }
  };

  const nodes = cluster.nodes || [];

  return (
    <div className="panel">
      <h2>Cluster</h2>
      <p className="sub">
        leader <code>{cluster.leaderId || 'none, electing'}</code> doc v{docVersion}
      </p>

      {nodes.map((node) => {
        const role = node.alive ? node.role : 'unreachable';
        return (
          <div key={node.url} className="item between">
            <div>
              <div className="row">
                <code>{node.nodeId || node.url}</code>
                <span className={`badge ${role}`}>{role}</span>
              </div>
              <div className="dim tiny mono">
                {node.url}
                {node.alive && ` term ${node.term} v${node.version}`}
              </div>
            </div>

            {node.alive ? (
              <button className="danger" disabled={busy} onClick={() => post('/node/kill', { url: node.url })}>
                {node.role === 'leader' ? 'Kill leader' : 'Kill'}
              </button>
            ) : (
              <button disabled={busy} onClick={() => post('/node/revive', { url: node.url })}>
                Revive
              </button>
            )}
          </div>
        );
      })}

      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={busy} onClick={captureGlobalState}>Capture global state</button>
      </div>

      {globalState && (
        <div style={{ marginTop: 10 }}>
          <div
            className="tiny"
            style={{ color: globalState.consistent ? 'var(--ok)' : 'var(--warn)', marginBottom: 6 }}
          >
            {globalState.note || globalState.error}
          </div>
          {(globalState.nodes || []).map((n) => (
            <div key={n.url} className="item tiny mono dim">
              {n.nodeId || n.url}{' '}
              {n.alive ? `v${n.version} VC [${n.vectorClockText || '-'}] ${n.agreement || ''}` : 'unreachable'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

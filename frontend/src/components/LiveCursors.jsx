import { useState } from 'react';

export default function LiveCursors({ myId, peers, peerCursors, links, chat, onSendChat }) {
  const [draft, setDraft] = useState('');
  const others = peers.filter((p) => p !== myId);

  const submit = (event) => {
    event.preventDefault();
    if (!draft.trim()) return;
    onSendChat(draft.trim());
    setDraft('');
  };

  return (
    <div className="panel">
      <h2>Live Cursors and P2P Chat</h2>
      <p className="sub">direct browser to browser over webrtc, the gateway only relayed the handshake</p>

      {others.length === 0 && (
        <div className="dim tiny" style={{ padding: '6px 0' }}>
          no peers yet, open this page in a second tab
        </div>
      )}

      {others.map((peerId) => {
        const state = links[peerId] || 'connecting';
        const cursor = peerCursors[peerId];
        const color = state === 'open' ? 'var(--ok)' : state === 'closed' ? 'var(--bad)' : 'var(--warn)';
        return (
          <div key={peerId} className="item row">
            <span style={{ color }}>&#9679;</span>
            <code>{peerId}</code>
            <span className="dim tiny">
              {state === 'open' ? `cursor at ${cursor ? cursor.cursor : '-'}` : `p2p ${state}`}
            </span>
          </div>
        );
      })}

      <form onSubmit={submit} className="row" style={{ marginTop: 10 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="p2p message"
          style={{ flex: 1 }}
        />
        <button type="submit">Send</button>
      </form>

      <div className="scroll" style={{ marginTop: 8, maxHeight: 140 }}>
        {chat.map((m, i) => (
          <div key={i} className="item tiny">
            <code style={{ color: m.from === 'me' ? 'var(--accent)' : 'var(--ok)' }}>{m.from}</code> {m.text}
          </div>
        ))}
      </div>
    </div>
  );
}

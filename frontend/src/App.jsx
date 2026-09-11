import { useCallback, useRef, useState } from 'react';

import useWebSocket from './hooks/useWebSocket';
import useWebRTC from './hooks/useWebRTC';

import Editor from './components/Editor';
import LiveCursors from './components/LiveCursors';
import VersionTimeline from './components/VersionTimeline';
import ConflictBanner from './components/ConflictBanner';
import ArchitecturePanel from './components/ArchitecturePanel';

const WS_URL = 'ws://localhost:4000/ws';

function mergeVC(a, b) {
  const out = { ...a };
  for (const key of Object.keys(b || {})) {
    out[key] = Math.max(out[key] || 0, b[key]);
  }
  return out;
}

export default function App() {
  const [myId, setMyId] = useState(null);
  const [text, setText] = useState('');
  const [doc, setDoc] = useState({ version: 0, lamport: 0, vectorClock: {} });
  const [log, setLog] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [cluster, setCluster] = useState({ nodes: [], leader: null, leaderId: null });
  const [peers, setPeers] = useState([]);
  const [offline, setOffline] = useState(false);

  // refs not state, these must update synchronously mid keystroke
  const clock = useRef({ lamport: 0, vc: {} });
  const outbox = useRef([]);
  const myIdRef = useRef(null);
  const offlineRef = useRef(false);
  offlineRef.current = offline;

  const rtcRef = useRef(null);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'init':
      case 'resync': {
        if (msg.clientId) {
          setMyId(msg.clientId);
          myIdRef.current = msg.clientId;
        }
        setText(msg.text || '');
        setDoc({ version: msg.version, lamport: msg.lamport, vectorClock: msg.vectorClock || {} });
        setLog(msg.log || []);
        setConflicts(msg.conflicts || []);
        clock.current = {
          lamport: Math.max(clock.current.lamport, msg.lamport || 0),
          vc: mergeVC(clock.current.vc, msg.vectorClock || {}),
        };
        break;
      }

      case 'update': {
        if (offlineRef.current) return;

        clock.current.lamport = Math.max(clock.current.lamport, msg.entry.lamport) + 1;
        clock.current.vc = mergeVC(clock.current.vc, msg.doc.vectorClock);

        setDoc(msg.doc);
        setLog((l) => [...l, msg.entry].slice(-120));
        if (msg.conflict) setConflicts((c) => [...c, msg.conflict].slice(-10));

        const mine = msg.entry.clientId === myIdRef.current;
        if (!mine || msg.entry.status === 'discarded') setText(msg.doc.text);
        break;
      }

      case 'cluster':
        setCluster(msg);
        break;

      case 'peers':
        setPeers(msg.peers || []);
        break;

      case 'signal':
        if (rtcRef.current) rtcRef.current.handleSignal(msg);
        break;

      case 'error':
        console.warn('[gateway]', msg.message);
        break;

      default:
        break;
    }
  }, []);

  const { connected, send } = useWebSocket(WS_URL, handleMessage);

  const sendSignal = useCallback((to, data) => send({ type: 'signal', to, data }), [send]);

  const rtc = useWebRTC(myId, peers, sendSignal);
  rtcRef.current = rtc;

  const handleEdit = useCallback(
    (op, newText) => {
      setText(newText);
      const id = myIdRef.current;
      if (!id) return;

      const current = clock.current;

      // vector clock is sent without self increment, the leader bumps our slot
      const message = {
        type: 'edit',
        op,
        lamport: current.lamport + 1,
        vectorClock: { ...current.vc },
      };

      current.lamport += 1;
      current.vc = { ...current.vc, [id]: (current.vc[id] || 0) + 1 };

      if (offlineRef.current) outbox.current.push(message);
      else send(message);
    },
    [send]
  );

  const handleOffline = (value) => {
    setOffline(value);
    offlineRef.current = value;

    if (!value) {
      const queued = outbox.current;
      outbox.current = [];
      queued.forEach((m) => send(m));
      setTimeout(() => send({ type: 'resync' }), 500);
    }
  };

  const handleCursor = useCallback(
    (position) => rtcRef.current.broadcastP2P({ kind: 'cursor', cursor: position }),
    []
  );

  return (
    <div className="app">
      <h1 style={{ fontSize: 20, margin: '4px 0 2px' }}>Concord</h1>
      <p className="dim tiny" style={{ marginTop: 0 }}>
        distributed collaborative editor, gateway plus three coordinator nodes
      </p>

      <div className="grid">
        <div>
          <Editor
            text={text}
            onEdit={handleEdit}
            onCursor={handleCursor}
            offline={offline}
            setOffline={handleOffline}
            connected={connected}
            myId={myId}
          />
          <ConflictBanner conflicts={conflicts} />
          <VersionTimeline log={log} myId={myId} />
        </div>

        <div>
          <ArchitecturePanel cluster={cluster} docVersion={doc.version} />
          <LiveCursors
            myId={myId}
            peers={peers}
            peerCursors={rtc.peerCursors}
            links={rtc.links}
            chat={rtc.chat}
            onSendChat={rtc.sendChat}
          />
        </div>
      </div>
    </div>
  );
}

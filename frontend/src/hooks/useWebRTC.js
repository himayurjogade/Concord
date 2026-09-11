import { useCallback, useEffect, useRef, useState } from 'react';

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function useWebRTC(myId, peers, sendSignal) {
  const connections = useRef(new Map());

  const [peerCursors, setPeerCursors] = useState({});
  const [chat, setChat] = useState([]);
  const [links, setLinks] = useState({});

  const attachChannel = useCallback((peerId, channel) => {
    channel.onopen = () => setLinks((l) => ({ ...l, [peerId]: 'open' }));
    channel.onclose = () => setLinks((l) => ({ ...l, [peerId]: 'closed' }));

    channel.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.kind === 'cursor') {
        setPeerCursors((c) => ({ ...c, [peerId]: { cursor: msg.cursor, at: Date.now() } }));
      }
      if (msg.kind === 'chat') {
        setChat((c) => [...c, { from: peerId, text: msg.text, at: Date.now() }].slice(-50));
      }
    };

    const entry = connections.current.get(peerId) || {};
    entry.dc = channel;
    connections.current.set(peerId, entry);
  }, []);

  const createPeer = useCallback(
    (peerId, isInitiator) => {
      const existing = connections.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      connections.current.set(peerId, { pc });
      setLinks((l) => ({ ...l, [peerId]: 'connecting' }));

      pc.onicecandidate = (event) => {
        if (event.candidate) sendSignal(peerId, { kind: 'ice', candidate: event.candidate });
      };

      pc.ondatachannel = (event) => attachChannel(peerId, event.channel);

      if (isInitiator) {
        attachChannel(peerId, pc.createDataChannel('concord'));
        pc.onnegotiationneeded = async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal(peerId, { kind: 'offer', sdp: pc.localDescription });
        };
      }

      return connections.current.get(peerId);
    },
    [attachChannel, sendSignal]
  );

  useEffect(() => {
    if (!myId) return;

    for (const peerId of peers) {
      if (peerId === myId) continue;
      if (connections.current.has(peerId)) continue;
      // smaller id always offers, avoids both sides offering at once
      if (myId < peerId) createPeer(peerId, true);
    }

    for (const [peerId, conn] of connections.current) {
      if (!peers.includes(peerId)) {
        conn.pc.close();
        connections.current.delete(peerId);
        setLinks((l) => {
          const next = { ...l };
          delete next[peerId];
          return next;
        });
        setPeerCursors((c) => {
          const next = { ...c };
          delete next[peerId];
          return next;
        });
      }
    }
  }, [peers, myId, createPeer]);

  const handleSignal = useCallback(
    async ({ from, data }) => {
      const entry = connections.current.get(from) || createPeer(from, false);
      const { pc } = entry;

      try {
        if (data.kind === 'offer') {
          await pc.setRemoteDescription(data.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(from, { kind: 'answer', sdp: pc.localDescription });
        } else if (data.kind === 'answer') {
          await pc.setRemoteDescription(data.sdp);
        } else if (data.kind === 'ice') {
          await pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (err) {
        console.warn('signal handling failed', err);
      }
    },
    [createPeer, sendSignal]
  );

  const broadcastP2P = useCallback((message) => {
    const payload = JSON.stringify(message);
    for (const { dc } of connections.current.values()) {
      if (dc && dc.readyState === 'open') dc.send(payload);
    }
  }, []);

  const sendChat = useCallback(
    (text) => {
      broadcastP2P({ kind: 'chat', text });
      setChat((c) => [...c, { from: 'me', text, at: Date.now() }].slice(-50));
    },
    [broadcastP2P]
  );

  return { peerCursors, chat, links, handleSignal, broadcastP2P, sendChat };
}

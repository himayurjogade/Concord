import { useEffect, useRef, useState } from 'react';

export default function useWebSocket(url, onMessage) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onerror = () => setConnected(false);

    // handled directly, not parked in state, or two messages in one tick collide
    socket.onmessage = (event) => {
      try {
        handlerRef.current(JSON.parse(event.data));
      } catch (err) {
        console.warn('bad message from gateway', err);
      }
    };

    return () => socket.close();
  }, [url]);

  const send = (message) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  };

  return { connected, send };
}

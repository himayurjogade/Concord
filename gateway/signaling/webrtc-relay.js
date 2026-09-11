// forwards sdp and ice only, never sees cursor or chat data
function relaySignal(clients, fromId, msg) {
  const target = clients.get(msg.to);

  if (!target || target.readyState !== 1) {
    return { delivered: false, reason: 'peer not connected' };
  }

  target.send(JSON.stringify({ type: 'signal', from: fromId, data: msg.data }));
  return { delivered: true };
}

module.exports = { relaySignal };

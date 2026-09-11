async function rpc(nodeUrl, method, params = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${nodeUrl}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    });
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { rpc };

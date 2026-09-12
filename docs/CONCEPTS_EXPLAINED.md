# Concord: Concepts Explained

Viva preparation for **FA-1, Unit 1 and Unit 2**.

For each syllabus topic: what the concept means, then exactly how Concord uses
it, with the file and function you can open on screen.

Unit 3 work (logical clocks, vector clocks, election, mutual exclusion, beacon)
is already implemented in this repository but belongs to FA-2. It is mapped in
[ARCHITECTURE.md](ARCHITECTURE.md) and deliberately not explained here.

## The system in one paragraph

Concord is a collaborative document editor. Several browsers edit one shared
document. Behind them sit **five separate processes**: three coordinator nodes
that hold the document, one gateway that is the single entry point, and a
frontend dev server. Browsers reach the gateway over WebSocket. The gateway
reaches the coordinators over RPC. Browsers also connect directly to each other
over WebRTC for cursor positions and chat, bypassing the server entirely.

---

# UNIT 1: INTRODUCTION TO DISTRIBUTED SYSTEMS

## 1.1 Definition

A distributed system is a collection of independent computers, or processes,
that appears to its users as a single coherent system.

### How Concord uses it

Run `ps` or look at the five terminals. There are five processes:

| Process | Port | Role |
|---|---|---|
| coordinator node-1 | 5001 | holds the document |
| coordinator node-2 | 5002 | holds the document |
| coordinator node-3 | 5003 | holds the document |
| gateway | 4000 | single entry point |
| frontend dev server | 5173 | serves the React app |

The user types in one text box and sees one document. The fact that three
separate servers each hold a copy, and that one of them is in charge, is
completely invisible to them. Independent processes, single coherent system.

> **Q: Is a normal MERN app distributed?**
> Not in this sense. MERN has one Express and one MongoDB. Kill either and
> everything stops. Concord has three interchangeable coordinators and survives
> losing any one of them, including the one currently in charge. That redundancy
> plus automatic recovery is what makes it distributed.

## 1.2 Goals

The four textbook goals, each mapped to real code in this project.

### Resource sharing

One document shared by many users. The document lives in
`coordinator-node/state/documentState.js` as the `doc` object, and every
connected browser reads and writes it.

### Transparency

Hiding the distribution from the user.

**Open `gateway/cluster.js`, function `callLeader()`.** This one function
delivers two kinds of transparency:

```js
try {
  return await rpc(snapshot.leader, method, params);
} catch (err) {
  await pollCluster();          // leader may have died mid call
  if (!snapshot.leader) throw err;
  return rpc(snapshot.leader, method, params);   // retry on the NEW leader
}
```

- **Location transparency**: the function decides which of the three
  coordinators to call. The browser never learns which one answered.
- **Failure transparency**: if the call fails, it re-polls the cluster, finds the
  newly elected leader, and retries. The user sees a slightly slow keystroke, not
  an error message.

| Transparency type | Where Concord provides it |
|---|---|
| Access | one uniform `POST /rpc {method, params}` interface for every node |
| Location | browser addresses `localhost:4000`, never a coordinator directly |
| Replication | three copies exist, the user sees one document |
| Failure | the retry inside `callLeader()` hides a leader crash |

### Openness

**Open `coordinator-node/server.js`, the `methods` object.** Every coordinator
exposes the same documented, language neutral JSON contract. A coordinator
written in Python or Go could join the cluster tomorrow as long as it answered
`status`, `getState` and `submitEdit` the same way.

### Scalability

**Open `gateway/server.js`.** The only state the gateway keeps is:

```js
const clients = new Map();   // clientId -> WebSocket
```

No document, no session data, no cache. That is deliberate. Because the gateway
stores nothing meaningful, you could run ten gateway instances behind a load
balancer with no coordination between them.

> **Q: Is your system actually scalable?**
> The gateway layer is, because it is stateless. The coordinator layer is not
> horizontally scalable for writes, because all writes funnel through one leader
> by design. That is the price of strong consistency. Scaling writes would
> require sharding the document across several leaders.

## 1.3 Types of distributed systems

The three textbook types:

- **Distributed computing systems**: clusters and grids, built for computation.
- **Distributed information systems**: transaction and integration systems,
  built for shared data.
- **Distributed pervasive systems**: mobile and embedded, devices appearing and
  disappearing.

### How Concord uses it

Concord is a **distributed information system**. Several autonomous processes
cooperate to present one consistent body of information, the document, to many
concurrent users.

It is not a computing system: no work is being parallelised for speed. It is not
pervasive: the nodes are fixed and known in advance through the `PEERS`
environment variable.

## 1.4 Architectures

Two things get called architecture and you should separate them.

### Architectural style: layered

```
Browser  ->  Gateway  ->  Coordinator nodes
```

Each layer talks only to its neighbour. The browser never calls a coordinator.
A coordinator never calls a browser.

### System architecture: hybrid

Concord is deliberately hybrid, and being able to say so is a strong answer.

| Relationship | Architecture | Why |
|---|---|---|
| browser to gateway | client-server | one well known entry point |
| gateway to coordinator | client-server | gateway is the client, coordinator the service |
| coordinator to coordinator | peer group with an elected leader | all three are equal and any can take charge |
| browser to browser | pure peer-to-peer | cursor and chat data needs no server |

> **Q: Why is the browser-to-browser link peer to peer rather than client-server?**
> Cursor positions update dozens of times per second per user. Routing that
> through a server wastes bandwidth and adds a round trip of latency for data
> the server does not need to see or store. WebRTC removes the server from that
> path entirely.

## 1.5 Design issues

| Issue | How Concord addresses it | Where |
|---|---|---|
| Transparency | client talks to one address, does not know where data lives | `gateway/cluster.js` |
| Openness | uniform JSON RPC contract on every node | `coordinator-node/server.js` |
| Scalability | stateless gateway, freely replicable | `gateway/server.js` |
| Fault tolerance | three replicas plus automatic failover | `election/`, `heartbeat/` |
| Concurrency | all edits serialized through one leader holding a lock | `state/documentState.js` |
| Security | not addressed, no authentication layer in this scope | acknowledged gap |

Be honest about the security row. "We did not address security, it was out of
scope for this mini project" is a better answer than inventing one.

## 1.6 Middleware

Middleware is the software layer between applications and the underlying network
that hides the distribution and provides a uniform interface to the layer above.

### How Concord uses it

**The gateway is Concord's middleware.** Open the entire `gateway/` folder.

The browser never does any of the following. The gateway does all of it:

| Middleware service | File and function |
|---|---|
| naming and discovery, finding the current leader | `cluster.js`, `pollCluster()` |
| request routing to the right node | `cluster.js`, `callLeader()` |
| failure masking, hiding a crash behind a retry | `cluster.js`, `callLeader()` catch block |
| communication abstraction | `server.js`, converts browser WebSocket messages into backend RPC calls |
| connection management | `server.js`, the `clients` map |
| P2P introduction service | `signaling/webrtc-relay.js` |

That last conversion is the clearest illustration of middleware. The browser
speaks WebSocket and knows nothing about RPC. The coordinators speak RPC and know
nothing about WebSocket. The gateway translates between two entirely different
communication styles so neither side has to care about the other.

> **Q: What kind of middleware is it?**
> Communication oriented middleware with an element of remote invocation
> middleware. It mediates message passing between clients and turns those
> messages into remote procedure calls on the backend services.

## 1.7 Distributed multimedia systems

Multimedia systems handle continuous media such as audio and video, where
delivery has timing requirements that ordinary data transfer does not.

### How Concord uses it

**Not implemented in FA-1.** State this plainly rather than overclaiming.

What the project does have is the infrastructure that multimedia would use.
`frontend/src/hooks/useWebRTC.js` already establishes full WebRTC peer
connections between browsers. Adding `getUserMedia()` and attaching a camera and
microphone track to those existing `RTCPeerConnection` objects would turn this
into a distributed multimedia system with a small amount of additional code.

The continuous media Concord does carry today is cursor position data streamed
over the WebRTC data channel, which is stream-oriented but not multimedia.

## 1.8 Self study: a model of distributed computations

The standard model describes a distributed computation as a set of **processes**
that execute **events**. Events are of three kinds: internal, send, and receive.
Because there is no shared clock, the only ordering you get for free is the
**happened-before** relation: events in one process are ordered by their own
sequence, and a send always happens before its matching receive.

### How Concord uses it

**Open `coordinator-node/state/documentState.js`, the `doc.log` array.**

Every edit appended to that log is an event record:

```js
{
  id: 1,
  clientId: 'u-8a3a',              // which process produced it
  op: { type: 'insert', pos: 0, text: 'h' },
  lamport: 2,                      // position in the happened-before ordering
  vectorClock: { 'u-8a3a': 1 },    // what that process had seen
  wallClock: 1789149681488,        // display only, never used for decisions
  status: 'applied'
}
```

That log is a literal recording of the distributed computation: the processes,
their events, and the causal ordering between them. Each browser is a process.
Each keystroke is an internal event followed by a send. Each broadcast arriving
at another browser is a receive.

The `lamport` and `vectorClock` fields are how the happened-before relation is
made machine readable, which is Unit 3 material and demonstrated in FA-2.

## 1.9 Self study: the role of virtualization

Virtualization lets one physical machine run several isolated environments, which
in distributed systems means you can place nodes flexibly, migrate them, and
scale them without buying hardware.

### How Concord uses it

**Not used.** Concord runs three coordinator nodes as three OS processes on one
machine, separated by port number rather than by virtualization.

The honest and useful answer is how it *would* apply:

- Each coordinator node is already designed for it. One codebase configured
  entirely by the environment variables `NODE_ID`, `PORT` and `PEERS`, which is
  exactly the shape a container image needs.
- A `docker-compose.yml` with three coordinator containers plus a gateway
  container would run the same code unchanged.
- Because state is in memory and nodes are interchangeable, a container
  orchestrator could add or remove coordinators at runtime.

Saying "we did not virtualize, but the node is already twelve-factor and
container ready, and here is why" is a much stronger answer than claiming
something the repository does not contain.

---

# UNIT 2: COMMUNICATION

## 2.1 Fundamentals

All communication in a distributed system reduces to message passing, but the
patterns differ by whether the sender waits, and whether messages are discrete or
continuous.

### How Concord uses it

Three distinct styles coexist in this one project, which is unusual and worth
pointing out.

| Style | Used for | Sender waits? | Discrete or continuous |
|---|---|---|---|
| Request-reply (RPC) | gateway to coordinator | yes | discrete |
| Message-oriented | browser edits | no | discrete |
| Stream-oriented | cluster status, cursor positions | no | continuous |

The **layered protocols** in play: HTTP over TCP for RPC, WebSocket over TCP for
browser messaging, and SCTP over UDP for the WebRTC data channel.

## 2.2 Remote Procedure Call

RPC makes calling a function on another machine look like calling a local one.
You write a normal looking function call, and underneath the arguments are
serialized, sent over the network, executed elsewhere, and the result sent back.

The parts, with their textbook names:

- **Client stub**: the local function that pretends to be the remote one.
- **Marshalling**: packing arguments into a transportable format.
- **Server stub or dispatcher**: unpacks the request and calls the real function.
- **Unmarshalling**: turning the reply back into a usable value.

### How Concord uses it

**Client stub, open `gateway/rpc.js`:**

```js
async function rpc(nodeUrl, method, params = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(`${nodeUrl}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }),   // marshalling
    signal: controller.signal,
  });
  const body = await res.json();                 // unmarshalling
  if (body.error) throw new Error(body.error);
  return body.result;
}
```

**Server stub, open `coordinator-node/server.js`:**

```js
app.post('/rpc', async (req, res) => {
  const { method, params = {} } = req.body || {};
  const procedure = methods[method];
  if (!procedure) return res.status(400).json({ error: `unknown rpc method: ${method}` });
  res.json({ result: await procedure(params) });
});
```

One endpoint. The method name travels inside the body, not in the URL. The
`methods` table lists every procedure a remote caller may invoke: `status`,
`getState`, `submitEdit`, `requestVote`, `beacon`, `globalState`, `kill`,
`revive`.

**Where it is actually used:** every single edit. When you press a key, the
gateway calls `callLeader('submitEdit', {...})`, which is an RPC to whichever
coordinator is currently the leader.

**Live demo:**

```bash
curl -X POST http://localhost:5001/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"status","params":{}}'
```

> **Q: How is this different from REST?**
> REST names *resources* in the URL and uses HTTP verbs for the action, such as
> `GET /document`. RPC names a *procedure* and passes arguments to it. Concord
> has one endpoint and many methods, which is the RPC shape.

> **Q: Why the AbortController timeout?**
> This is the single most important difference between local and remote calls. A
> local call either returns or throws. A remote call has a third outcome:
> **silence**. The other machine might be crashed, or just slow, and you cannot
> tell which from the outside. So every call gets a deadline and silence is
> treated as failure.

> **Q: What are your RPC semantics?**
> At-most-once. On timeout we do not blindly retry the same edit, because a
> retried insert would be applied twice and duplicate the character.
> `callLeader` retries only after re-polling and discovering a genuinely
> different leader.

> **Q: Is your RPC synchronous or asynchronous?**
> Synchronous from the caller's point of view. `await rpc(...)` blocks that
> request until the result or the timeout arrives.

## 2.3 Message-oriented communication

Communication in discrete, self contained messages. Like a letter: each one makes
sense on its own. Usually asynchronous, meaning the sender posts it and continues
without waiting for a reply.

### How Concord uses it

**Every keystroke becomes one message.**

Open `frontend/src/components/Editor.jsx`, function `diffToOp()`. A textarea only
gives you the whole new string, so this function diffs old against new to produce
one precise operation:

```js
// "hello world" -> "hello brave world"
// common prefix "hello ", common suffix "world"
// result: { type: 'insert', pos: 6, text: 'brave ' }
```

That operation is sent, not the document. This matters: sending the whole
document on every keystroke would waste bandwidth and make every simultaneous
edit collide.

**Open `gateway/server.js`, the edit branch:**

```js
if (msg.type === 'edit') {
  const result = await callLeader('submitEdit', {
    clientId, op: msg.op, lamport: msg.lamport, vectorClock: msg.vectorClock,
  });
  broadcast({ type: 'update', ...result });
}
```

And the broadcast itself:

```js
function broadcast(message) {
  const data = JSON.stringify(message);
  for (const socket of clients.values()) {
    if (socket.readyState === 1) socket.send(data);
  }
}
```

One discrete message in, one discrete message out to every connected client.

**The full path of one keystroke:**

1. `Editor.jsx` diffs the text into an operation.
2. `App.jsx` `handleEdit()` sends `{type: 'edit', op, ...}` over WebSocket.
3. `gateway/server.js` receives it and RPCs the leader.
4. The leader applies it and returns the result.
5. `broadcast()` pushes `{type: 'update', ...}` to every browser.
6. `App.jsx` `handleMessage()` updates the text in each browser.

> **Q: Why WebSocket instead of plain HTTP?**
> With HTTP the server can never speak first, the client must always ask. Live
> collaboration requires the server to push another user's edit the moment it
> arrives. WebSocket's persistent two-way connection allows that. HTTP would
> force constant polling, which wastes requests and adds delay.

> **Q: Persistent or transient? Synchronous or asynchronous?**
> Transient and asynchronous. Messages are not stored for offline recipients, and
> the sender does not block waiting for delivery. A message-queuing system like
> RabbitMQ would be persistent instead.

> **Q: Why broadcast back to the sender too?**
> So everyone converges on one authoritative version. The sender's local text was
> an optimistic guess. The broadcast is the server's authoritative answer, and if
> the sender's edit was rejected, the broadcast is how it finds out.

## 2.4 Stream-oriented communication

A continuous flow where timing and order carry meaning. Like a phone call rather
than a letter. Any single item is nearly worthless, the sequence is what matters,
and a late item is often worse than a dropped one.

### How Concord uses it

Two streams, one over WebSocket and one over WebRTC.

**Stream one, cluster status. Open `gateway/server.js`, near the bottom:**

```js
setInterval(async () => {
  if (clients.size === 0) return;
  broadcast({ type: 'cluster', ...(await pollCluster()) });
}, 1000);
```

Nobody requested any of those updates. The gateway pushes cluster status on a
steady one second cadence whether anything changed or not. That is what makes it
a stream rather than a request-reply exchange. Watch the Cluster panel in the
browser refreshing itself while you sit still, and that is this line running.

**Stream two, cursor positions. Open `frontend/src/hooks/useWebRTC.js`:**

```js
if (msg.kind === 'cursor') {
  setPeerCursors((c) => ({ ...c, [peerId]: { cursor: msg.cursor, at: Date.now() } }));
}
```

Sent from `Editor.jsx` on every `selectionchange` event, which fires dozens of
times per second as you move the caret.

Cursor positions are the textbook example. Position 47 on its own tells you
nothing useful. A smooth stream of positions renders a moving cursor. And if one
position is lost, you want the *next* one immediately, not a retransmission of
the stale one. That is the opposite of how you would treat a lost edit.

> **Q: The difference in one sentence.**
> Message-oriented: each item is complete and independent, so reliability matters
> more than timing. Stream-oriented: items only mean something in sequence, so
> timing matters more than completeness.

> **Q: Is your stream isochronous?**
> The cluster feed is loosely isochronous, pushed on a fixed one second interval,
> but we do not enforce hard real time delivery guarantees. True isochronous
> transmission with bounded jitter would require QoS mechanisms we did not
> implement.

> **Q: What quality of service does your stream need?**
> Low latency and high update rate, but it tolerates loss. Losing one cursor
> position is invisible to the user. That is why it rides the WebRTC data channel
> rather than a guaranteed-delivery path.

## 2.5 Peer-to-peer messaging

In client-server, every byte passes through a server. In peer-to-peer, processes
communicate directly as equals, with no central relay for the data.

### How Concord uses it

**Open `frontend/src/hooks/useWebRTC.js`, function `broadcastP2P()`:**

```js
const broadcastP2P = useCallback((message) => {
  const payload = JSON.stringify(message);
  for (const { dc } of connections.current.values()) {
    if (dc && dc.readyState === 'open') dc.send(payload);
  }
}, []);
```

That loop sends to every peer directly. There is no server in that code path at
all.

**Topology: full mesh.** Every browser holds a direct connection to every other
browser. Open the `useEffect` that watches the peer list:

```js
for (const peerId of peers) {
  if (peerId === myId) continue;
  if (connections.current.has(peerId)) continue;
  if (myId < peerId) createPeer(peerId, true);   // smaller id initiates
}
```

**What travels peer to peer:** cursor positions (`kind: 'cursor'`) and chat
messages (`kind: 'chat'`). Nothing else.

> **Q: Why a mesh and not a star?**
> With a handful of collaborators a mesh is simplest and has the lowest latency,
> since every message takes exactly one hop. Its weakness is that connection
> count grows as O(n squared), so a room with fifty users would need a selective
> forwarding unit instead.

> **Q: Why not send cursors through the server like edits?**
> Three reasons. It would triple server load for data the server does not need.
> It would add a round trip of latency. And the server has no reason to store or
> inspect cursor positions, so routing them through it buys nothing.

## 2.6 WebRTC

WebRTC gives browsers direct peer-to-peer connections. The hard part is
bootstrapping: browser A does not know browser B's address or capabilities, and
the two cannot tell each other, because telling each other is precisely the thing
they cannot yet do.

**Signaling** solves it. A server both browsers already trust passes the
introduction notes, and then steps aside.

```
Alice                     GATEWAY                    Bob
  |-- offer (SDP) --------->|-- offer --------------->|
  |<------------- answer ---|<-- answer (SDP) --------|
  |-- ICE candidate ------->|-- ICE candidate ------->|
  |<-- ICE candidate -------|<-- ICE candidate -------|
  |==== DIRECT DATA CHANNEL, gateway not involved ====|
```

- **SDP offer**: "here is what I support and how to reach me."
- **SDP answer**: the acceptance, in the same format.
- **ICE candidates**: possible network routes. Both sides try them and keep the
  first that works. This is how WebRTC traverses home routers and NAT.
- **STUN server**: tells a browser its own public IP address, which it cannot
  discover from behind a router. It carries no user data.

### How Concord uses it

**The signaling relay, open `gateway/signaling/webrtc-relay.js`. It is 13 lines:**

```js
function relaySignal(clients, fromId, msg) {
  const target = clients.get(msg.to);
  if (!target || target.readyState !== 1) {
    return { delivered: false, reason: 'peer not connected' };
  }
  target.send(JSON.stringify({ type: 'signal', from: fromId, data: msg.data }));
  return { delivered: true };
}
```

Notice what it does **not** do. It never parses the SDP. It never inspects the
ICE candidates. It forwards an opaque blob from one client to another and stamps
who sent it. That is the entire server-side WebRTC implementation.

**The client side, `frontend/src/hooks/useWebRTC.js`:**

```js
const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

pc.onicecandidate = (event) => {
  if (event.candidate) sendSignal(peerId, { kind: 'ice', candidate: event.candidate });
};
pc.ondatachannel = (event) => attachChannel(peerId, event.channel);
```

And `handleSignal()` drives the state machine: on `offer` it answers, on `answer`
it completes, on `ice` it adds the candidate.

### The proof it is genuinely peer to peer

This is the strongest thirty seconds of the demo.

1. Stop the gateway with Ctrl-C.
2. Type in the editor. Nothing syncs. The connection indicator goes red.
3. Send a P2P chat message. **It still arrives in the other tab.**

The server is dead, document sync is dead, and the peer channel keeps working
because it was never passing through the server. Restart the gateway and
everything recovers.

Harder evidence if a teacher wants it: open `chrome://webrtc-internals` and show
the live peer connection, the open data channel, and the bytes flowing.

> **Q: Why does only the smaller clientId send the offer?**
> To avoid **glare**. If both sides send an offer simultaneously, the handshake
> deadlocks. A deterministic rule, smaller id always offers, means exactly one
> side initiates. Both sides compute the same answer independently with no extra
> messages needed to agree.

> **Q: What does the gateway see?**
> Only the handshake. There is no route, handler or log line anywhere in the
> gateway that touches cursor or chat payloads, because those payloads never
> reach it.

> **Q: What if the STUN server is unreachable?**
> Cursors and P2P chat fail to connect. Everything else in the system works, since
> document sync uses WebSocket and does not depend on WebRTC. In a hostile
> network you would add a TURN relay server as a fallback, at the cost of no
> longer being truly peer to peer.

## 2.7 Self study: names, identifiers and addresses

Three different things that beginners conflate:

- A **name** is human readable.
- An **identifier** refers to exactly one entity, uniquely and permanently.
- An **address** says where an entity can currently be reached.

The key property of a good identifier: it never changes, and it is never reused,
even when the address does change.

### How Concord uses it

**Client identifiers, open `gateway/server.js`:**

```js
const clientId = 'u-' + crypto.randomUUID().slice(0, 4);
clients.set(clientId, socket);
```

Every browser gets an identifier such as `u-8a3a` on connection. That identifier
is used in three separate places:

| Used as | Where |
|---|---|
| the addressee for WebRTC signaling | `relaySignal()`, `msg.to` |
| the key in vector clocks | `{ 'u-8a3a': 57, 'u-a157': 19 }` |
| the author on every log entry | `doc.log[].clientId` |

Crucially, it is independent of the client's IP address and port, which the
application never sees or cares about.

**Node identifiers versus node addresses, open `coordinator-node/server.js`:**

```js
const NODE_ID = process.env.NODE_ID || 'node-1';      // identifier
const SELF_URL = `http://localhost:${PORT}`;          // address
```

The separation is real and used differently by different layers. The election
algorithm reasons about identifiers, voting for `node-2`. The RPC layer resolves
addresses, calling `http://localhost:5002`. If you moved node-2 to a different
port, its identifier would stay `node-2` and the election logic would need no
change.

> **Q: Is your naming flat or structured?**
> Flat. Both client ids and node ids are single opaque labels with no hierarchy.
> A structured scheme such as DNS would be needed if the system spanned
> organisations.

## 2.8 Self study: fault tolerance

A system is fault tolerant if it continues providing service in the presence of
failures. The key techniques are **redundancy** (have spares) and **failure
masking** (hide the failure from the layer above).

### How Concord uses it

**Redundancy:** three coordinator nodes instead of one, each holding a full copy
of the document.

**Failure masking, open `gateway/cluster.js`, `callLeader()`.** The retry block
shown in section 1.2 is the masking mechanism. When an RPC to the leader fails,
the gateway re-polls, finds the new leader, and retries. The failure never
reaches the user.

**Failure detection, open `gateway/cluster.js`, `pollCluster()`:**

```js
try {
  const status = await rpc(url, 'status', {}, 800);
  return { url, alive: true, ...status };
} catch {
  return { url, alive: false, nodeId: url, role: 'unreachable' };
}
```

A node that does not answer within 800ms is marked `alive: false`. That is the
failure detector, and it drives the red indicator in the Cluster panel.

**The failure model handled: crash failures**, where a node stops responding
entirely.

**Not handled: Byzantine failures**, where a node stays up but responds with
deliberately wrong data. Tolerating those needs signed messages and a consensus
protocol built for malicious participants, which is well beyond this scope.

> **Q: How many failures can your system survive?**
> One coordinator out of three. With two dead, no majority can be formed and no
> leader can be elected, so the system correctly stops accepting writes rather
> than risking two leaders and a split document. In general a cluster of `n`
> tolerates `floor((n-1)/2)` failures.

> **Q: What happens if the gateway dies?**
> Document sync stops, because it is currently a single point of failure for that
> path. The P2P channel keeps working. In production you would run several
> gateways behind a load balancer, which the stateless design already allows.

---

# CHEAT SHEET

Open these files if asked.

| If asked about | Open | Look at |
|---|---|---|
| definition, architecture | five terminals + `gateway/server.js` | five processes, one document |
| transparency | `gateway/cluster.js` | `callLeader()` and its retry |
| scalability | `gateway/server.js` | `clients` map is the only state |
| openness | `coordinator-node/server.js` | the `methods` table |
| middleware | `gateway/` whole folder | WebSocket in, RPC out |
| model of computation | `state/documentState.js` | the `doc.log` event records |
| RPC | `gateway/rpc.js` + `coordinator-node/server.js` | client stub and dispatcher |
| message-oriented | `gateway/server.js` | `'edit'` branch, `broadcast()` |
| stream-oriented | `gateway/server.js` | the 1s `setInterval` |
| P2P | `useWebRTC.js` | `broadcastP2P()` |
| WebRTC | `signaling/webrtc-relay.js` | 13 lines, forwards only |
| names and identifiers | `gateway/server.js` | `crypto.randomUUID()` |
| fault tolerance | `gateway/cluster.js` | `pollCluster()` and the retry |

# THE FIVE SENTENCES TO HAVE READY

1. **"Five processes, one document."** Three coordinators hold it, a gateway
   routes to them, and the user never learns any of that exists.

2. **"The gateway is our middleware."** It handles discovery, routing and failure
   masking, and it translates WebSocket messages into RPC calls so neither side
   has to know about the other.

3. **"RPC has a third outcome that local calls do not: silence."** You cannot
   distinguish a crashed node from a slow one, so every call carries a deadline.

4. **"Message-oriented cares about reliability, stream-oriented cares about
   timing."** Edits must all arrive. Cursor positions must arrive *now*, and a
   lost one is simply replaced by the next.

5. **"Kill the gateway and the P2P chat keeps working."** That is the proof the
   WebRTC channel is genuinely peer to peer and not a server relay.

# LIKELY CHALLENGE QUESTIONS

**"This is just a web app with extra steps."**
> A web app has one server. We have three interchangeable ones, and the system
> keeps working when any of them dies. We also have a communication path that
> bypasses the server entirely. Neither is possible in a single-server design.

**"Why not just use Socket.io / PeerJS / a library?"**
> We used native `ws` and native WebRTC specifically so the mechanics stay
> visible. The signaling relay being 13 lines is the point. A library would hide
> exactly the parts we are being evaluated on.

**"What are the weaknesses of your design?"**
> State is in memory, so killing all three coordinators loses the document. The
> gateway is a single point of failure for document sync, though the stateless
> design means it could be replicated. The editor uses whole-text replacement so
> a remote edit moves your caret, which a real product would solve with
> Operational Transformation or a CRDT. And we did not address security at all.

**"What would you do next?"**
> Persist the document to disk so a full cluster restart survives. Run multiple
> gateways behind a load balancer. Add WebRTC audio and video over the peer
> connections we already establish, which would make it a distributed multimedia
> system.

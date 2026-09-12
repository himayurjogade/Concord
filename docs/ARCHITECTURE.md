# Concord: Architecture

## System diagram

```
   Browser A        Browser B        Browser C
      |  \______________|______________/  |
      |         WebSocket  ws://:4000/ws  |
      |   message-oriented: edits         |
      |   stream-oriented: cluster feed   |
      |                                   |
      |      WebRTC DataChannel, direct   |
      +===================================+
         gateway relays only the handshake

                       |
              +------------------+
              |     GATEWAY      |   port 4000
              |   middleware     |   stateless
              +------------------+
                       |
                 RPC over HTTP
             POST /rpc {method, params}
         ______________|______________
        /              |              \
   node-1           node-2          node-3      5001 / 5002 / 5003
   LEADER          follower        follower
        \______________|______________/
             beacon every 800ms
```

## Component responsibilities

| Component | Holds state? | Responsibility |
|---|---|---|
| Browser | local copy of the text, own logical clocks | edits, renders, opens P2P connections |
| Gateway | connected socket list only | single entry point, routes to the leader, relays signaling |
| Coordinator (leader) | the document | serializes edits, stamps clocks, resolves conflicts, replicates |
| Coordinator (follower) | replica of the document | votes in elections, holds a copy ready for failover |

The gateway deliberately holds no document state. That is what makes it
horizontally scalable: you can run several gateway instances behind a load
balancer with no coordination between them.

## Life of one edit

1. User types a character in the browser.
2. `Editor.jsx` diffs old text against new text and produces one operation,
   for example `{type: 'insert', pos: 12, text: 'h'}`.
3. `App.jsx` stamps it with the client's own Lamport timestamp and vector clock
   and sends it over WebSocket.
4. The gateway receives it and calls `callLeader('submitEdit', ...)`, an RPC to
   whichever coordinator is currently the leader.
5. The leader enters its critical section via `withLock`, updates the Lamport
   clock, stamps the vector clock, checks for conflicts, applies the operation,
   increments the version.
6. The result returns to the gateway, which broadcasts it to every connected
   browser including the sender.
7. Within 800ms the next beacon carries the new document snapshot to both
   followers.

## Concept to implementation map

### FA-1: Unit 1, Introduction to Distributed Systems

| Concept | File | How |
|---|---|---|
| **Architecture** | `gateway/server.js`, `coordinator-node/server.js` | Stateless gateway as a single entry point in front of three identical, interchangeable coordinator nodes holding replicated state. |
| **Type of distributed system** | whole project | A distributed information system. Multiple autonomous processes presenting one coherent document to the user. |
| **Goal: transparency** | `gateway/cluster.js`, `callLeader()` | The browser addresses `localhost:4000` only. Which coordinator served it, and whether the leader changed mid session, is never exposed. |
| **Goal: openness** | `coordinator-node/server.js`, `/rpc` route | One uniform, language neutral JSON contract: `POST /rpc {method, params}`. A node in any language could join. |
| **Goal: scalability** | `gateway/server.js` | The gateway keeps only the connected socket list, so more instances need no coordination. |
| **Design issue: fault tolerance** | `election/leaderElection.js`, `heartbeat/beacon.js` | Beacons detect a dead leader, majority election picks a replacement, replicated snapshots mean no committed edit is lost. |
| **Middleware** | `gateway/` entire folder | The gateway is the middleware layer. It sits between the client applications and the backend services and hides the distribution from the layer above. |

### FA-1: Unit 2, Communication

| Concept | File | How |
|---|---|---|
| **Fundamentals** | `gateway/rpc.js`, `gateway/server.js` | Three communication styles in one system: request-reply RPC, asynchronous messaging, and continuous streams. |
| **Remote Procedure Call** | `gateway/rpc.js`, `coordinator-node/rpc.js`, `/rpc` route | `rpc()` is the client stub: it marshals arguments to JSON and enforces a timeout. The `methods` table in `coordinator-node/server.js` is the server stub that dispatches to the real function. |
| **Message-oriented communication** | `gateway/server.js`, the `'edit'` branch and `broadcast()` | Each edit is one discrete, self contained, asynchronous message. The result is broadcast to every connected client. |
| **Stream-oriented communication** | `gateway/server.js`, the 1s `setInterval`; `useWebRTC.js`, `kind: 'cursor'` | Continuous cluster status feed and continuous cursor positions, where value lies in the unbroken sequence rather than any single item. |
| **P2P messaging** | `frontend/src/hooks/useWebRTC.js`, `broadcastP2P()` | Full mesh of direct browser to browser data channels. Cursor and chat data never reaches the server. |
| **WebRTC** | `gateway/signaling/webrtc-relay.js`, `useWebRTC.js` | The gateway relays SDP offers, answers and ICE candidates only. `relaySignal` never parses the payload. |
| **Self study: names, identifiers, addresses** | `gateway/server.js`, `crypto.randomUUID()` | Each client gets a unique identifier at connection time. It names the client in vector clocks and addresses it for signaling, independent of its network address. |
| **Self study: fault tolerance** | `gateway/cluster.js`, `callLeader()` | On RPC failure the gateway re-polls, finds the new leader, and retries once, so a crash surfaces as a slow edit rather than an error. |

### FA-2 preview: Unit 3, Synchronization

Already implemented, to be demonstrated in FA-2.

| Concept | File | How |
|---|---|---|
| **Logical clocks, Lamport** | `clocks/lamportClock.js` | `tick()` for local events, `update(t)` applying `max(local, received) + 1`. |
| **Vector algorithm** | `clocks/vectorClock.js` | `increment`, `merge`, `compare`. `compare` returns `'concurrent'` when neither vector dominates. |
| **Conflict resolution** | `merge/conflictResolver.js` | `findConflict()` requires both concurrency and positional overlap. `resolve()` applies higher Lamport wins, smaller clientId breaks ties. |
| **Global state** | `state/globalStateSync.js`, `collectGlobalState()` | Gathers every node's local state in parallel and uses vector clock comparison to judge whether the result is a consistent cut. |
| **Election algorithms** | `election/leaderElection.js` | Randomised timeouts, monotonic terms, one vote per node per term, majority quorum, plus a log freshness check. |
| **Mutual exclusion** | `state/documentState.js`, `acquire`/`release`/`withLock` | Centralized algorithm. The leader is the coordinator, requests are granted one at a time and queued FIFO otherwise. |
| **Beacon protocol** | `heartbeat/beacon.js` | The leader beacons every 800ms. Silence longer than a follower's 1500 to 3000ms election timeout is interpreted as death. |
| **Replication** | `beacon.js` and `globalStateSync.js`, `applySnapshot()` | A full document snapshot is piggybacked onto every beacon. |

## Key design decisions

**One coordinator codebase, three identities.** `NODE_ID`, `PORT` and `PEERS`
come from the environment. Three copies of the same file would be three times the
maintenance and three times the drift.

**Writes go only to the leader.** `submitEdit` throws on a non-leader. If backups
accepted writes there would be no serialization point and the replicas would
diverge permanently.

**Beacon interval is well under the election timeout.** 800ms against 1500 to
3000ms, so several beacons fit inside one timeout window and a single dropped
packet cannot trigger a needless election.

**Election timeouts are randomised.** Identical timeouts would make all nodes
become candidates simultaneously, split the vote, and loop forever.

**A majority quorum, not a plurality.** Any two majorities of the same set share
a member, and no node votes twice per term, so two leaders in one term are
impossible. This is the defence against split brain.

**Votes are refused to candidates with a lower version.** Without this, a node
that missed recent edits could win and its snapshot would overwrite committed
data on up to date followers.

**Ties break on clientId, never on `Date.now()`.** Wall clocks differ between
machines, so a wall clock tie break would produce different winners on different
nodes and silently diverge the replicas.

**Every RPC has a timeout.** A local call returns or throws. A remote call has a
third outcome, silence, and you cannot tell a crashed node from a slow one. Every
other mechanism in the system exists because of that third outcome.

## Known limitations

- **In memory only.** Killing all three coordinators loses the document.
  Durability would need a write ahead log on disk.
- **Whole text replacement in the client.** A remote edit resets the textarea and
  moves the caret. The real fix is Operational Transformation or a CRDT.
- **Marker free global snapshot.** `collectGlobalState` gathers node states but
  does not capture in-flight messages the way full Chandy-Lamport does.
- **Asynchronous replication.** The leader does not wait for acknowledgement, so
  a crash inside the beacon window can lose the most recent edits. Synchronous
  replication would trade availability for that.
- **Full WebRTC mesh.** Connection count grows as O(n squared), so a large room
  would need a selective forwarding unit.

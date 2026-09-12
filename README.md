# Concord

A distributed collaborative document editor. Multiple people edit the same
document at the same time, backed by several coordinator servers instead of one,
so the system keeps working when a server dies.

Distributed Systems mini project, FA-1.

## Problem statement

Collaborative document editing looks like an ordinary web application until you
ask two questions:

1. What happens when the server holding the document crashes?
2. What happens when two people edit the same sentence at the same instant?

A single-server application answers both badly. It stops working, and the last
write silently destroys the other. Concord answers both by distributing the
document across three interchangeable coordinator nodes, electing one to be in
charge, and detecting genuinely concurrent edits using logical clocks rather
than trusting machine timestamps.

## Scope

**FA-1 covers Unit 1 and Unit 2.**

| Unit | Topics demonstrated |
|---|---|
| Unit 1: Introduction | goals, types, architectures, design issues, middleware |
| Unit 2: Communication | fundamentals, RPC, message-oriented, stream-oriented, P2P, WebRTC |

**Unit 3 is already implemented ahead of schedule** and will be demonstrated in
FA-2: Lamport logical clocks, vector clocks, global state, leader election,
mutual exclusion, and the beacon protocol.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the concept to file map and
[docs/CONCEPTS_EXPLAINED.md](docs/CONCEPTS_EXPLAINED.md) for detailed
explanations of every concept with the exact file that implements it.

## Architecture

```
   Browser A        Browser B        Browser C
      |  \______________|______________/  |
      |         WebSocket  ws://:4000/ws  |
      |   message-oriented: edits         |
      |   stream-oriented: cluster feed   |
      |                                   |
      |      WebRTC DataChannel, direct   |
      +===================================+   cursors and chat.
         the gateway relays only the          never touches the server
         handshake, then steps aside

                       |
              +------------------+
              |     GATEWAY      |   port 4000
              |   middleware     |   stateless, holds no document
              +------------------+
                       |
                 RPC over HTTP
             POST /rpc {method, params}
         ______________|______________
        /              |              \
   node-1           node-2          node-3      ports 5001 / 5002 / 5003
   LEADER          follower        follower
   owns the doc    replica         replica
        \______________|______________/
          beacon every 800ms carrying
          a full document snapshot
```

## Tech stack

Node.js, Express, native `ws` for WebSocket, native WebRTC with no wrapper
library, React with Vite. State is in memory only, no database, by design.

## Requirements

- **Node.js 18 or newer.** The code uses the built in global `fetch`.
- A modern browser for WebRTC. Chrome, Edge or Firefox.

```bash
node --version
```

## Install

Three separate installs, one per part. Run from the repository root.

```bash
cd coordinator-node && npm install && cd ..
cd gateway          && npm install && cd ..
cd frontend         && npm install && cd ..
```

## Run

Five terminals. Start the coordinators first, then the gateway, then the
frontend. Use absolute paths so it does not matter which folder each terminal
happens to be in.

**terminal 1**
```bash
cd ~/MAYUR/concord/coordinator-node
NODE_ID=node-1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 npm start
```

**terminal 2**
```bash
cd ~/MAYUR/concord/coordinator-node
NODE_ID=node-2 PORT=5002 PEERS=http://localhost:5001,http://localhost:5003 npm start
```

**terminal 3**
```bash
cd ~/MAYUR/concord/coordinator-node
NODE_ID=node-3 PORT=5003 PEERS=http://localhost:5001,http://localhost:5002 npm start
```

**terminal 4**
```bash
cd ~/MAYUR/concord/gateway
npm start
```

**terminal 5**
```bash
cd ~/MAYUR/concord/frontend
npm run dev
```

Within about three seconds one coordinator prints:

```
[node-1] i am the leader, term 1
```

Which node wins is random by design. Then open **http://localhost:5173**, and
open it in a second tab to collaborate with yourself.

If you see `[election] node-1 lost term 1 with 1 votes` in the log, that is
normal. The first node started before its peers were listening, failed to reach
a majority, and retried. It recovers on its own.

> On Windows PowerShell, `VAR=value command` does not work. Use:
> ```powershell
> $env:NODE_ID="node-1"; $env:PORT="5001"; $env:PEERS="http://localhost:5002,http://localhost:5003"; npm start
> ```
> Use a separate window per node, since `$env:` persists in the shell.

## Ports

| Part | Port |
|---|---|
| Gateway, HTTP and WebSocket | 4000 |
| Coordinator node-1 | 5001 |
| Coordinator node-2 | 5002 |
| Coordinator node-3 | 5003 |
| Frontend, Vite dev server | 5173 |

## Demo

Five things, in this order.

**1. Architecture (Unit 1).** Point at the five running terminals, then at the
Cluster panel in the browser showing three nodes, their roles, and the document
version. The browser only ever talks to port 4000 and never learns which
coordinator served it.

**2. RPC (Unit 2).** Call a coordinator directly, bypassing the gateway:
```bash
curl -X POST http://localhost:5001/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"status","params":{}}'
```
One endpoint, method name inside the body, arguments marshalled to JSON.

**3. Message-oriented communication (Unit 2).** Type in one tab, watch it appear
in the other. Each keystroke becomes one small self contained message describing
the change, not a copy of the whole document.

**4. Stream-oriented communication (Unit 2).** The Cluster panel refreshes every
second whether or not anything changed. Nobody requested each update. Peer
cursor positions are the second example.

**5. P2P and WebRTC (Unit 2).** The Live Cursors panel shows the other tab with
`p2p open`. Move your caret, watch it update. Send a P2P chat message.

Then the proof: **stop the gateway with Ctrl-C.** Document sync dies, the
connection indicator goes red, but P2P chat between the two tabs keeps working,
because that data was never passing through the server. Restart the gateway and
everything recovers.

## Testing without a browser

```bash
# who is in the cluster, and who leads it
curl http://localhost:4000/api/cluster

# read the document
curl http://localhost:4000/api/document

# submit an edit
curl -X POST http://localhost:4000/api/edit \
  -H 'Content-Type: application/json' \
  -d '{"clientId":"curl-1","op":{"type":"insert","pos":0,"text":"hello "},"lamport":1,"vectorClock":{}}'

# talk to one coordinator directly, no gateway in the way
curl -X POST http://localhost:5001/rpc \
  -H 'Content-Type: application/json' \
  -d '{"method":"status","params":{}}'
```

## Troubleshooting

**`no leader elected yet, try again in a moment`**
Fewer than two coordinators are running. Election needs a majority, so with
three configured at least two must be alive.

**Nobody ever becomes leader**
Check `PEERS`. Each node must list the *other two* URLs, not its own.

**`fetch is not defined`**
Node is older than 18. Upgrade.

**`EADDRINUSE`**
A previous run still holds the port.
```bash
lsof -ti:5001 | xargs kill
```

**Edits work but the other tab shows nothing**
Check the browser console for WebSocket errors and confirm the gateway terminal
logged both clients connecting.

**Live Cursors stuck on `p2p connecting`**
WebRTC needs a moment. If it never connects, your network may be blocking
`stun:stun.l.google.com:19302`. Only cursors and P2P chat are affected,
everything else works without it.

**Killed two nodes and editing stopped permanently**
Correct behaviour, not a bug. Majority is lost so no leader can be elected.
Revive one from the Cluster panel.

## Project layout

```
concord/
├── README.md
├── docs/
│   ├── ARCHITECTURE.md          concept to file map
│   └── CONCEPTS_EXPLAINED.md    detailed explanations, viva prep
├── gateway/                     single entry point, port 4000, stateless
│   ├── server.js                HTTP + WebSocket + broadcast
│   ├── rpc.js                   RPC client stub
│   ├── cluster.js               leader tracking, transparent failover
│   ├── routes/sync.js           HTTP API
│   └── signaling/
│       └── webrtc-relay.js      forwards SDP and ICE only
├── coordinator-node/            one codebase, run 3x with different env vars
│   ├── server.js                RPC dispatcher and wiring
│   ├── rpc.js                   RPC client stub
│   ├── clocks/
│   │   ├── lamportClock.js      logical ordering
│   │   └── vectorClock.js       concurrency detection
│   ├── election/
│   │   └── leaderElection.js    randomised timeout, majority vote
│   ├── heartbeat/
│   │   └── beacon.js            liveness and piggybacked replication
│   ├── merge/
│   │   └── conflictResolver.js  detect and resolve deterministically
│   └── state/
│       ├── documentState.js     the document and mutual exclusion
│       └── globalStateSync.js   replication and global snapshot
└── frontend/                    React and Vite, port 5173
    └── src/
        ├── App.jsx
        ├── hooks/
        │   ├── useWebSocket.js
        │   └── useWebRTC.js
        └── components/
            ├── Editor.jsx
            ├── LiveCursors.jsx
            ├── VersionTimeline.jsx
            ├── ConflictBanner.jsx
            └── ArchitecturePanel.jsx
```

## Known limitations

Deliberate, and in scope for a mini project.

- **In memory only.** Stopping all three coordinators loses the document.
- **Whole text replacement in the client.** A remote edit resets the textarea and
  moves your caret. The real fix is Operational Transformation or a CRDT.
- **Asynchronous replication.** The leader does not wait for follower
  acknowledgement, so a crash inside the 800ms beacon window can lose the most
  recent edits.
- **Full WebRTC mesh.** Fine for a few browsers, connection count grows as
  O(n squared), so a large room would need an SFU.

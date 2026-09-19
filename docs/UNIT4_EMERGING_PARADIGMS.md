# Concord: Unit 4, Emerging Distributed Paradigms

FA-2 viva preparation for Unit 4.

Unit 4 is different from Units 1 to 3. It is mostly about **paradigms and real
systems**, not algorithms you implement. So for each topic this document does
three things: explains the idea, says honestly whether Concord implements it or
merely resembles it, and gives the exact comparison you can make out loud.

The single most useful habit for this unit: **never overclaim.** "We do not
implement X, but here is how our design maps onto it" is a strong answer.
"We implement X" when you do not is a weak one that gets pulled apart.

Where Concord stands for each topic:

| Topic | Concord status |
|---|---|
| Distributed object-based systems | **implemented**, the RPC layer is a remote object interface |
| Distributed web-based systems | **implemented**, the whole system is web based |
| Distributed file systems | **implemented in miniature**, replicated storage with a copy per node on disk |
| Serverless architectures | **not used**, and the design explains why it cannot be |
| Virtualization and containers | **implemented**, Docker Compose with health checks and volumes |
| Cloudflare | strong analogy, Durable Objects |
| AWS | deployment mapping |
| Apache Hadoop | strong analogy, NameNode/DataNode and replication factor 3 |
| Kubernetes | strong analogy, and the compose file already speaks its language |
| Megaport | weak analogy, know what it is |
| Blockchain / DLT | the log is a ledger, but a trusted one, and the contrast is the point |
| Distributed database trade-offs | **demonstrable**, Concord is a CP system and you can prove it live |

---

## 4.1 Distributed object-based systems

### What it means

An object has state and methods. A distributed object lets you call those methods
from another machine. The classic systems are CORBA, Java RMI and DCOM.

The pieces:

- **Proxy**: the client-side stand-in that looks like the object but forwards
  calls over the network. In Java RMI this is the *stub*.
- **Skeleton**: the server-side piece that receives the call, unpacks it, and
  invokes the real method.
- **Object reference**: how a client names a remote object so the system can find
  it.
- **Interface definition**: the published list of methods, so a client knows what
  it can call. CORBA uses an IDL file for this.

### How Concord uses it

**Each coordinator node is a distributed object.** Open
`coordinator-node/server.js`, the `methods` table:

```js
const methods = {
  status:      () => ({ ... }),
  requestVote: (params) => election.handleVoteRequest(params),
  beacon:      (params) => { ... },
  getState:    () => docState.getState(),
  submitEdit:  (params) => { ... },
  globalState: () => collectGlobalState(...),
  kill:        () => { ... },
  revive:      () => { ... },
};
```

That table **is** the object's interface. It is Concord's IDL. Every method a
remote caller may invoke is listed there and nowhere else.

| Object-based concept | In Concord |
|---|---|
| distributed object | one coordinator node process |
| object state | the `doc` in `documentState.js`, plus election state |
| interface definition | the `methods` table |
| proxy / stub | `rpc()` in `gateway/rpc.js` |
| skeleton | `app.post('/rpc', ...)` in `coordinator-node/server.js` |
| object reference | the node URL, `http://node-2:5002` |
| method invocation | `rpc(url, 'submitEdit', params)` |

**Where Concord is simpler than CORBA or RMI**, and you should say so:

- No distributed garbage collection. Objects live as long as the process.
- No persistent object references. A URL is the reference, and if the node
  moves, the reference breaks.
- No interface compiler. The `methods` table is checked at runtime, not compiled
  into typed stubs.

> **Q: Is this really object based, or just RPC?**
> Object based systems are RPC plus three things: state that persists between
> calls, an identity for the thing being called, and a published interface.
> Concord has all three. Each node holds document state across calls, is
> identified by `NODE_ID`, and publishes its interface as the `methods` table.

> **Q: What would Java RMI give you that this does not?**
> Compile time type checking of the interface, automatic stub generation, and
> object references that survive the object moving. We traded those for a
> language neutral contract that a Python node could implement tomorrow.

---

## 4.2 Distributed web-based systems

### What it means

Systems built on web protocols: HTTP as the transport, web servers, proxies,
caching, and web services that expose functionality over HTTP. The modern form
is an API gateway in front of many backend services.

### How Concord uses it

**The entire system is web based.** Every hop uses a web protocol:

| Hop | Protocol |
|---|---|
| browser to frontend server | HTTP, serving static files |
| browser to gateway | WebSocket, upgraded from HTTP |
| gateway to coordinator | HTTP, carrying JSON RPC |
| gateway HTTP API | REST style routes in `gateway/routes/sync.js` |

**The gateway is a reverse proxy and API gateway.** Open `gateway/server.js`.
It does exactly what nginx or an API gateway does in a web architecture:

- accepts all inbound connections on one port
- terminates the client protocol, WebSocket
- forwards to backend services over a different protocol, RPC
- hides the backend topology from the client

**Stateless web tier.** The textbook rule for web scalability is that web servers
must not hold session state. `gateway/server.js` holds only the live socket map,
nothing about the document. That is the rule applied.

**Two kinds of web interface on the same server.** `gateway/routes/sync.js`
exposes a REST style HTTP API (`GET /api/document`, `POST /api/edit`) alongside
the WebSocket. The REST routes exist so the system can be driven by `curl`, which
is the web services idea: functionality reachable by any HTTP client.

> **Q: Why WebSocket instead of long polling or server-sent events?**
> Server-sent events are one directional, server to client only, and edits go
> both ways. Long polling wastes a request per update. WebSocket is a single
> persistent bidirectional connection, which is what live collaboration needs.

> **Q: Where would you put a web cache?**
> Nowhere useful. Caching helps when many clients read the same thing that rarely
> changes. Our document changes on every keystroke and every client already holds
> a copy pushed to it, so a cache would serve stale data and save nothing.

---

## 4.3 Distributed file systems

### What it means

A file system spread across many machines: NFS, Google File System, Hadoop HDFS.
The core problems are the same ones Concord faces: where does the data live, how
many copies, who is allowed to write, and how do the copies stay consistent.

The standard answer in GFS and HDFS is **primary copy replication**: one replica
is the primary and orders all writes, the others are secondaries that receive
copies. Every replica is stored on disk on its own machine.

### How Concord uses it

**Concord implements replicated storage in miniature.** Open
`coordinator-node/state/documentState.js`, functions `persist()` and
`restore()`.

```js
function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ text, version, lamport, vectorClock, log, conflicts }));
  fs.renameSync(tmp, DATA_FILE);   // atomic: a crash mid write never leaves a half file
}
```

Every node writes its **own** copy of the document to its **own** file,
`data/node-1.json`, `data/node-2.json`, `data/node-3.json`. Under Docker each
file lives in a separate named volume. Three machines, three files, one
document. That is a distributed file system's core property: the data exists
in several places at once, and losing one place loses nothing.

**When it writes.** The leader calls `persist()` at the end of every
`submitEdit`. Followers call it every time a beacon delivers a newer snapshot,
in the `beacon` handler in `server.js`. So all three files stay within one
beacon interval of each other.

**When it reads.** `restore()` runs once at startup, before the election
begins. A node that reboots comes back knowing its own version number, which
matters because the election refuses to vote for a candidate holding less data.

**The comparison to HDFS:**

| GFS / HDFS | Concord |
|---|---|
| primary replica orders all writes | the leader orders all edits |
| secondary replicas receive copies | followers receive snapshots |
| replication factor 3, the HDFS default | three coordinator nodes |
| a write is applied at the primary, then pushed to secondaries | `submitEdit` on the leader, then `applySnapshot` on followers via the beacon |
| each DataNode stores its blocks on local disk | each node stores its replica in `data/<node>.json` |
| chunk version numbers stop stale replicas overwriting new ones | the `snap.version < doc.version` guard in `applySnapshot` |

**The live demo.** Stop all three coordinators. Start them again. Each prints
`restored v40 from .../node-X.json` and the document is exactly where you left
it. Under Docker: `docker compose down` then `docker compose up`, same result.

**Where a real DFS differs**, and why:

- A DFS splits files into chunks and replicates chunks independently, so a huge
  file is spread across many machines. Concord replicates the whole document as
  one unit because it is small.
- A DFS appends to a log rather than rewriting the whole file. Concord rewrites
  the full snapshot on every change, which is fine for a document and would not
  be for a database.
- A DFS separates metadata (which chunks exist, where) from data. Concord has no
  metadata layer because there is one document.

> **Q: Why write to a temp file and rename, instead of writing directly?**
> If the process is killed halfway through writing, a direct write leaves a
> truncated file that will not parse. Rename is atomic at the file system level:
> the old file is replaced by the new one in a single step, never a half state.
> Every real database and file system does this.

> **Q: What happens if a node restarts with newer data than the current leader?**
> Its extra edits are eventually overwritten once the leader's version catches
> up. This can only happen if two stale nodes elect each other before the fresh
> node returns. Full Raft prevents it with log matching. We accept it because in
> practice nodes are restarted together, and we document it as a known
> limitation.

---

## 4.4 Serverless architectures

### What it means

You write functions, not servers. The cloud runs each function on demand, scales
it from zero to thousands of copies, and charges per invocation. AWS Lambda is
the reference example.

The defining constraint: **functions are stateless and short lived.** Any state
must live somewhere else, in a database or object store. A function may be killed
between calls, and two calls may run on different machines.

### How Concord uses it

**Concord is not serverless, and the reason is instructive.**

Go through each part:

| Component | Could it be serverless? | Why |
|---|---|---|
| coordinator node | **no** | it holds the document in memory across calls, and holds an election role. Both are state. A serverless function would lose the document between invocations. |
| gateway | **partly** | it is stateless in the important sense, but it holds open WebSocket connections, which serverless platforms handle badly since a function cannot stay alive holding a socket |
| frontend | **yes** | static files can be served from any CDN with no server at all |

**The deeper point.** Serverless forces the state out of the process and into a
managed store. If you made Concord serverless, the document would have to move
into DynamoDB or similar, and the leader election would become "whichever
function grabs the database lock first". That is a legitimate design, but it
moves all the distributed systems problems into the database rather than solving
them.

> **Q: Why not just use serverless and avoid all this?**
> Because then the database is the distributed system, and someone still has to
> solve replication, ordering and failover inside it. Serverless does not remove
> the problems Concord demonstrates, it hides them behind a vendor's API.

> **Q: What is a cold start and does it matter here?**
> The delay when a serverless platform has to spin up a fresh function instance.
> For a collaborative editor where a keystroke must round trip in tens of
> milliseconds, a cold start of several hundred milliseconds is unacceptable.
> Another reason the coordinator is a long running process.

---

## 4.5 Case studies

For each: what the system is, and the specific comparison to make.

### Cloudflare

**What it is.** A global edge network. Every request to a site behind Cloudflare
hits a Cloudflare server near the user first, which proxies, caches and filters
before forwarding to the origin. Cloudflare Workers run code at the edge.
**Durable Objects** are single-instance stateful objects that act as a
coordination point: exactly one copy exists worldwide, and all requests for a
given object are routed to it.

**The comparison.** Durable Objects are the closest real world product to a
Concord coordinator leader. Both are a single writer that everyone routes to,
holding state in memory, with the platform guaranteeing there is only one. The
difference is that Cloudflare picks the location and handles failover invisibly,
whereas Concord does it in the open with an election.

| Cloudflare | Concord |
|---|---|
| edge proxy in front of origin | gateway in front of coordinators |
| Durable Object, single writer | leader node |
| Cloudflare Calls, a WebRTC SFU | our full mesh, which is what an SFU replaces at scale |

> **Q: What would Cloudflare add?**
> Geographic distribution. Our gateway is one process on one machine. Cloudflare
> would put a gateway in every city and route each user to the nearest one, which
> is the scalability story our stateless gateway design already allows.

### AWS

**What it is.** The largest cloud provider. The relevant building blocks: EC2
virtual machines, Elastic Load Balancer, API Gateway, Lambda for serverless,
DynamoDB and RDS for databases, EBS for block storage, and Availability Zones,
which are physically separate data centres in one region.

**The comparison.** This is a deployment mapping, and the compose file is the
local rehearsal for it. Every Concord component has a direct AWS home:

| Concord | AWS service | Note |
|---|---|---|
| coordinator container | EC2 instance, one per Availability Zone | three AZs means a whole data centre can fail and you keep a majority |
| named volume per node | EBS volume per instance | same idea: storage that outlives the process |
| gateway container | Application Load Balancer + EC2 | ALB supports WebSocket |
| frontend container | S3 + CloudFront | static files on a CDN |
| election | could be replaced by DynamoDB conditional writes as a lock | but then DynamoDB is your consensus |

**The Availability Zone point is the strongest one.** Concord tolerates one node
failure. On AWS you would place the three coordinators in three AZs, so the
failure you tolerate is not one process but one entire data centre.

### Apache Hadoop

**What it is.** A framework for storing and processing huge datasets across
clusters of ordinary machines. Two halves: **HDFS** for storage and **MapReduce**
for computation. HDFS has one **NameNode** holding all metadata and many
**DataNodes** holding the actual blocks. Every block is replicated, by default
three times. DataNodes send **heartbeats** to the NameNode every three seconds;
a DataNode that goes silent is declared dead and its blocks are re-replicated
elsewhere.

**The comparison.** This is the strongest analogy in Unit 4 and it runs deep.

| HDFS | Concord |
|---|---|
| one NameNode is the authority | one leader is the authority |
| DataNodes hold replicas on local disk | followers hold replicas in `data/<node>.json` |
| replication factor 3 | three nodes |
| heartbeat every 3 seconds | beacon every 800ms |
| silent DataNode is declared dead | silent leader triggers election |
| NameNode is a single point of failure, fixed later by HA NameNode with ZooKeeper | leader is a single point of failure, fixed by our election |

**The one difference worth pointing out, because it shows you understand the
design.** In HDFS the heartbeats flow **from the many DataNodes to the one
NameNode**, so the NameNode knows who is alive. In Concord the beacon flows
**from the one leader to the many followers**, so the followers know the leader
is alive. Opposite directions, because the two systems are protecting against
different failures. HDFS mostly worries about DataNodes dying. Concord mostly
worries about the leader dying.

> **Q: Does Concord do anything like MapReduce?**
> No. MapReduce is the computation half of Hadoop and Concord does no distributed
> computation. Our overlap is entirely with HDFS, the storage half.

### Kubernetes

**What it is.** A container orchestrator. You declare "I want three copies of
this container running" and Kubernetes makes it so, restarting containers that
crash, moving them off failed machines, and routing traffic to healthy ones. Key
concepts: **Pod** (a running container), **Deployment** (desired number of
replicas), **Service** (a stable address in front of pods), **liveness probe**
(an endpoint Kubernetes polls to check a pod is alive), **readiness probe** (an
endpoint that says a pod can take traffic), **PersistentVolume** (storage that
outlives the pod), and **leader election** for its own controllers, backed by
**etcd**, which uses the Raft algorithm.

**The comparison.** Open `docker-compose.yml`. It is a Kubernetes manifest with
the names changed.

| Kubernetes | In `docker-compose.yml` |
|---|---|
| Pod | one `node-N` service |
| Deployment with `replicas: 3` | three services built from the same image |
| Service | the `gateway`, a stable address in front of changing backends |
| liveness probe | `healthcheck: test: wget http://localhost:5001/health` |
| readiness gating | `depends_on: condition: service_healthy` on the gateway |
| restart policy | `restart: unless-stopped` |
| PersistentVolumeClaim | `volumes: [node-1-data:/app/data]` |
| DNS based service discovery | `PEERS: http://node-2:5002,http://node-3:5003` |
| etcd using Raft for consensus | our election, which is simplified Raft |

**Open `coordinator-node/server.js` and point at:**

```js
app.get('/health', (_req, res) => res.json({ nodeId: NODE_ID, dead, role: election.role }));
```

That is the liveness probe endpoint. Docker calls it every five seconds. Point
a Kubernetes `livenessProbe` at it and it works unchanged.

**What Kubernetes would add.** Right now `restart: unless-stopped` restarts a
crashed container on the same machine. Kubernetes would restart it on a
different machine if the first one died, and would keep the volume attached.
The election would still be ours, but placement and recovery would be automated
across a whole cluster of hosts.

> **Q: If Kubernetes does leader election, why write your own?**
> Kubernetes elects leaders for its own controllers, not for your application.
> An application that needs a leader still has to elect one, either by writing
> the algorithm as we did, or by using etcd or a Lease object as a lock. We wrote
> it so the mechanism is visible, which is the point of the project.

> **Q: Why Docker Compose and not Kubernetes itself?**
> Compose runs on one laptop with one command and shows every orchestration idea
> we need: health checks, dependencies, volumes, restart policies, DNS discovery.
> Kubernetes needs a cluster and adds nothing to the demonstration except setup
> time. The compose file translates to Kubernetes manifests almost line for line.

### Megaport

**What it is.** Network as a Service. Megaport runs a software defined network
connecting data centres and cloud providers, so a company can create a private
link from its AWS environment to its Azure environment, or to a colocation
facility, through a web portal in minutes rather than ordering physical circuits
over weeks.

**The comparison.** This is the weakest mapping in the unit and you should say
so rather than stretch it. Megaport solves the physical interconnection layer,
below anything Concord touches.

The one honest link: Megaport abstracts *where the network is* the way
Concord's gateway abstracts *where the nodes are*. Both present a stable simple
interface over a changing underlying topology. That is the transparency goal of
Unit 1 applied at the network layer.

> **Q: How does Megaport relate to your project?**
> Only in principle. If Concord's three coordinators ran in three different
> clouds, Megaport is the kind of service that would provide the private network
> between them. It sits entirely below our RPC layer.

---

## 4.6 Self study: blockchain and distributed ledger technologies

### What it means

A ledger is an append-only ordered record. A distributed ledger is one held
identically by many parties. A blockchain is a distributed ledger where each
entry contains a cryptographic hash of the previous entry, so changing any past
record breaks every hash after it and is immediately detectable.

The hard part of a blockchain is not the hashing, it is **consensus without a
trusted leader**. Bitcoin uses proof of work. Others use proof of stake or
Byzantine fault tolerant voting. The whole point is that no single party is
trusted to decide the order.

### How Concord uses it

**Concord has a ledger. It does not have a blockchain.** The distinction is the
entire lesson.

**Open `state/documentState.js`, `doc.log`.** It is:

- **append-only**: entries are pushed, never modified or removed
- **ordered**: every entry has a Lamport timestamp giving a total order
- **replicated**: every node holds an identical copy via the beacon
- **durable**: every node writes it to disk in `persist()`

Those are the ledger properties. Every edit ever made is recorded with who made
it, when in logical time, and what it did. The Version Timeline in the UI is a
ledger viewer.

**What makes it not a blockchain:**

| Blockchain property | Concord |
|---|---|
| entries hash-linked to the previous entry | no hashes, entries are plain objects |
| tamper evident | not tamper evident, the leader could rewrite the log |
| no trusted party decides order | the leader is fully trusted to decide order |
| consensus via proof of work, stake or BFT | consensus via majority election, which trusts elected nodes |

**The comparison to make out loud.** Concord's election is in the **Raft
family** of consensus: nodes trust each other, they only worry about crashes,
and a majority vote picks one node whose word is law. Blockchain consensus is in
the **Byzantine family**: nodes do not trust each other, any node might lie, and
the protocol must produce agreement anyway. Raft is far cheaper and is the right
choice when all nodes are run by one organisation. Blockchain consensus is the
right choice when they are not.

> **Q: Could you make the log a blockchain?**
> Adding a `prevHash` field to each log entry, computed as the SHA-256 of the
> previous entry, would make it tamper evident in a few lines. But it would still
> not be a blockchain in the meaningful sense, because the leader would still be
> trusted to decide the order. The hash chain detects tampering after the fact.
> It does not remove the trusted party.

> **Q: What is a smart contract, and does Concord have anything like it?**
> Code that runs deterministically on every node as part of applying a ledger
> entry. Concord's `applyOp` function is faintly similar: every node applies the
> same operation to the same state and must reach the same result. But it runs
> only on the leader with the result replicated, whereas a smart contract runs
> independently on every node and they compare answers.

---

## 4.7 Self study: trade-offs in the design of modern distributed databases

### What it means

**The CAP theorem.** A distributed data store can provide at most two of:

- **Consistency**: every read sees the latest write
- **Availability**: every request gets a response
- **Partition tolerance**: the system works even when the network splits

Network partitions happen whether you like it or not, so the real choice is:
when a partition occurs, do you stay **consistent** (refuse some requests) or
stay **available** (answer, possibly with stale data)?

**PACELC** extends it: even without a partition, you trade **latency** against
**consistency**, because waiting for all replicas to confirm is slower than
answering from one.

### How Concord uses it

**Concord is a CP system, and you can prove it live.**

Kill two of the three coordinators. Editing stops. The system has chosen to
refuse writes rather than accept them without a majority. That is consistency
over availability.

Why this is the right choice for a document: if the minority side kept accepting
edits, you would have two versions of the document that could never be merged.
Refusing is better than corrupting.

**The trade-offs Concord made, explicitly:**

| Decision | Choice | Trade-off accepted |
|---|---|---|
| partition behaviour | CP, refuse writes without majority | availability drops when two nodes die |
| replication | asynchronous, leader does not wait for followers | fast writes, but a crash inside the 800ms beacon window loses the newest edits |
| durability | snapshot to disk after every change | survives any restart, but O(document) per write |
| write path | single leader | strong consistency for writes, but no write scaling |
| read path | any client holds a pushed copy | reads are instant and local, but a client that missed a broadcast is briefly stale |

**Consistency models present in Concord**, from strongest to weakest:

- **Linearizable writes at the leader.** Every edit passes through `withLock` on
  one node, so there is a single total order and no two edits interleave.
- **Eventual consistency at the followers.** They receive snapshots every 800ms
  and catch up. "Capture global state" showing a follower one version behind is
  this model, visible.
- **Read-your-writes at the client.** The broadcast goes back to the sender, so
  you always see your own edit reflected in the authoritative state.

> **Q: Is your system AP or CP?**
> CP. When a partition removes the majority, the minority has no leader and
> refuses writes. We chose consistency because a document with two divergent
> histories is worse than a document that is briefly read only.

> **Q: How would you make it AP instead?**
> Let every node accept writes during a partition and merge afterwards with a
> CRDT, a data structure designed so that concurrent updates always merge to the
> same result. That is how systems like Riak and modern collaborative editors
> work. It is much harder, which is why we did not.

> **Q: Where is the PACELC latency trade-off in your code?**
> `heartbeat/beacon.js`. The leader fires beacons with `.catch(() => {})` and no
> `await`. It never waits for a follower to acknowledge. That is choosing low
> latency over consistency in the no-partition case. Making it `await` every
> follower would give synchronous replication: no data loss window, but every
> keystroke would be as slow as the slowest follower.

> **Q: What would a modern database do differently?**
> Append to a write ahead log rather than rewriting a snapshot, so each write is
> O(edit) not O(data). Replicate synchronously to at least one follower before
> acknowledging, so a leader crash loses nothing. Shard the data across many
> leaders so writes scale. Each of these is a well understood step from where
> Concord is, and each costs latency or complexity.

---

# CHEAT SHEET

| If asked about | Open | Say |
|---|---|---|
| object-based systems | `coordinator-node/server.js`, `methods` table | that table is our interface definition, `rpc()` is the proxy, `/rpc` is the skeleton |
| web-based systems | `gateway/server.js` | the gateway is a reverse proxy, WebSocket in, RPC out, stateless |
| distributed file systems | `documentState.js`, `persist()` and `restore()` | three nodes, three files, one document. primary copy replication, factor 3, like HDFS |
| serverless | `documentState.js`, the `doc` object | this state is why the coordinator cannot be a function |
| containers | `docker-compose.yml` | one image three identities, DNS discovery, a volume per node, health checks |
| Cloudflare | Cluster panel, the leader | a Durable Object is a managed version of our leader |
| AWS | `docker-compose.yml` | three containers now, three Availability Zones in production |
| Hadoop | `heartbeat/beacon.js` | same heartbeat idea as HDFS, opposite direction |
| Kubernetes | `docker-compose.yml` `healthcheck` | that is a liveness probe, the compose file is a manifest with the names changed |
| Megaport | nothing to open | below our layer, know what it is, do not stretch |
| blockchain | `doc.log` | a ledger with a trusted leader, not a blockchain, and here is the difference |
| database trade-offs | kill two nodes | editing stops, that is CP, and here is why we chose it |

# THE FIVE SENTENCES

1. **"Each coordinator is a distributed object, and the `methods` table is its
   interface."** `rpc()` is the proxy, the `/rpc` route is the skeleton.

2. **"Three nodes, three files, one document."** Every node persists its own
   replica to disk and reloads it on boot. Destroy the whole cluster and bring it
   back, nothing is lost.

3. **"The compose file is a Kubernetes manifest with the names changed."**
   Health checks are liveness probes, `depends_on` is readiness gating, named
   volumes are persistent volume claims.

4. **"We have a ledger, not a blockchain."** Append-only, ordered, replicated,
   durable, but the leader is trusted. Blockchain exists to remove that trust.

5. **"Concord is CP. Kill two nodes and editing stops."** We chose a briefly
   read-only document over a permanently split one.

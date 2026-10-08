# Concord: Unit 3, Synchronization

FA-2 viva preparation for Unit 3.

For each topic: what the idea means, then exactly how Concord uses it, with the
file and function you can open on screen. Where Concord does **not** implement a
topic, that is said plainly. "We do not do X, here is why and here is what we
would do" is a strong answer. Claiming X when you do not is a weak one.

> Theory facts about algorithms Concord does not implement (Cristian, Berkeley,
> Lodha-Kshemkalyani, Knapp) are written from memory. Check the numbers against
> your slides or textbook before the viva.

Where Concord stands for each topic:

| Topic | Concord status |
|---|---|
| Clock synchronization | **not implemented**, deliberately replaced by logical clocks |
| Logical clocks, Lamport | **implemented**, `clocks/lamportClock.js` |
| Vector clocks | **implemented**, `clocks/vectorClock.js` |
| Global state | **implemented in a simple form**, not a Chandy-Lamport snapshot |
| Election algorithms | **implemented**, randomised timeout, term, majority vote |
| Mutual exclusion | **implemented**, centralized, at the leader |
| Beacon protocol | **implemented**, `heartbeat/beacon.js` |
| Lodha-Kshemkalyani (self study) | **not implemented**, contrast with our design |
| Knapp's classification (self study) | **not applicable**, one lock means no deadlock |

---

## 3.1 Clock synchronization

### What it means

Every machine has its own physical clock and every clock drifts. Two machines
never agree exactly on "now". Clock synchronization tries to bring them close.

- **Cristian's algorithm.** Ask a time server for the time `T`. Set your clock to
  `T + RTT/2`, assuming the reply took half the round trip.
- **Berkeley algorithm.** A coordinator polls every machine, averages the clocks,
  and tells each machine how much to adjust. No machine holds the true time.
- **NTP.** A hierarchy of time servers (strata) with filtering of delay and offset.

None of them gives exact agreement. The error is bounded by network delay, which
is why logical clocks exist.

### How Concord uses it

**Concord does not synchronize physical clocks. It avoids needing them.**

- Ordering of edits comes from Lamport and vector clocks (3.2, 3.3), which need no
  shared time.
- Physical time is used only for local durations: the 800ms beacon interval and
  the 1500 to 3000ms election timeout. A duration measured on one machine is not
  affected by drift between machines.
- Every edit also stores `wallClock: Date.now()` (`documentState.js`,
  `submitEdit`). It is shown in the Version Timeline for humans and is **never used
  for ordering or conflict resolution**.

> **Q: Why no clock synchronization?**
> Because we never need to compare times from two machines. Edits are ordered by
> logical clocks, and the only wall clock use is a timer on one machine. We avoided
> the problem instead of solving it.
>
> **Q: What would you add if you needed real time?**
> Berkeley is the natural fit. The leader already polls every node, so it could
> average their clocks and send each an offset. Cristian with the leader as the
> time server is the simpler option.

---

## 3.2 Logical clocks and Lamport's algorithm

### What it means

Lamport's insight: for ordering events you do not need real time, only the
happened-before relation. A Lamport clock is one counter per process:

1. Before a local event or a send, increment the counter.
2. On receiving a message with timestamp `t`, set `counter = max(counter, t) + 1`.

Guarantee: if event A happened before B, then `L(A) < L(B)`.
The reverse is **not** true: `L(A) < L(B)` does not mean A caused B.

### How Concord uses it

`coordinator-node/clocks/lamportClock.js`:

```js
tick()          { this.time += 1; }
update(t = 0)   { this.time = Math.max(this.time, t) + 1; }
```

The coordinator calls `update` on every edit in `submitEdit`. The browser keeps its
own counter in `App.jsx`: it adds 1 when it sends an edit and applies
`max(local, received) + 1` when an update arrives.

**Why the Version Timeline jumps by 3.** One keystroke touches the clock three
times: the browser ticks when it sends (+1), the leader applies `update` (+1), and
the browser applies `update` again when the result is broadcast back (+1). That is
why L goes 2, 5, 8, 11.

Lamport timestamps are used as the **conflict tie-breaker**: higher Lamport wins
(3.8).

> **Q: Does a bigger Lamport value mean it happened later?**
> Not necessarily. Happened-before implies a smaller value, but a smaller value does
> not imply happened-before. Two unrelated events can have any order. That gap is
> exactly why we also keep vector clocks.

---

## 3.3 Vector clocks (the vector algorithm)

### What it means

A vector clock keeps one counter per process. Rules:

1. On a local event, increment your own entry.
2. On receiving a message, take the element-wise `max` of the two vectors.

Compare two vectors `a` and `b`:

- every entry of `a` is `<=` the entry in `b`, and at least one is smaller: `a` is
  **before** `b`.
- the reverse: `a` is **after** `b`.
- some entries bigger in `a`, others bigger in `b`: **concurrent**.

Unlike Lamport, vector clocks **detect concurrency**.

### How Concord uses it

`coordinator-node/clocks/vectorClock.js` has `increment`, `merge`, and `compare`.
`compare` returns `'concurrent'` exactly when both sides are ahead somewhere.

The log entry for each edit stores its vector clock (`entry.vectorClock`), built
from what the client knew when it typed plus one tick for itself.

One subtle line in `submitEdit` is worth knowing:

```js
// do not merge the doc vector in here or nothing ever looks concurrent
const editVC = increment(vectorClock, clientId);
```

The edit's vector reflects what **the client had seen**, not what the server has.
That is the whole point: if the client had not seen another client's edit, the two
vectors are concurrent.

**Demo.** Tick "simulate network partition" in one tab, type in both tabs, untick.
The offline tab ignores incoming updates (`if (offlineRef.current) return` in
`App.jsx`), so its vector falls behind and its edits come out concurrent.

> **Q: Lamport versus vector clocks?**
> Lamport gives one number and a consistent order. Vector clocks give one number per
> client and can say whether two events are ordered or concurrent. We use vectors to
> detect conflicts and Lamport to break them.

---

## 3.4 Global state

### What it means

A distributed system has no single place to look at "the state". A **global state**
is a collection of local states, and it is **consistent** (a consistent cut) if it
contains no message receipt whose send is missing.

The classic solution is the **Chandy-Lamport snapshot**: one process records its
state and sends a marker on every channel. A process that receives its first marker
records its own state, then sends markers on its outgoing channels. Messages that
arrive on a channel before its marker are recorded as that channel's state.

### How Concord uses it

`state/globalStateSync.js`, `collectGlobalState()`. The **Capture global state**
button in the Cluster panel (or `GET /api/global-state`) triggers it.

What it really does: the leader asks every node for its `status` in parallel and
gathers version, Lamport value and vector clock. It then:

- compares each node's vector clock to the leader's (`agreement`: before, after,
  equal), and
- sets `consistent: true` if all live nodes hold the **same document version**.

**Be honest about this.** It is a polled snapshot, not Chandy-Lamport. There are no
markers and no channel state, and the status calls are not atomic, so a node can
change between two calls. The `consistent` flag is a version-equality check. It
catches the useful case: backups lagging behind the leader.

> **Q: Is this a Chandy-Lamport snapshot?**
> No. It collects each replica's state and checks that the versions agree. A real
> consistent cut needs marker messages to capture messages in flight. Because
> replication here is asynchronous, a backup showing an older version is normal for
> up to one beacon interval.

---

## 3.5 Election algorithms

### What it means

When the coordinator dies, the rest must agree on a new one.

- **Bully.** The highest id wins. A node that notices the failure challenges every
  higher id, and the highest live one takes over.
- **Ring.** An election message circulates around a logical ring collecting ids.
- **Raft style.** Randomised timeouts, numbered terms, and a majority vote.

### How Concord uses it

`election/leaderElection.js` is Raft style.

- **Randomised timeout** (`randomTimeout`): 1500 to 3000ms. Nodes do not all become
  candidates at once, which would split the votes.
- **Terms.** A candidate increments `term` and asks for votes. A higher term always
  makes a node step down to follower.
- **One vote per term** (`votedFor`).
- **Majority** (`majority = floor((peers + 1) / 2) + 1`). With 3 nodes, 2 votes.
  This is what prevents two leaders in one term.
- **Freshness check.** A node refuses to vote for a candidate whose document
  version is behind its own, so a stale node cannot win and overwrite committed
  edits.
- **Stale leader.** `handleBeacon` rejects a beacon from an older term.

Seeing `lost term 1 with 1 votes` right after startup is normal: a candidate
started before its peers were listening, then retried.

> **Q: Why a majority?**
> Two disjoint groups cannot both contain a majority, so at most one leader exists
> per term. The price is that with 2 of 3 nodes down no leader can be elected, and
> the system refuses writes.
>
> **Q: Why randomised timeouts instead of Bully's highest id?**
> Bully needs ids and assumes a reliable detector. Randomisation breaks symmetry
> with no ordering of nodes, and the term plus majority makes it safe under
> partitions.

---

## 3.6 Mutual exclusion

### What it means

Only one process may be in the critical section at a time.

- **Centralized.** A coordinator grants the lock: request, grant, release. 3
  messages per entry. Simple, but the coordinator is a single point of failure.
- **Lamport's algorithm.** Fully distributed. Requests are broadcast and ordered by
  Lamport timestamp. About 3(N-1) messages per entry.
- **Ricart-Agrawala.** Lamport's idea with release messages merged into replies.
  2(N-1) messages.
- **Token ring.** A token circulates, and holding it means permission.

### How Concord uses it

`state/documentState.js`: `acquire`, `release`, `withLock`.

```js
let locked = false;
const waiting = [];
```

`submitEdit` runs inside `withLock`. If the lock is held, the caller's promise is
pushed onto `waiting` and resumed in **FIFO** order on `release`. The `finally` in
`withLock` guarantees the lock is released even if the edit throws.

This is the **centralized algorithm**: the leader is the single coordinator, which
is also why writes are only accepted by the leader. If the leader dies, a new
election picks a new coordinator and its queue starts empty.

> **Q: Why centralized?**
> The system already has one leader that serializes writes, so a distributed
> algorithm would add messages without removing the bottleneck. The single point of
> failure is covered by re-election.

---

## 3.7 Beacon protocol

### What it means

A periodic "I am alive" message, so others can tell silence from health.

### How Concord uses it

`heartbeat/beacon.js`:

- The leader sends a beacon every **800ms** (`BEACON_MS`) to every follower.
- Followers reset their election timer on each beacon (`handleBeacon`). Silence for
  longer than the 1500 to 3000ms timeout means the leader is presumed dead.
- 800ms is well under 1500ms, so one lost beacon does not start an election.
- Each beacon also carries a **full document snapshot**. That is how backups stay
  up to date (`applySnapshot`), which makes the beacon both failure detector and
  replication channel.
- It is fire and forget (`.catch(() => {})`). A slow follower must never stall the
  leader.

**Known limit.** Replication is asynchronous, so a crash inside the 800ms window can
lose the latest edits.

> **Q: How do you detect a failed leader?**
> Followers expect a beacon every 800ms. If none arrives within their own
> randomised timeout of 1500 to 3000ms, they assume it died and start an election.
> The detector is unreliable by nature: a slow network looks like a dead leader,
> which is why terms exist to resolve a wrong guess.

---

## 3.8 Conflict resolution (ties the clocks together)

`merge/conflictResolver.js`:

1. `findConflict` looks back over the last 25 log entries for one that is from a
   **different client**, **concurrent** by vector clock, and **overlaps** the same
   text range (`overlaps`, with a slack of 1 character). Concurrent edits in
   different parts of the text are **not** conflicts.
2. `resolve`: higher Lamport timestamp wins. On a tie, the smaller client id wins.
   The rule is deterministic, so every node picks the same winner.
3. If the existing edit wins, the incoming one is logged with status `discarded` and
   the text is unchanged. If the incoming one wins, it is `applied-over-conflict`.

**Limit to admit.** This is a last-writer-wins style rule. The loser's edit is
dropped. The proper fix would be Operational Transformation or a CRDT.

---

## 3.9 Self study: Lodha and Kshemkalyani's fair mutual exclusion

### What it means

*Fairness* means requests are served in the order they were **made**, defined by the
happened-before relation. Lamport timestamps respect happened-before but order
concurrent requests arbitrarily. Lodha and Kshemkalyani (IEEE TPDS, 2000) give a
distributed algorithm where each site asks permission from a request set (a subset
of sites, like a quorum), using logical clocks to keep service in causal order. From
memory its cost is roughly 3(sqrt N - 1) to 5(sqrt N - 1) messages per entry, lower
than Ricart-Agrawala. **Verify the numbers.**

### How Concord relates

Concord does **not** implement it. Its fairness is **arrival order at the leader**:
the FIFO `waiting` queue. That is fair in practice, but two requests that arrive
out of causal order are served in arrival order.

> **Q: How does your mutual exclusion compare?**
> Ours is centralized and FIFO, with 3 messages per entry and a single point of
> failure covered by election. Lodha-Kshemkalyani removes the central coordinator and
> gives causal fairness, at the cost of a more complex protocol.

---

## 3.10 Self study: Knapp's classification of deadlock detection

### What it means

Knapp (1987) groups distributed deadlock detection into four families:

| Class | Idea |
|---|---|
| Path-pushing | Sites send wait-for-graph paths to each other |
| Edge-chasing | A probe follows wait-for edges. If it returns to its initiator, there is a cycle. |
| Diffusing computation | Queries spread outward and replies are aggregated |
| Global state detection | Take a consistent snapshot and look for a cycle |

### How Concord relates

**Concord cannot deadlock.** Deadlock needs processes holding one resource while
waiting for another. Concord has **one** lock on **one** document, so there is no
hold-and-wait. The closest related piece is `collectGlobalState()` (3.4), the
building block of the global state detection family.

> **Q: How do you handle deadlock?**
> We cannot deadlock by design: a single lock means no cycle can form. If we added a
> lock per paragraph, edge-chasing probes would fit best, because they need no
> central graph.

---

## Quick demo map

| Say | Show |
|---|---|
| Logical clocks | **Version Timeline** panel, the L and VC values |
| Concurrency and conflict | Partition checkbox, type in both tabs, **Conflicts** panel |
| Global state | **Capture global state** button in the **Cluster** panel |
| Election and beacon | Kill the leader, watch the Cluster panel and `docker compose logs -f` |
| Mutual exclusion | Explain `withLock` in `documentState.js` |
| Majority edge case | Stop 2 of 3 nodes, editing stops. Start one, it resumes. |

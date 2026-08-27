# moira — SPEC (v0)

Status: draft. This document defines what v0 is and, more importantly, what it is not.

## 1. Goal

A protocol author should be able to write this:

```ts
class Raft implements Process<RaftState> { /* onInit, onMessage, onTimer */ }
```

run this:

```ts
const result = simulate({
  seed: 0xC0FFEE,
  nodes: 5,
  process: Raft,
  network: { latency: [10, 50], dropRate: 0.02, partitions: schedule },
  invariants: [atMostOneLeaderPerTerm],
  until: { simTime: 60_000 },
});
```

and, when it fails, get this:

```
✗ invariant violated: atMostOneLeaderPerTerm
  at simTime=13480, step=8842
  nodes 2 and 4 both leader in term 7
  replay: moira replay --seed 0xC0FFEE --trace out/0xC0FFEE.jsonl
```

## 2. Non-goals for v0

Byzantine behaviour. Trace shrinking. Modelling CPU time (event handlers are instantaneous).
Real sockets. Disk model. Multiple protocols — v0 ships Raft only. Editing traces in the UI.

## 3. Core interfaces

```ts
type NodeId = number;
type SimTime = number;            // logical milliseconds since t=0

interface Ctx<S> {
  readonly me: NodeId;
  readonly peers: readonly NodeId[];
  state: S;

  now(): SimTime;                 // logical clock, never wall clock
  random(): number;               // [0,1), from the per-node seeded PRNG

  send(to: NodeId, msg: Message): void;
  broadcast(msg: Message): void;

  setTimer(name: string, delayMs: number): void;   // replaces an existing timer of the same name
  cancelTimer(name: string): void;

  log(event: string, data?: Record<string, unknown>): void;
  crash(): void;                  // self-crash; state is lost unless marked persistent
}

interface Process<S> {
  init(ctx: Ctx<S>): S;
  onMessage(ctx: Ctx<S>, from: NodeId, msg: Message): void;
  onTimer(ctx: Ctx<S>, name: string): void;
  onRestart?(ctx: Ctx<S>, persisted: Partial<S>): void;
}
```

A process may only observe the world through `ctx`. Reading another node's state from inside a
process is not prevented by the type system in v0 — it is prevented by review, and it is the one
thing that makes a protocol implementation worthless.

## 4. The scheduler

A single-threaded loop over a priority queue of events, ordered by `(time, sequence)`.
`sequence` is a monotonic counter assigned at insertion; it is the tiebreaker that makes ordering
total and therefore reproducible. Ties must never be broken by object identity, insertion into a
`Map`, or anything the JS engine chooses for us.

Event kinds: `Deliver`, `Timer`, `Crash`, `Restart`, `PartitionStart`, `PartitionEnd`.

One step = pop one event, dispatch it, append the resulting effects to the queue, run invariants.
The loop terminates on: `until.simTime` reached, `until.steps` reached, queue empty, or an
invariant violation.

Every draw from the PRNG happens in the engine, in a fixed order per step. Per-node PRNGs are
derived from the root seed as `hash(rootSeed, nodeId)` so that adding a node does not reshuffle
the random stream of existing nodes.

PRNG: a small, self-contained xoshiro128** or PCG32. Written in-repo, not a dependency (ADR-004).

## 5. Trace format

Append-only JSONL. One object per event. This file is the interface between the engine and every
consumer — CLI output, the studio UI, future tooling.

```jsonc
{"t":0,    "seq":0, "kind":"init",      "node":1}
{"t":150,  "seq":42,"kind":"send",      "from":1,"to":3,"msgId":88,"msg":{"type":"RequestVote","term":2}}
{"t":183,  "seq":43,"kind":"deliver",   "msgId":88}
{"t":183,  "seq":44,"kind":"drop",      "msgId":89,"reason":"partition"}
{"t":183,  "seq":45,"kind":"state",     "node":3,"patch":{"role":"follower","term":2}}
{"t":200,  "seq":50,"kind":"timer",     "node":1,"name":"election"}
{"t":900,  "seq":91,"kind":"fault",     "fault":"partition","groups":[[1,2],[3,4,5]]}
{"t":1340, "seq":99,"kind":"violation", "invariant":"atMostOneLeaderPerTerm","detail":"..."}
```

Rules: `state` events carry patches, not full snapshots — the viewer reconstructs by folding.
`msgId` is assigned at send and is how send/deliver/drop are correlated. The header line records
seed, node count, network config and moira version so a trace is self-describing.

## 6. Network model

```ts
interface NetworkModel {
  // Called once per send. Returns delivery instructions; all randomness via the engine PRNG.
  route(msg: InFlight, rng: Rng, now: SimTime): Delivery[];  // [] means dropped
}
```

`DefaultNetwork` supports: latency drawn from a uniform or lognormal range, independent drop
probability, duplication probability, and hard partitions defined as a list of disjoint node
groups with a start and end time. Messages crossing a partition boundary are dropped, not delayed.

## 7. Invariants

```ts
interface Invariant {
  name: string;
  check(world: WorldView): string | null;   // null = holds, string = violation detail
}
```

`WorldView` gives deep-frozen read-only access to every node's state, the set of crashed nodes,
current simTime, and the event history so far. Invariants run after every step by default;
expensive ones can declare `every: n` steps.

v0 ships `atMostOneLeaderPerTerm` and `logPrefixMatch`.

## 8. Fuzzing

`moira fuzz --seeds 10000 --protocol raft` runs the same scenario across N seeds, in parallel
worker threads (the engine is single-threaded per run, so this parallelises trivially), and
reports every violating seed with the step at which it broke. Each failure prints a one-line
replay command. Shrinking is v1.

## 9. Studio

Vite + React. Loads a `.jsonl` trace via file picker or URL. Renders:

- one horizontal lane per node, time on the x-axis
- messages as arcs from sender lane to receiver lane; dropped messages as arcs that stop short
- partitions as shaded bands across the affected lanes
- a scrubber; the state panel shows each node's folded state at the playhead
- clicking a message highlights its send and deliver events

The studio imports the trace schema type and nothing else from the engine (ADR-003).

## 10. Acceptance criteria for v0

1. `simulate()` with a fixed seed produces a byte-identical trace across runs, machines and
   Node versions. Enforced in CI by hashing.
2. A 5-node Raft cluster elects exactly one leader and replicates entries under a lossy network.
3. Under a `[1,2] | [3,4,5]` partition, the minority side elects no leader; after healing, the
   cluster converges to one leader and consistent logs.
4. `fuzz --seeds 1000` completes in under two minutes on a laptop.
5. The studio replays the partition scenario and the split is visible without reading any code.

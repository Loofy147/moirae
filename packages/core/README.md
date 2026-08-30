# @nemea/core

The [nemea](https://github.com/pchrysostomou/nemea) engine: deterministic simulation testing for
distributed systems, in TypeScript, with zero dependencies. You write a protocol against a small
interface; the engine runs it under a deterministic scheduler with injected faults — latency, loss,
duplication, partitions, crashes — checks your invariants after every step, and writes a JSONL
trace you can replay and scrub through.

## The interface

```ts
interface Process<S> {
  persistent?: readonly (keyof S)[];   // state fields that survive a crash
  init(ctx: Ctx<S>): S;
  onMessage(ctx: Ctx<S>, from: NodeId, msg: Message): void;
  onTimer(ctx: Ctx<S>, name: string): void;
  onRestart?(ctx: Ctx<S>, persisted: Partial<S>): void;
}

interface Ctx<S> {
  readonly me: NodeId;
  readonly peers: readonly NodeId[];
  state: S;
  now(): SimTime;                              // logical clock, never wall clock
  random(): number;                            // [0,1), per-node seeded PRNG
  randomInt(min: number, max: number): number; // integer in [min, max]
  send(to: NodeId, msg: Message): void;
  broadcast(msg: Message): void;
  setTimer(name: string, delayMs: number): void;
  cancelTimer(name: string): void;
  log(event: string, data?: Record<string, unknown>): void;
  crash(): void;
}
```

A process sees the world only through `ctx`. There is no other way to get the time, a random
number, or a timer.

## Run one

```ts
import { simulate } from '@nemea/core';

const result = simulate<State>({
  seed: 0xc0ffee,
  nodes: 5,
  process: MyProtocol,            // a class implementing Process<State>
  until: { simTime: 5_000 },
  network: {
    latency: [10, 50],
    dropRate: 0.02,
    partitions: [{ groups: [[1, 2], [3, 4, 5]], start: 1000, end: 2000 }],
  },
  faults: { crashes: [{ node: 3, at: 2500, restartAt: 3000 }] },
  invariants: [myInvariant],      // { name, check(world): string | null }
});

result.violation; // null, or { invariant, detail, step, time }
result.jsonl;     // the trace — `npx nemea replay` opens it
```

A sketch; the runnable, typechecked version is
[`examples/src/ping.ts`](https://github.com/pchrysostomou/nemea/blob/main/examples/src/ping.ts).

## Determinism

Same seed, same trace, byte for byte — across runs, machines and Node versions; the project's CI
hashes its example traces on Node 20, 22 and 24 on every push. When a run finds a violation, the
seed is the whole bug report.

The interfaces, precisely: [SPEC.md](https://github.com/pchrysostomou/nemea/blob/main/docs/SPEC.md).
Repository: https://github.com/pchrysostomou/nemea. Apache-2.0.

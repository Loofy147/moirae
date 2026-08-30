// examples/src/ping.ts — the protocol in the README, kept real: this file is
// typechecked and linted under the same rules as the shipped protocols, and
// CI asserts that the README's copy is identical to it.

import { simulate, type Ctx, type Process, type SimulationResult } from 'moirae-core';

interface State {
  count: number;
  [field: string]: unknown;
}

// Every node pings its first peer on a timer. Time, randomness and timers
// come from ctx, and from nowhere else.
class Ping implements Process<State> {
  init(ctx: Ctx<State>): State {
    ctx.setTimer('tick', ctx.randomInt(10, 30));
    return { count: 0 };
  }
  onTimer(ctx: Ctx<State>): void {
    ctx.state.count++;
    ctx.send(ctx.peers[0] as number, { type: 'ping', n: ctx.state.count });
    ctx.setTimer('tick', 30);
  }
  onMessage(ctx: Ctx<State>): void {
    ctx.state.count++;
  }
}

export function run(): SimulationResult {
  return simulate<State>({
    seed: 0xc0ffee,
    nodes: 3,
    process: Ping,
    until: { simTime: 5_000 },
    network: {
      latency: [10, 50],
      dropRate: 0.02,
      partitions: [{ groups: [[1], [2, 3]], start: 1000, end: 2000 }],
    },
    faults: { crashes: [{ node: 2, at: 2500, restartAt: 3000 }] },
    invariants: [
      {
        name: 'countNeverNegative',
        check: (world) => (world.nodes.some((n) => n.state !== null && n.state.count < 0) ? 'negative' : null),
      },
    ],
  });
}

// run().violation is null, or { invariant, detail, step, time } — and the seed
// above reproduces it. run().jsonl is the trace: `npx moirae replay` opens it.

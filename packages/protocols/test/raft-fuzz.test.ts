import { describe, expect, it } from 'vitest';
import { Pcg32, simulate } from '@moira/core';
import type { CrashSchedule, NetworkConfig, Partition } from '@moira/core';
import { electionSafety, logMatching, stateMachineSafety } from '../src/index';
import type { RaftState } from '../src/index';
// The workload driver lives with the examples; see examples/src/workload.ts.
import { RaftWithLoad } from '../../../examples/src/workload';

// docs/RAFT.md scenario 6: many seeds, 2% loss, random partitions (and a
// crash/restart on half of them), no invariant violation. The schedule for a
// seed is derived from the seed with the engine's own PRNG, so a failing seed
// reproduces exactly. SEEDS is bounded to keep the CI matrix fast; the §8
// fuzz CLI is where thousands of seeds become routine.

const SEEDS = 200;
const SIM_TIME = 4000;

function scenario(seed: number): { network: NetworkConfig; faults: { crashes: CrashSchedule[] } } {
  const rng = new Pcg32(BigInt(seed), 99n);
  const latencyMax = 5 + Math.floor(rng.random() * 60);
  const partitions: Partition[] = [];
  const count = 1 + Math.floor(rng.random() * 3);
  let t = 500 + Math.floor(rng.random() * 500);
  for (let i = 0; i < count && t < SIM_TIME - 800; i++) {
    const a: number[] = [];
    const b: number[] = [];
    for (let node = 1; node <= 5; node++) (rng.random() < 0.5 ? a : b).push(node);
    if (a.length === 0) a.push(b.pop() as number);
    if (b.length === 0) b.push(a.pop() as number);
    const end = t + 200 + Math.floor(rng.random() * 800);
    partitions.push({ groups: [a, b], start: t, end });
    t = end + 1 + Math.floor(rng.random() * 400);
  }
  const crashes: CrashSchedule[] = [];
  if (rng.random() < 0.5) {
    const at = 300 + Math.floor(rng.random() * 2500);
    crashes.push({
      node: 1 + Math.floor(rng.random() * 5),
      at,
      restartAt: at + 300 + Math.floor(rng.random() * 1000),
    });
  }
  return { network: { latency: [5, latencyMax], dropRate: 0.02, partitions }, faults: { crashes } };
}

describe('Raft fuzz (docs/RAFT.md scenario 6)', () => {
  it(`holds every invariant across ${SEEDS} seeds with loss, partitions and crashes`, () => {
    let elections = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { network, faults } = scenario(seed);
      const result = simulate<RaftState>({
        seed,
        nodes: 5,
        process: RaftWithLoad,
        until: { simTime: SIM_TIME },
        network,
        faults,
        invariants: [electionSafety(), logMatching(), stateMachineSafety()],
      });
      expect(result.violation, `seed ${seed}: ${JSON.stringify(result.violation)}`).toBeNull();
      elections += result.trace.filter(
        (e) => (e as { kind: string; patch?: { role?: string } }).kind === 'state' && (e as { patch?: { role?: string } }).patch?.role === 'leader',
      ).length;
    }
    expect(elections).toBeGreaterThan(SEEDS); // the runs really elected leaders
  }, 600_000);
});

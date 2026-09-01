import { describe, expect, it } from 'vitest';
import { Pcg32, simulate } from 'moirae-core';
import type { CrashSchedule, NetworkConfig, Partition } from 'moirae-core';
import { agreement, proposalIntegrity, validity } from '../src/index';
import type { PaxosState } from '../src/index';
import { PaxosContend } from './paxos-load';

// docs/PAXOS.md scenario 5: many seeds, loss, random partitions, a crash and
// restart on half of them, five contending proposers — no invariant
// violation, ever. The schedule for a seed is derived from the seed with the
// engine's own PRNG, so a failing seed reproduces exactly.
//
// agreement() holds vacuously when nothing is learned (§2.4: liveness is not
// guaranteed), so the gate also asserts a convergence floor across seeds —
// the positive sibling that keeps this test from passing on a Paxos that
// never chooses anything.

const SEEDS = 200;
const SIM_TIME = 4000;
const LEARN_FLOOR = 180; // measured 200/200; the floor catches a Paxos that stops choosing

function scenario(seed: number): { network: NetworkConfig; faults: { crashes: CrashSchedule[] } } {
  const rng = new Pcg32(BigInt(seed), 98n);
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

describe('Paxos fuzz (docs/PAXOS.md scenario 5)', () => {
  it(`holds every invariant across ${SEEDS} seeds with loss, partitions and crashes`, () => {
    let learnedSeeds = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { network, faults } = scenario(seed);
      const result = simulate<PaxosState>({
        seed,
        nodes: 5,
        process: PaxosContend,
        until: { simTime: SIM_TIME },
        network,
        faults,
        invariants: [agreement(), validity(), proposalIntegrity()],
      });
      expect(result.violation, `seed ${seed}: ${JSON.stringify(result.violation)}`).toBeNull();
      const learned = result.trace.some(
        (e) => (e as { kind: string; event?: string }).kind === 'log' && (e as { event?: string }).event === 'learned',
      );
      if (learned) learnedSeeds += 1;
    }
    expect(learnedSeeds).toBeGreaterThanOrEqual(LEARN_FLOOR);
  }, 600_000);
});

// The stress scenario. Five Raft nodes with loss and 5% duplication, two
// consecutive partitions with different splits and no healed gap between them
// (the majority flips from {3,4,5} to {1,2,3}), and three crashes — one before
// the partitions, one mid-partition on the majority side (leaving {4,5} alone,
// which is no majority), one after healing. Run `pnpm examples` to write the
// trace to out/harsh.jsonl.
//
// Why consecutive rather than overlapping partitions: the engine models one
// active partition at a time and rejects windows that overlap in time
// (SPEC §6). Nested or compound partitions would be an engine change.
//
// This run is what conflict-only truncation (RAFT.md #3) and the matchIndex
// echo (deviation D1) survive outside the scripted harness: duplicated and
// reordered AppendEntries, leaders changing under a stale leader's nose, and
// a follower restarting from its persisted log. Nine elections happen; all
// five nodes end with identical logs and identical applied sequences. The
// trace hash is pinned in examples/test/examples.test.ts.

import { simulate, type SimulationResult } from 'moirae-core';
import { electionSafety, logMatching, stateMachineSafety, type RaftState } from 'moirae-protocols';
import { RaftWithLoad } from './workload';

export const name = 'harsh';

export function run(): SimulationResult {
  return simulate<RaftState>({
    seed: 0xbad,
    nodes: 5,
    process: RaftWithLoad,
    until: { simTime: 7000 },
    network: {
      latency: [10, 50],
      dropRate: 0.02,
      duplicateRate: 0.05,
      partitions: [
        { groups: [[1, 2], [3, 4, 5]], start: 1000, end: 2500 },
        { groups: [[1, 2, 3], [4, 5]], start: 2500, end: 3800 },
      ],
    },
    faults: {
      crashes: [
        { node: 4, at: 600, restartAt: 1400 },
        { node: 3, at: 1800, restartAt: 2200 },
        { node: 1, at: 4200, restartAt: 5000 },
      ],
    },
    invariants: [electionSafety(), logMatching(), stateMachineSafety()],
  });
}

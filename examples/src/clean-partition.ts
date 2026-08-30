// The clean scenario — the one the studio renders and the README GIF shows.
// Five Raft nodes, a lossy network, one partition, one crash: a readable
// story. Run `pnpm examples` to write the trace to out/clean-partition.jsonl.
//
// What this run does and does not prove. It ends in term 2: only two
// elections happen in six seconds, because the scenario is gentle — one
// partition, timeouts far above the round trip, a crash after the cluster
// has settled. That is evidence that the demo is legible, not evidence about
// Raft. The correctness argument is the ten pattern tests and the 200-seed
// fuzz in packages/protocols/test (1000 seeds before a release). Do not read a
// clean demo as a correctness claim.
//
// The trace hash is pinned in examples/test/examples.test.ts: any engine or
// protocol change that alters a single byte of this run fails the build.
//
// The seed is chosen so that the leader is on the MAJORITY side when the wall
// goes up. That is what makes the story visible: nodes 1 and 2 lose their
// leader, time out, become candidates again and again, and every vote request
// dies at the wall — they never become leader. (With the leader inside the
// minority, as a first seed happened to give, the minority simply keeps its
// stale leader and never even tries; a different, quieter story, which the
// studio's gate test in apps/studio/test/gate.test.ts would reject.) The
// minority's repeated elections raise its term, so on healing the majority
// leader steps down and one more election follows — the disruptive-server
// behaviour that pre-vote (out of scope) exists to prevent.

import { simulate, type SimulationResult } from '@moirae/core';
import { electionSafety, logMatching, stateMachineSafety, type RaftState } from '@moirae/protocols';
import { RaftWithLoad } from './workload';

export const name = 'clean-partition';

export function run(): SimulationResult {
  return simulate<RaftState>({
    seed: 19,
    nodes: 5,
    process: RaftWithLoad,
    until: { simTime: 6000 },
    network: {
      latency: [10, 50],
      dropRate: 0.02,
      // t=1500..3500: nodes 1 and 2 are cut off. They are two of five, so
      // they cannot elect a leader; nodes 3–5 elect one and carry on.
      partitions: [{ groups: [[1, 2], [3, 4, 5]], start: 1500, end: 3500 }],
    },
    // After healing, node 3 crashes and comes back with its persisted log.
    faults: { crashes: [{ node: 3, at: 4200, restartAt: 4800 }] },
    invariants: [electionSafety(), logMatching(), stateMachineSafety()],
  });
}

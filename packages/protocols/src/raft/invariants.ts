// Raft safety properties as engine invariants (SPEC §7), from Figure 3 of
// the paper. They live here, not in packages/core, because they are typed on
// RaftState; core stays protocol-agnostic.
//
// Election Safety and State Machine Safety are factories: each instance keeps
// a history across checks, because the world view only shows the present. A
// leader that stepped down or crashed before a second leader of the same term
// appeared, or an entry applied by a server that then crashed and re-applied
// something else at that index, is invisible to a check of current state
// alone. Create fresh instances per simulate() run.
//
// docs/RAFT.md: Election Safety and Log Matching both hold while Figure 8
// loses a committed entry — only State Machine Safety (or Leader
// Completeness) catches that class, so a fuzz gate must include one of them.

import type { Invariant, NodeId, WorldView } from '@nemea/core';
import type { RaftState } from './state';

// Figure 3 — "at most one leader can be elected in a given term."
export function electionSafety(): Invariant<RaftState> {
  const leaderOfTerm = new Map<number, NodeId>(); // lookup only, never iterated
  return {
    name: 'electionSafety',
    check(world: WorldView<RaftState>): string | null {
      for (const n of world.nodes) {
        if (n.state === null || n.state.role !== 'leader') continue;
        const term = n.state.currentTerm;
        const other = leaderOfTerm.get(term);
        if (other !== undefined && other !== n.id) {
          return `nodes ${other} and ${n.id} both leader in term ${term}`;
        }
        leaderOfTerm.set(term, n.id);
      }
      return null;
    },
  };
}

// Figure 3 — "if two logs contain an entry with the same index and term,
// then the logs are identical in all entries up through the given index."
export function logMatching(): Invariant<RaftState> {
  return {
    name: 'logMatching',
    check(world: WorldView<RaftState>): string | null {
      const live = world.nodes.filter((n) => n.state !== null);
      for (let a = 0; a < live.length; a++) {
        for (let b = a + 1; b < live.length; b++) {
          const na = live[a] as { id: NodeId; state: RaftState };
          const nb = live[b] as { id: NodeId; state: RaftState };
          const la = na.state.log;
          const lb = nb.state.log;
          // The highest index at which both hold an entry of the same term.
          let top = -1;
          for (let i = Math.min(la.length, lb.length) - 1; i >= 0; i--) {
            if (la[i]?.term === lb[i]?.term) {
              top = i;
              break;
            }
          }
          for (let i = 0; i <= top; i++) {
            const ea = la[i];
            const eb = lb[i];
            if (ea?.term !== eb?.term || ea?.command !== eb?.command) {
              return (
                `nodes ${na.id} and ${nb.id} share index ${top + 1} (term ${la[top]?.term}) ` +
                `but differ at index ${i + 1}`
              );
            }
          }
        }
      }
      return null;
    },
  };
}

// Figure 3 — "if a server has applied a log entry at a given index to its
// state machine, no other server will ever apply a different log entry for
// the same index." Checked against everything any server has ever applied.
export function stateMachineSafety(): Invariant<RaftState> {
  const applied = new Map<number, { command: string; by: NodeId }>(); // index -> first application; lookup only
  return {
    name: 'stateMachineSafety',
    check(world: WorldView<RaftState>): string | null {
      for (const n of world.nodes) {
        if (n.state === null) continue;
        for (let i = 0; i < n.state.applied.length; i++) {
          const command = n.state.applied[i] as string;
          const first = applied.get(i + 1);
          if (first === undefined) {
            applied.set(i + 1, { command, by: n.id });
          } else if (first.command !== command) {
            return `index ${i + 1}: node ${first.by} applied ${first.command}, node ${n.id} applied ${command}`;
          }
        }
      }
      return null;
    },
  };
}

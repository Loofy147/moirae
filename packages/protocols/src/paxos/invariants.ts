// Paxos safety properties as engine invariants (SPEC §7). They live here,
// not in packages/core, because they are typed on PaxosState; core stays
// protocol-agnostic.
//
// All three are factories with history, because the world view only shows
// the present: a node that learned a value and then crashed, or a ballot
// tally that was visible once, must still constrain every later check.
// Create fresh instances per simulate() run.
//
// agreement() alone holds vacuously on a run where nothing is learned; a
// gate that uses it must also assert that learning happened (the positive
// sibling — CLAUDE.md, and the floor assertion in paxos-fuzz).

import type { Invariant, NodeId, WorldView } from 'moirae-core';
import type { PaxosState } from './state';

// §2 — "only a single value is chosen", observed at the learners: no two
// nodes ever learn different values, and a node's learned value never
// changes. This is the invariant that catches data loss: two proposers each
// convinced their own value was chosen.
export function agreement(): Invariant<PaxosState> {
  let first: { value: string; by: NodeId } | null = null;
  const perNode = new Map<NodeId, string>(); // lookup only, never iterated
  return {
    name: 'agreement',
    check(world: WorldView<PaxosState>): string | null {
      for (const n of world.nodes) {
        if (n.state === null || n.state.learned === null) continue;
        const learned = n.state.learned;
        const before = perNode.get(n.id);
        if (before !== undefined && before !== learned) {
          return `node ${n.id} learned ${before}, then ${learned}`;
        }
        perNode.set(n.id, learned);
        if (first === null) {
          first = { value: learned, by: n.id };
        } else if (first.value !== learned) {
          return `node ${first.by} learned ${first.value}, node ${n.id} learned ${learned}`;
        }
      }
      return null;
    },
  };
}

// §2 — "only a value that has been proposed may be chosen." Proposals are
// recorded by propose() before any message leaves the proposer, so every
// learnable value has been seen here by the time any node can learn it.
export function validity(): Invariant<PaxosState> {
  const proposed = new Set<string>(); // membership only, never iterated
  return {
    name: 'validity',
    check(world: WorldView<PaxosState>): string | null {
      for (const n of world.nodes) {
        if (n.state === null) continue;
        for (const v of n.state.proposals) proposed.add(v);
      }
      for (const n of world.nodes) {
        if (n.state === null || n.state.learned === null) continue;
        if (!proposed.has(n.state.learned)) {
          return `node ${n.id} learned ${n.state.learned}, which nobody proposed`;
        }
      }
      return null;
    },
  };
}

// PAXOS.md #5 and #6 — a proposal number is bound to one value, ever,
// anywhere. Watches every accepted pair and every ballot tally; a second
// value under the same number means the disjoint numbering (C2) or the
// phase-2 binding broke.
export function proposalIntegrity(): Invariant<PaxosState> {
  const valueOf = new Map<number, { v: string; seenAt: NodeId }>(); // lookup only, never iterated
  return {
    name: 'proposalIntegrity',
    check(world: WorldView<PaxosState>): string | null {
      const claim = (n: number, v: string, node: NodeId): string | null => {
        const before = valueOf.get(n);
        if (before === undefined) {
          valueOf.set(n, { v, seenAt: node });
          return null;
        }
        if (before.v !== v) {
          return `proposal ${n} carries ${before.v} (node ${before.seenAt}) and ${v} (node ${node})`;
        }
        return null;
      };
      for (const n of world.nodes) {
        if (n.state === null) continue;
        if (n.state.acceptedN > 0 && n.state.acceptedV !== null) {
          const bad = claim(n.state.acceptedN, n.state.acceptedV, n.id);
          if (bad !== null) return bad;
        }
        for (const t of n.state.accepts) {
          const bad = claim(t.n, t.v, n.id);
          if (bad !== null) return bad;
        }
      }
      return null;
    },
  };
}

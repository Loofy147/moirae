// Single-decree Paxos state, transcribed from Lamport, "Paxos Made Simple"
// (2001). Section references throughout packages/protocols/src/paxos are to
// that paper. Every node plays all three roles (§2.4, docs/PAXOS.md C1).

import type { NodeId } from 'moirae-core';

export type Value = string; // opaque to Paxos, as commands are to Raft

// Display-only summary of what the node is doing, for the studio's SPEC §9
// lane-colour convention (PAXOS.md C9). Not state from the paper; nothing in
// the protocol reads it.
export type PaxosRole = 'idle' | 'proposing' | 'learned';

// The proposer's progress through §2.2's two phases for its current attempt.
// 'accept' also means "done": once phase 2 has started for a number, that
// number is bound to its value forever (PAXOS.md #5).
export type Phase = 'idle' | 'prepare' | 'accept';

// One ballot's tally of Accepted messages, as the learner sees it (§2.3).
// An array, not a keyed record: push order is message-arrival order, which
// the engine makes deterministic.
export interface BallotTally {
  readonly n: number;
  readonly v: Value;
  by: NodeId[]; // acceptors seen; one entry per acceptor (PAXOS.md #8)
}

// A type alias, not an interface, so it satisfies the engine's
// Record<string, unknown> bound (as RaftState does).
export type PaxosState = {
  // Acceptor state (§2.2–§2.3) — persistent, see Paxos.persistent.
  promised: number; // highest prepare answered; 0 = none. Raised on accept (C4).
  acceptedN: number; // highest-numbered proposal accepted; 0 = none
  acceptedV: Value | null;

  // Proposer state — volatile (C8). attemptN is 0 when no attempt is live.
  round: number; // attemptN = round * cluster + me (C2)
  attemptN: number;
  phase: Phase;
  wanted: Value | null; // the value this node was asked to propose
  promisesFrom: NodeId[]; // acceptors promised for attemptN; counts once each (#4)
  highestAccepted: { n: number; v: Value } | null; // highest reported by promises (#3)

  // Learner state — volatile (C8).
  accepts: BallotTally[];
  learned: Value | null;

  // Every value this node ever proposed, for the validity invariant.
  proposals: Value[];

  // Display only (SPEC §9 conventions; C9). role colours the studio lane;
  // term carries the current attempt's ballot number and labels it.
  role: PaxosRole;
  term: number;
};

// C5 — randomized retry breaks proposer duels the way Raft's randomized
// election timeouts break split votes. §2.4: without a distinguished
// proposer, progress is probable, not guaranteed.
export const RETRY_TIMEOUT_MIN = 150;
export const RETRY_TIMEOUT_MAX = 300;

export const RETRY_TIMER = 'retry';

// The state every node starts from — also what a restarted node returns to
// before the persisted acceptor fields are overlaid (SPEC §3).
export function initialState(): PaxosState {
  return {
    promised: 0,
    acceptedN: 0,
    acceptedV: null,
    round: 0,
    attemptN: 0,
    phase: 'idle',
    wanted: null,
    promisesFrom: [],
    highestAccepted: null,
    accepts: [],
    learned: null,
    proposals: [],
    role: 'idle',
    term: 0,
  };
}

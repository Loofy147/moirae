// Raft server state, transcribed from Ongaro & Ousterhout, "In Search of an
// Understandable Consensus Algorithm" (USENIX ATC 2014), Figure 2.
// Section references throughout packages/protocols/src/raft are to that paper.

import type { NodeId } from '@moirae/core';

export type Command = string; // opaque to Raft; the state machine here is the applied sequence

export interface LogEntry {
  readonly term: number; // term when the entry was received by the leader (Figure 2)
  readonly command: Command;
}

export type Role = 'follower' | 'candidate' | 'leader';

// A type alias, not an interface, so it satisfies the engine's
// Record<string, unknown> bound. Log indices are 1-based (Figure 2):
// entry i lives at log[i - 1].
export type RaftState = {
  // Persistent state on all servers (Figure 2) — see Raft.persistent.
  currentTerm: number; // latest term the server has seen; initialised to 0
  votedFor: NodeId | null; // candidate that received our vote in currentTerm
  log: LogEntry[];

  // Volatile state on all servers (Figure 2).
  commitIndex: number; // highest log index known to be committed
  lastApplied: number; // highest log index applied to the state machine
  applied: Command[]; // the state machine: commands applied, in index order

  // Volatile state on leaders (Figure 2), reinitialised after election.
  nextIndex: Record<string, number>; // per follower: next log index to send
  matchIndex: Record<string, number>; // per follower: highest index known replicated

  // Our own bookkeeping.
  role: Role;
  leaderId: NodeId | null; // the current term's leader, once heard from
  votesGranted: NodeId[]; // candidate: who voted for us this term
};

// §5.2 / §9.3: election timeouts are randomised over a range comfortably
// above the broadcast time; heartbeats are sent well within the timeout.
export const ELECTION_TIMEOUT_MIN = 150;
export const ELECTION_TIMEOUT_MAX = 300;
export const HEARTBEAT_INTERVAL = 50;

export const ELECTION_TIMER = 'election';
export const HEARTBEAT_TIMER = 'heartbeat';

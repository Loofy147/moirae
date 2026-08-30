// Raft RPCs as messages, transcribed from Figure 2. Every message carries the
// sender's term first: the term comparison rule (§5.1) runs before anything
// else, on requests and on responses alike.

import type { Message, NodeId } from '@moirae/core';
import type { LogEntry } from './state';

export interface RequestVote extends Message {
  readonly type: 'RequestVote';
  readonly term: number; // candidate's term
  readonly candidateId: NodeId;
  readonly lastLogIndex: number; // index of candidate's last log entry (§5.4)
  readonly lastLogTerm: number; // term of candidate's last log entry (§5.4)
}

export interface RequestVoteResponse extends Message {
  readonly type: 'RequestVoteResponse';
  readonly term: number; // currentTerm, for the candidate to update itself
  readonly voteGranted: boolean;
}

export interface AppendEntries extends Message {
  readonly type: 'AppendEntries';
  readonly term: number; // leader's term
  readonly leaderId: NodeId;
  readonly prevLogIndex: number; // index of the entry immediately preceding the new ones
  readonly prevLogTerm: number;
  readonly entries: readonly LogEntry[]; // empty for heartbeat
  readonly leaderCommit: number; // leader's commitIndex
}

export interface AppendEntriesResponse extends Message {
  readonly type: 'AppendEntriesResponse';
  readonly term: number; // currentTerm, for the leader to update itself
  readonly success: boolean; // follower held the entry matching prevLogIndex/prevLogTerm
  // Deviation D1 from Figure 2 (see docs/RAFT.md): the follower echoes the
  // index of the last entry the answered request covered, so the leader sets
  // matchIndex from the request actually answered rather than from its own
  // current log length. 0 when success is false.
  readonly matchIndex: number;
}

export type RaftMessage = RequestVote | RequestVoteResponse | AppendEntries | AppendEntriesResponse;

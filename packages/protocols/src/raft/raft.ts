// Raft, transcribed from Ongaro & Ousterhout (USENIX ATC 2014). Read Figure 2
// before touching any handler. Every rule cites its section; every deliberate
// deviation from the paper is named in docs/RAFT.md.
//
// Persistence discipline: currentTerm, votedFor and log are updated before any
// ctx.send in every handler (Figure 2: "updated on stable storage before
// responding to RPCs"). SPEC §3 records that the engine cannot observe this
// ordering in v0; the discipline is enforced by review, not by a test.

import type { Ctx, Process } from '@moira/core';
import {
  ELECTION_TIMEOUT_MAX,
  ELECTION_TIMEOUT_MIN,
  ELECTION_TIMER,
  type RaftState,
} from './state';

export class Raft implements Process<RaftState> {
  // Figure 2, "Persistent state on all servers".
  readonly persistent = ['currentTerm', 'votedFor', 'log'] as const;

  init(ctx: Ctx<RaftState>): RaftState {
    // §5.2 — "When servers start up, they begin as followers."
    const state: RaftState = {
      currentTerm: 0,
      votedFor: null,
      log: [],
      commitIndex: 0,
      lastApplied: 0,
      applied: [],
      nextIndex: {},
      matchIndex: {},
      role: 'follower',
      leaderId: null,
      votesGranted: [],
    };
    this.resetElectionTimer(ctx);
    return state;
  }

  onMessage(): void {
    // Handlers arrive rule by rule; see the commit history.
  }

  onTimer(): void {
    // Handlers arrive rule by rule; see the commit history.
  }

  // §5.2 — election timeouts are chosen randomly from a fixed interval, per
  // server and per election, so that split votes are rare and resolve quickly.
  // Replacing the timer of the same name is the engine's setTimer contract.
  private resetElectionTimer(ctx: Ctx<RaftState>): void {
    const range = ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN + 1;
    ctx.setTimer(ELECTION_TIMER, ELECTION_TIMEOUT_MIN + Math.floor(ctx.random() * range));
  }
}

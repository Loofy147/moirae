// Raft, transcribed from Ongaro & Ousterhout (USENIX ATC 2014). Read Figure 2
// before touching any handler. Every rule cites its section; every deliberate
// deviation from the paper is named in docs/RAFT.md.
//
// Persistence discipline: currentTerm, votedFor and log are updated before any
// ctx.send in every handler (Figure 2: "updated on stable storage before
// responding to RPCs"). SPEC §3 records that the engine cannot observe this
// ordering in v0; the discipline is enforced by review, not by a test.

import type { Ctx, Message, NodeId, Process } from '@moira/core';
import type { RaftMessage, RequestVote } from './messages';
import {
  ELECTION_TIMEOUT_MAX,
  ELECTION_TIMEOUT_MIN,
  ELECTION_TIMER,
  HEARTBEAT_TIMER,
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

  onMessage(ctx: Ctx<RaftState>, from: NodeId, msg: Message): void {
    const m = msg as RaftMessage;
    const s = ctx.state;
    // §5.1 / Figure 2 "All Servers" — "If RPC request or response contains
    // term T > currentTerm: set currentTerm = T, convert to follower." This
    // runs before the handler's own logic, on requests and on responses.
    if (m.term > s.currentTerm) {
      s.currentTerm = m.term; // persisted before any response below
      s.votedFor = null;
      this.becomeFollower(ctx);
    }
    // Figure 2 — RequestVote and AppendEntries both "reply false if
    // term < currentTerm"; a response from an older term is stale (§5.1) and
    // ignored. Neither is processed further, and neither touches a timer.
    if (m.term < s.currentTerm) {
      if (m.type === 'RequestVote') {
        ctx.send(from, { type: 'RequestVoteResponse', term: s.currentTerm, voteGranted: false });
      } else if (m.type === 'AppendEntries') {
        ctx.send(from, {
          type: 'AppendEntriesResponse',
          term: s.currentTerm,
          success: false,
          matchIndex: 0,
        });
      }
      return;
    }
    switch (m.type) {
      case 'RequestVote':
        this.onRequestVote(ctx, from, m);
        break;
      // Remaining handlers arrive rule by rule; see the commit history.
    }
  }

  onTimer(): void {
    // Handlers arrive rule by rule; see the commit history.
  }

  private onRequestVote(ctx: Ctx<RaftState>, from: NodeId, m: RequestVote): void {
    const s = ctx.state;
    // §5.4.1 — election restriction. "If the logs have last entries with
    // different terms, then the log with the later term is more up-to-date.
    // If the logs end with the same term, then whichever log is longer is
    // more up-to-date." The voter denies if its own log is more up-to-date.
    const lastIndex = s.log.length;
    const lastTerm = lastIndex > 0 ? (s.log[lastIndex - 1] as { term: number }).term : 0;
    const candidateUpToDate =
      m.lastLogTerm > lastTerm || (m.lastLogTerm === lastTerm && m.lastLogIndex >= lastIndex);
    // Figure 2, RequestVote RPC receiver: "If votedFor is null or candidateId,
    // and candidate's log is at least as up-to-date as receiver's log, grant."
    const grant = (s.votedFor === null || s.votedFor === m.candidateId) && candidateUpToDate;
    if (grant) {
      s.votedFor = m.candidateId; // persisted before responding
      // §5.2 — a server that grants a vote resets its election timer
      // (RAFT.md #5); declining does not.
      this.resetElectionTimer(ctx);
    }
    ctx.send(from, { type: 'RequestVoteResponse', term: s.currentTerm, voteGranted: grant });
  }

  // §5.1 / Figure 2 "Rules for Servers": on discovering a higher term a server
  // reverts to follower. A leader had no election timer running (it sends
  // heartbeats instead), so it must arm one now (§5.2); a candidate or
  // follower keeps the timer it already has — stepping down is not one of the
  // timer-reset events (RAFT.md #5).
  private becomeFollower(ctx: Ctx<RaftState>): void {
    const s = ctx.state;
    const wasLeader = s.role === 'leader';
    s.role = 'follower';
    s.leaderId = null;
    s.votesGranted = [];
    s.nextIndex = {};
    s.matchIndex = {};
    if (wasLeader) {
      ctx.cancelTimer(HEARTBEAT_TIMER);
      this.resetElectionTimer(ctx);
    }
  }

  // §5.2 — election timeouts are chosen randomly from a fixed interval, per
  // server and per election, so that split votes are rare and resolve quickly.
  // Replacing the timer of the same name is the engine's setTimer contract.
  private resetElectionTimer(ctx: Ctx<RaftState>): void {
    const range = ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN + 1;
    ctx.setTimer(ELECTION_TIMER, ELECTION_TIMEOUT_MIN + Math.floor(ctx.random() * range));
  }
}

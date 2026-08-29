import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, HEARTBEAT_TIMER, Raft } from '../src/index';
import type { AppendEntries, AppendEntriesResponse, RequestVote } from '../src/index';
import { Harness } from './harness';

// RAFT.md #1 / §5.1, Figure 2 "Rules for Servers — All Servers": any RPC or
// response with a term greater than ours makes us adopt it, become a follower
// and clear our vote — before the handler's own logic. Any request with a term
// below ours is rejected with our term and not processed; a stale response is
// ignored. Naive form shown failing: dispatch straight to the handler with no
// term comparison.

const ae = (term: number): AppendEntries => ({
  type: 'AppendEntries',
  term,
  leaderId: 2,
  prevLogIndex: 0,
  prevLogTerm: 0,
  entries: [],
  leaderCommit: 0,
});

describe('#1 term comparison happens before anything else', () => {
  it('a higher-term AppendEntries makes a follower adopt the term and clear its vote', () => {
    const h = new Harness(3, Raft);
    const s = h.state(1);
    s.currentTerm = 2;
    s.votedFor = 3;
    h.proc(1).onMessage(h.ctx(1), 2, ae(5));
    expect(s.currentTerm).toBe(5);
    expect(s.votedFor).toBeNull();
    expect(s.role).toBe('follower');
  });

  it('a higher-term RequestVote makes a leader step down', () => {
    const h = new Harness(3, Raft);
    const s = h.state(1);
    s.currentTerm = 2;
    s.role = 'leader';
    s.leaderId = 1;
    const rv: RequestVote = { type: 'RequestVote', term: 6, candidateId: 3, lastLogIndex: 0, lastLogTerm: 0 };
    h.proc(1).onMessage(h.ctx(1), 3, rv);
    expect(s.currentTerm).toBe(6);
    expect(s.role).toBe('follower');
    expect(s.leaderId).toBeNull();
  });

  it('a higher-term response makes a leader step down, cancel heartbeats and arm an election timer', () => {
    const h = new Harness(3, Raft);
    const s = h.state(1);
    s.currentTerm = 3;
    s.role = 'leader';
    s.votedFor = 1;
    h.timerCalls.length = 0;
    const resp: AppendEntriesResponse = { type: 'AppendEntriesResponse', term: 7, success: false, matchIndex: 0 };
    h.proc(1).onMessage(h.ctx(1), 2, resp);
    expect(s.currentTerm).toBe(7);
    expect(s.role).toBe('follower');
    expect(s.votedFor).toBeNull();
    expect(h.timersOf(1)).toEqual([
      { node: 1, op: 'cancel', name: HEARTBEAT_TIMER },
      { node: 1, op: 'set', name: ELECTION_TIMER, delay: expect.any(Number) as number },
    ]);
  });

  it('a lower-term request is rejected with our term, unprocessed, and resets no timer', () => {
    const h = new Harness(3, Raft);
    const s = h.state(1);
    s.currentTerm = 3;
    s.votedFor = 2;
    h.timerCalls.length = 0;
    h.proc(1).onMessage(h.ctx(1), 3, { type: 'RequestVote', term: 1, candidateId: 3, lastLogIndex: 0, lastLogTerm: 0 } satisfies RequestVote);
    h.proc(1).onMessage(h.ctx(1), 2, ae(1));
    expect(h.outbox).toEqual([
      { from: 1, to: 3, msg: { type: 'RequestVoteResponse', term: 3, voteGranted: false } },
      { from: 1, to: 2, msg: { type: 'AppendEntriesResponse', term: 3, success: false, matchIndex: 0 } },
    ]);
    expect(s.currentTerm).toBe(3);
    expect(s.votedFor).toBe(2); // the stale RequestVote did not touch our vote
    expect(h.timersOf(1)).toEqual([]);
  });

  it('a lower-term response is ignored silently', () => {
    const h = new Harness(3, Raft);
    const s = h.state(1);
    s.currentTerm = 4;
    s.role = 'leader';
    h.timerCalls.length = 0;
    h.proc(1).onMessage(h.ctx(1), 2, { type: 'AppendEntriesResponse', term: 2, success: true, matchIndex: 9 } satisfies AppendEntriesResponse);
    expect(s.role).toBe('leader');
    expect(s.matchIndex).toEqual({});
    expect(h.outbox).toEqual([]);
    expect(h.timersOf(1)).toEqual([]);
  });
});

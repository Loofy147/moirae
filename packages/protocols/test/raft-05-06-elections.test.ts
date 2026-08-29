import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, HEARTBEAT_INTERVAL, HEARTBEAT_TIMER, Raft } from '../src/index';
import type { RaftState } from '../src/index';
import { Harness } from './harness';

// §5.2 elections. RAFT.md #5: starting an election resets the election timer.
// RAFT.md #6: a vote response only counts if we are still a candidate in the
// term it answers — by the time it arrives we may have won, lost, or moved on.
// Naive form shown failing: count every granted response, duplicates included,
// regardless of role.

function electionOf(h: Harness<RaftState>, node: number): void {
  h.fire(node, ELECTION_TIMER);
}

describe('elections (§5.2)', () => {
  it('#5 starting an election: term+1, vote for self, timer reset, RequestVote to every peer', () => {
    const h = new Harness(5, Raft);
    h.state(1).log = [{ term: 1, command: 'a' }];
    h.state(1).currentTerm = 1;
    h.timerCalls.length = 0;
    electionOf(h, 1);
    const s = h.state(1);
    expect(s.currentTerm).toBe(2);
    expect(s.votedFor).toBe(1);
    expect(s.role).toBe('candidate');
    expect(s.votesGranted).toEqual([1]);
    expect(h.timersOf(1)).toEqual([
      { node: 1, op: 'set', name: ELECTION_TIMER, delay: expect.any(Number) as number },
    ]);
    expect(h.outbox.map((m) => m.to)).toEqual([2, 3, 4, 5]);
    expect(h.outbox[0]?.msg).toEqual({
      type: 'RequestVote',
      term: 2,
      candidateId: 1,
      lastLogIndex: 1,
      lastLogTerm: 1,
    });
  });

  it('a majority of granted votes makes the candidate leader, which asserts authority at once', () => {
    const h = new Harness(5, Raft);
    electionOf(h, 1);
    h.deliverOnly((m) => m.to === 2 || m.to === 3); // votes from 2 and 3 only
    h.timerCalls.length = 0;
    h.deliverOnly((m) => m.to === 1); // their responses reach 1; the new heartbeats stay pending
    const s = h.state(1);
    expect(s.role).toBe('leader');
    expect(s.leaderId).toBe(1);
    expect(s.nextIndex).toEqual({ '2': 1, '3': 1, '4': 1, '5': 1 });
    expect(s.matchIndex).toEqual({ '2': 0, '3': 0, '4': 0, '5': 0 });
    expect(h.timersOf(1)).toEqual([
      { node: 1, op: 'cancel', name: ELECTION_TIMER },
      { node: 1, op: 'set', name: HEARTBEAT_TIMER, delay: HEARTBEAT_INTERVAL },
    ]);
    // Heartbeats to every peer, empty, with the consistency-check fields.
    expect(h.outbox.map((m) => [m.to, m.msg['type'], (m.msg['entries'] as unknown[]).length])).toEqual([
      [2, 'AppendEntries', 0],
      [3, 'AppendEntries', 0],
      [4, 'AppendEntries', 0],
      [5, 'AppendEntries', 0],
    ]);
  });

  it('#6 duplicate grants from one voter count once', () => {
    const h = new Harness(5, Raft);
    electionOf(h, 1);
    h.deliverOnly((m) => m.to === 2);
    h.duplicate(0); // node 2's response, delivered twice
    h.deliver(0);
    expect(h.state(1).votesGranted).toEqual([1, 2]);
    expect(h.state(1).role).toBe('candidate');
  });

  it('#6 votes arriving after the candidate stepped down in the same term are ignored', () => {
    const h = new Harness(5, Raft);
    electionOf(h, 1);
    h.deliverOnly((m) => m.to === 2 || m.to === 3 || m.to === 4); // three grants pending
    // Meanwhile the real leader's AppendEntries turned node 1 into a follower.
    h.state(1).role = 'follower';
    h.state(1).votesGranted = [];
    h.deliverAll();
    expect(h.state(1).role).toBe('follower');
    expect(h.state(1).votesGranted).toEqual([]);
  });

  it('#6 a vote from a previous election is ignored (via the term rule)', () => {
    const h = new Harness(3, Raft);
    electionOf(h, 1); // term 1
    h.deliverOnly((m) => m.to === 2); // one grant pending, term 1
    electionOf(h, 1); // timeout: term 2, new election
    h.deliverOnly((m) => m.to === 1); // the old term-1 grant arrives now
    expect(h.state(1).currentTerm).toBe(2);
    expect(h.state(1).votesGranted).toEqual([1]);
    expect(h.state(1).role).toBe('candidate');
  });

  it('a single-server cluster elects itself immediately', () => {
    const h = new Harness(1, Raft);
    electionOf(h, 1);
    expect(h.state(1).role).toBe('leader');
  });

  it('a leader re-sends heartbeats on the heartbeat timer and re-arms it', () => {
    const h = new Harness(3, Raft);
    electionOf(h, 1);
    h.deliverAll(); // votes and grants
    expect(h.state(1).role).toBe('leader');
    h.outbox.length = 0;
    h.timerCalls.length = 0;
    h.fire(1, HEARTBEAT_TIMER);
    expect(h.outbox.map((m) => m.to)).toEqual([2, 3]);
    expect(h.timersOf(1)).toEqual([{ node: 1, op: 'set', name: HEARTBEAT_TIMER, delay: HEARTBEAT_INTERVAL }]);
  });
});

import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, Raft } from '../src/index';
import type { RequestVote } from '../src/index';
import { Harness } from './harness';

// RAFT.md #4 / §5.4.1: a server refuses its vote if the candidate's log is
// less up to date than its own. "More up to date" compares the last entry's
// term first; only when the terms are equal does the longer log win.
// Naive forms shown failing: no log comparison at all; and comparing indices
// first.

function askVote(
  h: Harness<ReturnType<Raft['init']>>,
  voter: number,
  lastLogIndex: number,
  lastLogTerm: number,
): boolean {
  h.outbox.length = 0;
  const rv: RequestVote = { type: 'RequestVote', term: h.state(voter).currentTerm, candidateId: 2, lastLogIndex, lastLogTerm };
  h.proc(voter).onMessage(h.ctx(voter), 2, rv);
  const reply = h.outbox[0]?.msg as unknown as { voteGranted: boolean };
  return reply.voteGranted;
}

function withLog(terms: number[]): Harness<ReturnType<Raft['init']>> {
  const h = new Harness(3, Raft);
  const s = h.state(1);
  s.currentTerm = 3;
  s.log = terms.map((term, i) => ({ term, command: `c${i + 1}` }));
  return h;
}

describe('#4 the election restriction (§5.4.1)', () => {
  it('a shorter log with a later last term is more up to date: grant', () => {
    const h = withLog([1, 1, 1]);
    expect(askVote(h, 1, 1, 2)).toBe(true);
  });

  it('a longer log with an older last term is less up to date: deny', () => {
    const h = withLog([2]);
    expect(askVote(h, 1, 5, 1)).toBe(false);
  });

  it('with equal last terms the longer log wins; equal length is enough', () => {
    expect(askVote(withLog([2, 2, 2]), 1, 2, 2)).toBe(false);
    expect(askVote(withLog([2, 2, 2]), 1, 3, 2)).toBe(true);
    expect(askVote(withLog([2, 2, 2]), 1, 4, 2)).toBe(true);
  });

  it('an empty log grants to anyone', () => {
    expect(askVote(withLog([]), 1, 0, 0)).toBe(true);
  });

  it('votedFor is honoured: another candidate is denied, the same one re-granted', () => {
    const h = withLog([]);
    h.state(1).votedFor = 3;
    expect(askVote(h, 1, 0, 0)).toBe(false);
    h.state(1).votedFor = 2;
    expect(askVote(h, 1, 0, 0)).toBe(true);
  });

  it('(#5) granting resets the election timer; declining does not', () => {
    const granting = withLog([]);
    granting.timerCalls.length = 0;
    expect(askVote(granting, 1, 0, 0)).toBe(true);
    expect(granting.timersOf(1)).toEqual([
      { node: 1, op: 'set', name: ELECTION_TIMER, delay: expect.any(Number) as number },
    ]);

    const declining = withLog([2]);
    declining.timerCalls.length = 0;
    expect(askVote(declining, 1, 5, 1)).toBe(false);
    expect(declining.timersOf(1)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { Paxos } from '../src/index';
import { RETRY_TIMER, deliverWhere, harness, isAccept, isPrepare, isPromise, seedAccepted } from './helpers';

// PAXOS.md #4 and #5: which promises are allowed to count. A promise counts
// only for the attempt it answers, one acceptor counts once, and once
// phase 2 has started for a number the number's value is frozen. Naive forms
// shown failing: counting any promise that arrives; counting duplicates;
// re-deriving the value when a late promise reports something higher.

describe('#4/#5 attempt hygiene (§2.2)', () => {
  it('#4: a promise for an abandoned attempt does not count toward the new one', () => {
    const h = harness(5);
    (h.proc(1) as Paxos).propose(h.ctx(1), 'mine'); // attempt n=6
    deliverWhere(h, (s) => isPrepare(s) && s.to === 2);
    deliverWhere(h, isPromise); // counted: self + 2
    deliverWhere(h, (s) => isPrepare(s) && s.to === 3); // its promise stays queued
    h.fire(1, RETRY_TIMER); // retry: attempt n=11, counts reset
    expect(h.state(1).attemptN).toBe(11);
    expect(h.state(1).promisesFrom).toEqual([1]);

    deliverWhere(h, isPromise); // the stale n=6 promise from node 3 lands now
    expect(h.state(1).promisesFrom).toEqual([1]); // not counted
    expect(h.outbox.filter(isAccept)).toEqual([]);

    // The opportunity: fresh promises for n=11 do count and reach phase 2.
    deliverWhere(h, (s) => isPrepare(s) && (s.msg as unknown as { n: number }).n === 11 && s.to === 2);
    deliverWhere(h, isPromise);
    deliverWhere(h, (s) => isPrepare(s) && (s.msg as unknown as { n: number }).n === 11 && s.to === 3);
    deliverWhere(h, isPromise);
    const accepts = h.outbox.filter(isAccept);
    expect(accepts.length).toBeGreaterThan(0);
    for (const a of accepts) expect((a.msg as unknown as { n: number }).n).toBe(11);
  });

  it('#4: a duplicated promise counts once', () => {
    const h = harness(5);
    (h.proc(1) as Paxos).propose(h.ctx(1), 'mine');
    deliverWhere(h, (s) => isPrepare(s) && s.to === 2);
    const i = h.outbox.findIndex(isPromise);
    h.duplicate(i); // the copy arrives first
    h.deliver(i); // then the original
    expect(h.state(1).promisesFrom).toEqual([1, 2]); // node 2 once, not twice
    expect(h.outbox.filter(isAccept)).toEqual([]); // and no premature phase 2

    deliverWhere(h, (s) => isPrepare(s) && s.to === 3);
    deliverWhere(h, isPromise); // a real third acceptor is what reaches majority
    expect(h.outbox.filter(isAccept).length).toBeGreaterThan(0);
  });

  it('#5: once phase 2 has started, a late promise reporting a higher value changes nothing', () => {
    const h = harness(5);
    seedAccepted(h.state(2), 2, 'w2');
    seedAccepted(h.state(4), 4, 'w4');
    (h.proc(1) as Paxos).propose(h.ctx(1), 'mine');
    deliverWhere(h, (s) => isPrepare(s) && s.to === 2);
    deliverWhere(h, isPromise);
    deliverWhere(h, (s) => isPrepare(s) && s.to === 3);
    deliverWhere(h, isPromise); // majority {1,2,3}: highest reported is (2, w2)
    const before = h.outbox.filter(isAccept);
    expect(before.length).toBeGreaterThan(0);
    for (const a of before) expect((a.msg as unknown as { v: string }).v).toBe('w2');

    deliverWhere(h, (s) => isPrepare(s) && s.to === 4);
    deliverWhere(h, isPromise); // reports (4, w4) — too late, the number is bound
    expect(h.outbox.filter(isAccept)).toHaveLength(before.length); // no re-send
    expect(h.state(1).highestAccepted).toEqual({ n: 2, v: 'w2' });
  });
});

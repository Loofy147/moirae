import { describe, expect, it } from 'vitest';
import { Paxos } from '../src/index';
import type { Sent } from './helpers';
import { deliverWhere, harness, isAccept, isPrepare, isPromise, seedAccepted } from './helpers';

// PAXOS.md #3 (§2.2, P2c): phase 2 must propose the value of the
// highest-numbered accepted proposal among the promises actually counted —
// not the first to arrive, not the proposer's own. Naive forms shown
// failing: taking the proposer's own value; taking the first reported one.

function accepts(h: { outbox: Sent[] }): string[] {
  return h.outbox.filter(isAccept).map((s) => (s.msg as unknown as { v: string }).v);
}

describe('#3 phase 2 chooses the highest reported value (§2.2)', () => {
  it('with no accepted proposals reported, the proposer uses its own value', () => {
    const h = harness(5);
    (h.proc(1) as Paxos).propose(h.ctx(1), 'mine');
    deliverWhere(h, (s) => isPrepare(s) && s.to === 2);
    deliverWhere(h, isPromise);
    deliverWhere(h, (s) => isPrepare(s) && s.to === 3);
    deliverWhere(h, isPromise); // majority: self + 2 + 3
    expect(accepts(h).length).toBeGreaterThan(0); // phase 2 really started
    expect(accepts(h)).toEqual(['mine', 'mine', 'mine', 'mine']);
  });

  const orders: [string, number[]][] = [
    ['lower value first', [2, 3]],
    ['higher value first', [3, 2]],
  ];

  it.each(orders)('the highest-numbered value wins, %s', (_name, order) => {
    const h = harness(5);
    seedAccepted(h.state(2), 2, 'w2');
    seedAccepted(h.state(3), 4, 'w4');
    (h.proc(1) as Paxos).propose(h.ctx(1), 'mine');
    for (const to of order) {
      deliverWhere(h, (s) => isPrepare(s) && s.to === to);
      deliverWhere(h, isPromise);
    }
    const sent = accepts(h);
    expect(sent.length).toBeGreaterThan(0);
    for (const v of sent) expect(v).toBe('w4'); // not 'mine', not 'w2'
    expect(h.state(1).highestAccepted).toEqual({ n: 4, v: 'w4' });
  });
});

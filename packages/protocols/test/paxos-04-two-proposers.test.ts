import { describe, expect, it } from 'vitest';
import { Paxos } from '../src/index';
import type { PaxosState } from './helpers';
import { deliverWhere, harness, isAccept, isPrepare, isPromise } from './helpers';
import type { Harness } from './harness';

// The dueling-proposers story — Paxos's Figure 8. Proposer A reaches
// phase 2 and its accepts are delayed in flight; proposer B runs a full
// round with a higher number meanwhile. Whether B is forced onto A's value
// depends only on whether B's promise majority saw an acceptor that had
// accepted it (§2.2, P2c). Both outcomes are exercised; in neither may two
// values end up chosen.

// A = node 1 proposes 'a' (n=4), reaches phase 2 through node 2's promise,
// and its Accept messages stay undelivered. B = node 3 proposes 'b' (n=6).
function duel(): Harness<PaxosState> {
  const h = harness(3);
  (h.proc(1) as Paxos).propose(h.ctx(1), 'a');
  deliverWhere(h, (s) => isPrepare(s) && s.to === 2);
  deliverWhere(h, isPromise); // majority {1,2} -> phase 2; accepts now pending
  expect(h.state(1).acceptedV).toBe('a'); // A accepted its own proposal
  (h.proc(3) as Paxos).propose(h.ctx(3), 'b');
  return h;
}

const n = (s: { msg: unknown }): number => (s.msg as unknown as { n: number }).n;
const v = (s: { msg: unknown }): string => (s.msg as unknown as { v: string }).v;

describe('two proposers (§2.2 P2c under adversity)', () => {
  it("B's majority missed A's acceptor: 'b' wins and A's delayed accepts land nowhere", () => {
    const h = duel();
    // B's round goes through nodes 2 and 3 — node 1, the only acceptor of
    // (4, 'a'), is not consulted.
    deliverWhere(h, (s) => isPrepare(s) && n(s) === 6 && s.to === 2);
    deliverWhere(h, (s) => isPromise(s) && s.to === 3);
    const bAccepts = h.outbox.filter((s) => isAccept(s) && n(s) === 6);
    expect(bAccepts.map(v)).toEqual(['b', 'b']); // nobody reported 'a'
    deliverWhere(h, (s) => isAccept(s) && n(s) === 6 && s.to === 2);
    deliverWhere(h, (s) => isAccept(s) && n(s) === 6 && s.to === 1);

    // A's delayed Accept(4, 'a') arrives after everyone promised 6.
    deliverWhere(h, (s) => isAccept(s) && n(s) === 4 && s.to === 2);
    deliverWhere(h, (s) => isAccept(s) && n(s) === 4 && s.to === 3);
    for (const node of [1, 2, 3]) {
      expect(h.state(node).acceptedN).toBe(6);
      expect(h.state(node).acceptedV).toBe('b');
    }

    h.deliverAll();
    for (const node of [1, 2, 3]) expect(h.state(node).learned).toBe('b');
    // (4, 'a') was accepted by node 1 alone — visibly short of a majority.
    const tally = h.state(2).accepts.find((t) => t.n === 4);
    expect(tally?.by).toEqual([1]);
  });

  it("B's majority includes A's acceptor: B is forced to propose 'a'", () => {
    const h = duel();
    // B's round goes through nodes 1 and 3 — node 1 reports accepted (4, 'a').
    deliverWhere(h, (s) => isPrepare(s) && n(s) === 6 && s.to === 1);
    deliverWhere(h, (s) => isPromise(s) && s.to === 3);
    const bAccepts = h.outbox.filter((s) => isAccept(s) && n(s) === 6);
    expect(bAccepts.length).toBeGreaterThan(0);
    expect(bAccepts.map(v)).toEqual(['a', 'a']); // #3: not 'b'
    expect(h.state(3).wanted).toBe('b'); // it wanted its own — and yielded

    h.deliverAll();
    for (const node of [1, 2, 3]) expect(h.state(node).learned).toBe('a');
  });
});

import { describe, expect, it } from 'vitest';
import { Paxos } from '../src/index';
import type { PaxosState } from '../src/index';
import { Harness } from './harness';

// PAXOS.md #1, #2, #9 and C4: the acceptor's two rules and their exact
// boundaries. Prepare earns a promise only for a strictly greater number;
// Accept lands for greater OR EQUAL — the `>` form fails the equal case,
// which is every proposal's own accept. Refusal is silence, both ways.

function acceptor(): Harness<PaxosState> {
  return new Harness<PaxosState>(3, Paxos);
}

function prepare(h: Harness<PaxosState>, n: number): void {
  h.proc(1).onMessage(h.ctx(1), 2, { type: 'Prepare', n });
}

function accept(h: Harness<PaxosState>, n: number, v: string): void {
  h.proc(1).onMessage(h.ctx(1), 2, { type: 'Accept', n, v });
}

describe('#1/#2 the acceptor rules (§2.2)', () => {
  it('#1: prepare earns a promise iff n is strictly greater; equal and lower are silence', () => {
    const h = acceptor();
    prepare(h, 5);
    expect(h.outbox).toHaveLength(1); // the opportunity: a greater n does reply
    expect(h.outbox[0]?.msg).toEqual({ type: 'Promised', n: 5, acceptedN: 0, acceptedV: null });
    expect(h.state(1).promised).toBe(5);

    h.outbox.length = 0;
    prepare(h, 5); // equal: already answered this number
    prepare(h, 4); // lower
    expect(h.outbox).toEqual([]);
    expect(h.state(1).promised).toBe(5);

    prepare(h, 6); // and greater still replies — silence above was the rule, not deafness
    expect(h.outbox).toHaveLength(1);
    expect(h.state(1).promised).toBe(6);
  });

  it('#1: the promise carries the highest-numbered accepted proposal', () => {
    const h = acceptor();
    h.state(1).promised = 7;
    h.state(1).acceptedN = 7;
    h.state(1).acceptedV = 'x';
    prepare(h, 9);
    expect(h.outbox[0]?.msg).toEqual({ type: 'Promised', n: 9, acceptedN: 7, acceptedV: 'x' });
  });

  it('#2: accept lands for n equal to the promise — the off-by-one the paper wording invites', () => {
    const h = acceptor();
    h.state(1).promised = 5;
    accept(h, 5, 'v5'); // n >= promised: this is the proposer whose prepare we answered
    expect(h.state(1).acceptedN).toBe(5);
    expect(h.state(1).acceptedV).toBe('v5');
    // §2.3/C6 — accepting announces to every other node.
    expect(h.outbox.map((s) => s.msg)).toEqual([
      { type: 'Accepted', n: 5, v: 'v5' },
      { type: 'Accepted', n: 5, v: 'v5' },
    ]);

    h.outbox.length = 0;
    accept(h, 4, 'v4'); // below the promise: silence, nothing recorded
    expect(h.outbox).toEqual([]);
    expect(h.state(1).acceptedN).toBe(5);
    expect(h.state(1).acceptedV).toBe('v5');
  });

  it('C4: accepting raises the promise, so a lower-numbered accept can never land afterwards', () => {
    const h = acceptor();
    h.state(1).promised = 3;
    accept(h, 5, 'a'); // permitted: 5 >= 3, and it raises promised to 5
    expect(h.state(1).promised).toBe(5);
    h.outbox.length = 0;
    accept(h, 4, 'b'); // without C4 this would land (4 >= 3) and overwrite
    expect(h.outbox).toEqual([]);
    expect(h.state(1).acceptedN).toBe(5);
    expect(h.state(1).acceptedV).toBe('a');
  });
});

import { describe, expect, it } from 'vitest';
import { RETRY_TIMER, harness } from './helpers';

// PAXOS.md #8 (§2.3): a value is learned only from a majority of Accepted
// messages carrying the same proposal number — different numbers never
// combine, and one acceptor counts once however often its message arrives.

function accepted(h: ReturnType<typeof harness>, from: number, n: number, v: string): void {
  h.proc(1).onMessage(h.ctx(1), from, { type: 'Accepted', n, v });
}

describe('#8 the learner (§2.3)', () => {
  it('majority of the same ballot learns; duplicates and other ballots do not count', () => {
    const h = harness(5); // majority is 3
    accepted(h, 2, 7, 'x');
    accepted(h, 3, 7, 'x');
    accepted(h, 3, 7, 'x'); // duplicate: still two acceptors
    expect(h.state(1).accepts.find((t) => t.n === 7)?.by).toEqual([2, 3]);
    accepted(h, 4, 8, 'x'); // three acceptors say 'x' — but never three for one n
    expect(h.state(1).learned).toBeNull();

    accepted(h, 5, 7, 'x'); // the third acceptor of ballot 7
    expect(h.state(1).learned).toBe('x');
    expect(h.logCalls).toContainEqual({ node: 1, event: 'learned', data: { n: 7, value: 'x' } });
    expect(h.timerCalls).toContainEqual({ node: 1, op: 'cancel', name: RETRY_TIMER });
  });

  it('a second value under one ballot is kept visible for the integrity invariant, not merged', () => {
    const h = harness(5);
    accepted(h, 2, 9, 'y');
    accepted(h, 3, 9, 'z'); // should be impossible (#5/#6); record, never merge
    expect(h.state(1).accepts).toEqual([
      { n: 9, v: 'y', by: [2] },
      { n: 9, v: 'z', by: [3] },
    ]);
    expect(h.state(1).learned).toBeNull();
  });
});

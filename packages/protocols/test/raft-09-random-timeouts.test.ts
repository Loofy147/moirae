import { describe, expect, it } from 'vitest';
import { ELECTION_TIMEOUT_MAX, ELECTION_TIMEOUT_MIN, ELECTION_TIMER, Raft } from '../src/index';
import { Harness } from './harness';

// RAFT.md #9 / §5.2: election timeouts are drawn per node, per election, from
// ctx.random() over [MIN, MAX]. A fixed timeout produces endless split votes.
// Naive form shown failing: a constant timeout.

// Re-run init on a one-node harness with a controlled random() and report the
// election timeout it armed.
function initialTimeoutWithDraw(value: number): number | undefined {
  const h = new Harness(1, Raft);
  h.random = () => value;
  h.timerCalls.length = 0;
  h.proc(1).init(h.ctx(1));
  return h.timersOf(1).find((t) => t.op === 'set' && t.name === ELECTION_TIMER)?.delay;
}

describe('#9 election timeouts are randomised from ctx.random()', () => {
  it('draws the initial timeout from ctx.random over the full inclusive range', () => {
    expect(initialTimeoutWithDraw(0)).toBe(ELECTION_TIMEOUT_MIN);
    expect(initialTimeoutWithDraw(0.999999)).toBe(ELECTION_TIMEOUT_MAX);
    expect(initialTimeoutWithDraw(0.5)).toBe(
      ELECTION_TIMEOUT_MIN + Math.floor(0.5 * (ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN + 1)),
    );
  });

  it('different draws give different timeouts', () => {
    expect(initialTimeoutWithDraw(0.1)).not.toBe(initialTimeoutWithDraw(0.9));
  });
});

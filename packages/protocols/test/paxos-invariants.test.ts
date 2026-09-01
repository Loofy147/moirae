import { describe, expect, it } from 'vitest';
import type { WorldView } from 'moirae-core';
import { agreement, initialState, proposalIntegrity, validity } from '../src/index';
import type { PaxosState } from '../src/index';

// The three Paxos invariants against hand-built world views: each must
// fire on the violation it exists for and stay quiet on the healthy twin.
// All three carry history, so crashed nodes still constrain later checks.

function state(patch: Partial<PaxosState>): PaxosState {
  return { ...initialState(), ...patch };
}

function world(states: (PaxosState | null)[]): WorldView<PaxosState> {
  return {
    time: 0,
    step: 0,
    nodes: states.map((s, i) => ({ id: i + 1, crashed: s === null, state: s })),
    trace: [],
  };
}

describe('paxos invariants', () => {
  it('agreement: quiet on one value, loud on two — even across a crash', () => {
    const inv = agreement();
    expect(inv.check(world([state({ learned: 'v' }), state({ learned: 'v' })]))).toBeNull();
    expect(inv.check(world([null, state({ learned: 'w' })]))).toContain('learned');
  });

  it('agreement: a node changing its learned value is a violation', () => {
    const inv = agreement();
    expect(inv.check(world([state({ learned: 'v' })]))).toBeNull();
    expect(inv.check(world([state({ learned: 'w' })]))).toContain('then');
  });

  it('validity: a learned value must have been proposed, by anyone, at any time', () => {
    const inv = validity();
    expect(inv.check(world([state({ proposals: ['v'] }), state({})]))).toBeNull();
    expect(inv.check(world([null, state({ learned: 'v' })]))).toBeNull(); // proposer crashed; history remembers
    const loud = validity();
    expect(loud.check(world([state({ learned: 'ghost' })]))).toContain('nobody proposed');
  });

  it('proposalIntegrity: one value per ballot, across accepted state and tallies alike', () => {
    const inv = proposalIntegrity();
    const ok = world([
      state({ acceptedN: 4, acceptedV: 'x' }),
      state({ accepts: [{ n: 4, v: 'x', by: [1] }] }),
    ]);
    expect(inv.check(ok)).toBeNull();
    const bad = world([state({ accepts: [{ n: 4, v: 'y', by: [3] }] })]);
    expect(inv.check(bad)).toContain('proposal 4');
  });
});

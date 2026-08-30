import { describe, expect, it } from 'vitest';
import type { WorldView } from '@nemea/core';
import { electionSafety, logMatching, stateMachineSafety } from '../src/index';
import type { LogEntry, RaftState } from '../src/index';

function state(partial: Partial<RaftState>): RaftState {
  return {
    currentTerm: 0,
    votedFor: null,
    log: [],
    commitIndex: 0,
    lastApplied: 0,
    applied: [],
    nextIndex: {},
    matchIndex: {},
    role: 'follower',
    leaderId: null,
    votesGranted: [],
    ...partial,
  };
}

function world(nodes: (Partial<RaftState> | null)[]): WorldView<RaftState> {
  return {
    time: 0,
    step: 0,
    trace: [],
    nodes: nodes.map((s, i) => ({ id: i + 1, crashed: s === null, state: s === null ? null : state(s) })),
  };
}

const e = (term: number, command: string): LogEntry => ({ term, command });

describe('electionSafety (Figure 3)', () => {
  it('flags two leaders in the same term', () => {
    const inv = electionSafety();
    expect(inv.check(world([{ role: 'leader', currentTerm: 3 }, { role: 'leader', currentTerm: 3 }, {}]))).toMatch(/both leader in term 3/);
  });

  it('allows leaders of different terms and skips crashed nodes', () => {
    const inv = electionSafety();
    expect(inv.check(world([{ role: 'leader', currentTerm: 3 }, { role: 'leader', currentTerm: 4 }, null]))).toBeNull();
  });

  it('remembers: a second leader of a term after the first is gone is still a violation', () => {
    const inv = electionSafety();
    expect(inv.check(world([{ role: 'leader', currentTerm: 3 }, {}, {}]))).toBeNull();
    expect(inv.check(world([null, { role: 'leader', currentTerm: 3 }, {}]))).toMatch(/nodes 1 and 2 both leader in term 3/);
    // The same leader again is fine.
    const again = electionSafety();
    expect(again.check(world([{ role: 'leader', currentTerm: 3 }, {}, {}]))).toBeNull();
    expect(again.check(world([{ role: 'leader', currentTerm: 3 }, {}, {}]))).toBeNull();
  });
});

describe('logMatching (Figure 3)', () => {
  it('flags different commands at an index whose term both share', () => {
    const inv = logMatching();
    expect(inv.check(world([{ log: [e(1, 'x'), e(1, 'a')] }, { log: [e(1, 'x'), e(1, 'b')] }]))).toMatch(/share index 2 .* differ at index 2/);
  });

  it('flags a divergent prefix below a shared (index, term)', () => {
    const inv = logMatching();
    expect(inv.check(world([{ log: [e(1, 'a'), e(2, 'y')] }, { log: [e(1, 'b'), e(2, 'y')] }]))).toMatch(/share index 2 \(term 2\) but differ at index 1/);
  });

  it('allows logs that only agree on a proper prefix', () => {
    const inv = logMatching();
    expect(inv.check(world([{ log: [e(1, 'x'), e(2, 'a')] }, { log: [e(1, 'x'), e(3, 'b')] }, { log: [] }]))).toBeNull();
  });
});

describe('stateMachineSafety (Figure 3)', () => {
  it('flags two servers that applied different commands at one index', () => {
    const inv = stateMachineSafety();
    expect(inv.check(world([{ applied: ['x', 'a'] }, { applied: ['x', 'b'] }]))).toBe('index 2: node 1 applied a, node 2 applied b');
  });

  it('allows consistent prefixes of different lengths', () => {
    const inv = stateMachineSafety();
    expect(inv.check(world([{ applied: ['x', 'a', 'c'] }, { applied: ['x'] }, { applied: [] }]))).toBeNull();
  });

  it('remembers what a server applied before it crashed', () => {
    const inv = stateMachineSafety();
    expect(inv.check(world([{ applied: ['x', 'a'] }, {}]))).toBeNull();
    expect(inv.check(world([null, { applied: ['x', 'b'] }]))).toBe('index 2: node 1 applied a, node 2 applied b');
  });
});

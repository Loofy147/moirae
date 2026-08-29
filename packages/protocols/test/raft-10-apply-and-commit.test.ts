import { describe, expect, it } from 'vitest';
import { Raft } from '../src/index';
import type { AppendEntries, LogEntry, RaftState } from '../src/index';
import { Harness } from './harness';

// RAFT.md #10 / Figure 2 "All Servers" and AppendEntries receiver step 5:
// commitIndex = min(leaderCommit, index of last new entry) and never
// decreases; entries are applied in index order, exactly once, up to
// commitIndex. Naive forms shown failing: an unguarded min() that can move
// commitIndex backwards on a duplicated older AppendEntries, and re-applying
// from index 1 on every advance.

const e = (term: number, i: number): LogEntry => ({ term, command: `c${i}` });

function follower(log: LogEntry[], commitIndex = 0): Harness<RaftState> {
  const h = new Harness(3, Raft);
  const s = h.state(1);
  s.currentTerm = 2;
  s.log = log;
  s.commitIndex = commitIndex;
  s.lastApplied = commitIndex;
  s.applied = log.slice(0, commitIndex).map((x) => x.command);
  return h;
}

function append(h: Harness<RaftState>, prevLogIndex: number, entries: LogEntry[], leaderCommit: number): void {
  const prevLogTerm = prevLogIndex > 0 ? (h.state(1).log[prevLogIndex - 1] as LogEntry).term : 0;
  const m: AppendEntries = { type: 'AppendEntries', term: 2, leaderId: 2, prevLogIndex, prevLogTerm, entries, leaderCommit };
  h.proc(1).onMessage(h.ctx(1), 2, m);
}

describe('#10 commit index and state machine application', () => {
  it('a duplicated older AppendEntries with a high leaderCommit never moves commitIndex backwards', () => {
    const h = follower([e(1, 1), e(1, 2), e(2, 3), e(2, 4)], 4);
    append(h, 1, [e(1, 2)], 10); // covers only up to index 2
    expect(h.state(1).commitIndex).toBe(4);
    expect(h.state(1).applied).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('commitIndex is capped by the index of the last new entry', () => {
    const h = follower([e(1, 1), e(1, 2)]);
    append(h, 2, [], 10); // heartbeat: last new entry is index 2
    expect(h.state(1).commitIndex).toBe(2);
    expect(h.state(1).applied).toEqual(['c1', 'c2']);
  });

  it('entries are applied in order, exactly once, across repeated advances and duplicates', () => {
    const h = follower([]);
    append(h, 0, [e(1, 1), e(1, 2)], 0);
    append(h, 2, [e(2, 3), e(2, 4)], 2);
    append(h, 4, [], 4);
    append(h, 4, [], 4); // duplicate heartbeat
    append(h, 2, [e(2, 3)], 3); // delayed, lower leaderCommit
    const s = h.state(1);
    expect(s.commitIndex).toBe(4);
    expect(s.lastApplied).toBe(4);
    expect(s.applied).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('a leaderCommit below the local commitIndex changes nothing', () => {
    const h = follower([e(1, 1), e(1, 2), e(1, 3)], 3);
    append(h, 3, [], 1);
    expect(h.state(1).commitIndex).toBe(3);
    expect(h.state(1).applied).toEqual(['c1', 'c2', 'c3']);
  });
});

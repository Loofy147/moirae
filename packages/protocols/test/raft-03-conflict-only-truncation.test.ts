import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, Raft } from '../src/index';
import type { AppendEntries, LogEntry, RaftState } from '../src/index';
import { Harness } from './harness';

// RAFT.md #3 / §5.3, Figure 2 AppendEntries receiver steps 3–4: a follower
// deletes existing entries only where an entry genuinely conflicts (same
// index, different term), then appends entries not already present. It must
// not truncate from prevLogIndex onward, or a delayed/duplicated
// AppendEntries carrying an older suffix deletes committed entries.
// Naive form shown failing: truncate at prevLogIndex and append.

const e = (term: number, i: number): LogEntry => ({ term, command: `c${i}` });

function follower(log: LogEntry[]): Harness<RaftState> {
  const h = new Harness(3, Raft);
  const s = h.state(1);
  s.currentTerm = 2;
  s.log = log;
  return h;
}

function append(h: Harness<RaftState>, prevLogIndex: number, prevLogTerm: number, entries: LogEntry[], leaderCommit = 0): { success: boolean; matchIndex: number } {
  h.outbox.length = 0;
  const m: AppendEntries = { type: 'AppendEntries', term: 2, leaderId: 2, prevLogIndex, prevLogTerm, entries, leaderCommit };
  h.proc(1).onMessage(h.ctx(1), 2, m);
  return h.outbox[0]?.msg as unknown as { success: boolean; matchIndex: number };
}

describe('#3 followers truncate only on a genuine conflict (§5.3)', () => {
  it('a delayed AppendEntries with an older, shorter suffix does not delete later entries', () => {
    const h = follower([e(1, 1), e(1, 2), e(2, 3), e(2, 4)]);
    const reply = append(h, 1, 1, [e(1, 2)]); // the leader re-sends entry 2, already present
    expect(reply.success).toBe(true);
    expect(h.state(1).log).toEqual([e(1, 1), e(1, 2), e(2, 3), e(2, 4)]);
    expect(reply.matchIndex).toBe(2); // D1: the request covered up to index 2
  });

  it('a heartbeat matching a prefix leaves the log alone', () => {
    const h = follower([e(1, 1), e(2, 2), e(2, 3)]);
    expect(append(h, 1, 1, []).success).toBe(true);
    expect(h.state(1).log).toHaveLength(3);
  });

  it('a genuine conflict deletes the conflicting entry and everything after it', () => {
    const h = follower([e(1, 1), e(1, 2), e(1, 3), e(1, 4)]);
    const reply = append(h, 2, 1, [e(3, 3)]);
    expect(reply.success).toBe(true);
    expect(h.state(1).log).toEqual([e(1, 1), e(1, 2), e(3, 3)]);
  });

  it('new entries beyond the end are appended', () => {
    const h = follower([e(1, 1)]);
    expect(append(h, 1, 1, [e(2, 2), e(2, 3)]).matchIndex).toBe(3);
    expect(h.state(1).log).toEqual([e(1, 1), e(2, 2), e(2, 3)]);
  });

  it('the consistency check rejects a missing or mismatching previous entry', () => {
    expect(append(follower([e(1, 1)]), 3, 1, []).success).toBe(false);
    expect(append(follower([e(1, 1)]), 1, 2, []).success).toBe(false);
    expect(append(follower([e(1, 1)]), 1, 2, []).matchIndex).toBe(0);
  });
});

describe('#5 (AppendEntries side) and §5.2 candidate step-down', () => {
  it('AppendEntries from the current leader resets the election timer, even when the consistency check fails', () => {
    const h = follower([e(1, 1)]);
    h.timerCalls.length = 0;
    append(h, 5, 1, []); // fails the check
    expect(h.timersOf(1)).toEqual([{ node: 1, op: 'set', name: ELECTION_TIMER, delay: expect.any(Number) as number }]);
    expect(h.state(1).leaderId).toBe(2);
  });

  it('a candidate that hears from a leader of its term becomes a follower', () => {
    const h = follower([]);
    h.state(1).role = 'candidate';
    h.state(1).votesGranted = [1];
    append(h, 0, 0, []);
    expect(h.state(1).role).toBe('follower');
    expect(h.state(1).leaderId).toBe(2);
  });

  it('a leader ignores AppendEntries of its own term (Election Safety) and never truncates', () => {
    const h = follower([e(2, 1), e(2, 2)]);
    h.state(1).role = 'leader';
    h.outbox.length = 0;
    append(h, 0, 0, [e(2, 1)]);
    expect(h.state(1).role).toBe('leader');
    expect(h.state(1).log).toHaveLength(2);
    expect(h.outbox).toEqual([]);
  });
});

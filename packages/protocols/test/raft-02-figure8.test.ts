import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, HEARTBEAT_TIMER, Raft } from '../src/index';
import type { RaftState } from '../src/index';
import { Harness } from './harness';

// RAFT.md #2 / §5.4.2, Figure 8. A leader may not conclude that an entry
// from an earlier term is committed merely because it is replicated on a
// majority; it only advances commitIndex for an entry replicated on a
// majority whose term equals its current term, and earlier entries become
// committed indirectly. Naive form shown failing: commit on majority alone.
//
// The figure's steps, scripted exactly. Crash = the node is not spoken to;
// restart = its volatile fields (Figure 2) are reset in the test, in the
// open, while currentTerm, votedFor and log — the persistent fields — are
// kept. Nothing here reimplements engine semantics; the harness only records
// and delivers. Node ids: S1..S5 = 1..5. Index 1 (term 1) is committed
// everywhere at the start.

function cluster(): Harness<RaftState> {
  const h = new Harness(5, Raft);
  for (let id = 1; id <= 5; id++) {
    const s = h.state(id);
    s.currentTerm = 1;
    s.log = [{ term: 1, command: 'x1' }];
    s.commitIndex = 1;
    s.lastApplied = 1;
    s.applied = ['x1'];
  }
  return h;
}

function raft(h: Harness<RaftState>, id: number): Raft {
  return h.proc(id) as Raft;
}

// Figure 2, volatile state — what a crash loses. Persistent state stays.
function restart(h: Harness<RaftState>, id: number): void {
  const s = h.state(id);
  s.role = 'follower';
  s.leaderId = null;
  s.votesGranted = [];
  s.nextIndex = {};
  s.matchIndex = {};
  s.commitIndex = 0;
  s.lastApplied = 0;
  s.applied = [];
}

const isRequestVote = (m: { msg: { type: string } }) => m.msg.type === 'RequestVote';

// Deliver everything except messages to `crashed` until nothing is pending.
function pump(h: Harness<RaftState>, crashed: number[]): void {
  for (let i = 0; i < 50 && h.outbox.length > 0; i++) {
    h.deliverOnly((m) => !crashed.includes(m.to));
  }
  expect(h.outbox).toEqual([]);
}

// State Machine Safety (Figure 3): no two servers applied different commands
// at the same index.
function stateMachineSafetyViolation(h: Harness<RaftState>): string | null {
  for (let a = 1; a <= 5; a++) {
    for (let b = a + 1; b <= 5; b++) {
      const pa = h.state(a).applied;
      const pb = h.state(b).applied;
      for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
        if (pa[i] !== pb[i]) return `index ${i + 1}: S${a} applied ${pa[i]}, S${b} applied ${pb[i]}`;
      }
    }
  }
  return null;
}

// Figure 8 (a)–(c): S1 leads term 2 and replicates a term-2 entry at index 2
// to S2 only; S5 leads term 3 with a different index-2 entry, replicated to
// nobody; S1 comes back, leads term 4, re-learns that S2 holds index 2 and
// replicates it to S3 — a majority. Returns with S1 leader in term 4.
function figure8abc(h: Harness<RaftState>): void {
  // (a) S1, term 2.
  h.fire(1, ELECTION_TIMER);
  h.deliverOnly(isRequestVote);
  h.deliverOnly((m) => m.to === 1);
  expect([h.state(1).role, h.state(1).currentTerm]).toEqual(['leader', 2]);
  h.outbox.length = 0; // the initial heartbeats
  raft(h, 1).propose(h.ctx(1), 'a'); // index 2, term 2
  h.deliverOnly((m) => m.to === 2); // reaches S2 only
  h.deliverOnly((m) => m.to === 1);
  expect(h.state(2).log).toHaveLength(2);
  expect(h.state(1).commitIndex).toBe(1); // 2 of 5 is no majority
  h.outbox.length = 0; // S1 crashes

  // (b) S5, term 3, votes from S3 and S4.
  h.fire(5, ELECTION_TIMER);
  h.deliverOnly((m) => isRequestVote(m) && (m.to === 3 || m.to === 4));
  h.deliverOnly((m) => m.to === 5);
  expect([h.state(5).role, h.state(5).currentTerm]).toEqual(['leader', 3]);
  h.outbox.length = 0;
  raft(h, 5).propose(h.ctx(5), 'b'); // index 2, term 3, replicated to nobody
  h.outbox.length = 0; // S5 crashes

  // (c) S1 restarts. Term 3 fails (S3, S4 already voted for S5 in term 3);
  // term 4 succeeds with votes from S2, S3, S4.
  restart(h, 1);
  h.fire(1, ELECTION_TIMER);
  h.deliverOnly((m) => isRequestVote(m) && m.to !== 5);
  h.deliverOnly((m) => m.to === 1);
  expect([h.state(1).role, h.state(1).currentTerm]).toEqual(['candidate', 3]);
  h.fire(1, ELECTION_TIMER);
  h.deliverOnly((m) => isRequestVote(m) && m.to !== 5);
  h.deliverOnly((m) => m.to === 1);
  expect([h.state(1).role, h.state(1).currentTerm]).toEqual(['leader', 4]);
  // S1's initial heartbeats: S2 (which holds index 2) succeeds; S3 fails the
  // consistency check, S1 backs nextIndex up and re-sends the term-2 entry,
  // which S3 accepts. S4 and S5 hear nothing.
  h.deliverOnly((m) => m.to === 2 || m.to === 3);
  h.deliverOnly((m) => m.to === 1);
  h.deliverOnly((m) => m.to === 3);
  h.deliverOnly((m) => m.to === 1);
  expect(h.state(3).log).toEqual([
    { term: 1, command: 'x1' },
    { term: 2, command: 'a' },
  ]);
  expect(h.state(1).matchIndex['2']).toBe(2);
  expect(h.state(1).matchIndex['3']).toBe(2);
  // The term-2 entry is now known to be on S1, S2, S3: a majority.
}

describe('#2 Figure 8 (§5.4.2): old-term entries are not committed by majority alone', () => {
  it('(c): a term-2 entry on a majority is not committed by the term-4 leader', () => {
    const h = cluster();
    figure8abc(h);
    // S1 restarted with commitIndex 0 and has committed nothing in term 4, so
    // it may not advance commitIndex at all — not to 2 (the term-2 entry on
    // a majority), and not even to 1 — until an entry of its own term is on
    // a majority (test (e)). The majority-only rule sets 2 here.
    expect(h.state(1).commitIndex).toBe(0);
    expect(h.state(1).applied).toEqual([]);
  });

  it('(a)–(d): S5 overwrites index 2 and State Machine Safety still holds', () => {
    const h = cluster();
    figure8abc(h);
    raft(h, 1).propose(h.ctx(1), 'c'); // index 3, term 4, appended locally
    h.outbox.length = 0; // S1 crashes before replicating it

    // (d) S5 restarts. Term 4 fails (S2, S3, S4 voted for S1 in term 4); term
    // 5 succeeds: S5's last term (3) beats their last term (2).
    restart(h, 5);
    h.fire(5, ELECTION_TIMER);
    h.deliverOnly((m) => isRequestVote(m) && m.to !== 1);
    h.deliverOnly((m) => m.to === 5);
    expect([h.state(5).role, h.state(5).currentTerm]).toEqual(['candidate', 4]);
    h.fire(5, ELECTION_TIMER);
    h.deliverOnly((m) => isRequestVote(m) && m.to !== 1);
    h.deliverOnly((m) => m.to === 5);
    expect([h.state(5).role, h.state(5).currentTerm]).toEqual(['leader', 5]);
    // S5 overwrites index 2 on S2 and S3 with its term-3 entry (a genuine
    // conflict), then commits a term-5 entry, which commits index 2 with it.
    pump(h, [1]);
    expect(h.state(2).log[1]).toEqual({ term: 3, command: 'b' });
    expect(h.state(3).log[1]).toEqual({ term: 3, command: 'b' });
    raft(h, 5).propose(h.ctx(5), 'd');
    pump(h, [1]);
    expect(h.state(5).commitIndex).toBe(3);
    expect(h.state(5).applied).toEqual(['x1', 'b', 'd']);
    h.fire(5, HEARTBEAT_TIMER); // followers learn the new commitIndex from the next AppendEntries
    pump(h, [1]);
    expect(h.state(2).applied).toEqual(['x1', 'b', 'd']);

    // Nobody ever applied the term-2 entry, so no server disagrees with
    // another about any index. Under the majority-only rule S1 applied 'a'
    // at index 2 in (c), and this reports it.
    expect(stateMachineSafetyViolation(h)).toBeNull();
  });

  it('(e): once a term-4 entry is on a majority, index 2 is committed with it and S5 cannot win', () => {
    const h = cluster();
    figure8abc(h);
    raft(h, 1).propose(h.ctx(1), 'c'); // index 3, term 4
    pump(h, [5]);
    expect(h.state(1).commitIndex).toBe(3); // the term-4 entry on a majority commits index 2 too
    expect(h.state(1).applied).toEqual(['x1', 'a', 'c']);
    h.fire(1, HEARTBEAT_TIMER);
    pump(h, [5]);
    expect(h.state(2).applied).toEqual(['x1', 'a', 'c']);

    restart(h, 5);
    for (let attempt = 0; attempt < 3; attempt++) {
      h.fire(5, ELECTION_TIMER);
      h.deliverOnly((m) => isRequestVote(m) && m.to !== 1);
      h.deliverOnly((m) => m.to === 5);
      expect(h.state(5).role).toBe('candidate'); // S2, S3, S4's last term (4) beats S5's (3)
    }
    expect(stateMachineSafetyViolation(h)).toBeNull();
  });
});

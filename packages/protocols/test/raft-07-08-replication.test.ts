import { describe, expect, it } from 'vitest';
import { ELECTION_TIMER, Raft } from '../src/index';
import type { AppendEntriesResponse, RaftState } from '../src/index';
import { Harness } from './harness';

// RAFT.md #7 / §5.3: on a successful AppendEntries the follower's match index
// is set from the entries actually sent in *that* request (deviation D1: the
// follower echoes it), not from the leader's current log length, which may
// have grown since. Next index decrements on failure; match index never moves
// backwards — that monotonicity is what makes D1 safe under duplication and
// reordering, so it has its own replay test. RAFT.md #6: a response only
// counts while we are leader in the term it answers. RAFT.md #8: a leader
// only appends. Naive forms shown failing: matchIndex from log length with
// no role check; a leader processing AppendEntries like a follower.

function leader(nodes = 3): Harness<RaftState> {
  const h = new Harness(nodes, Raft);
  h.fire(1, ELECTION_TIMER);
  h.deliverAll(); // votes, grants, first heartbeats
  expect(h.state(1).role).toBe('leader');
  h.outbox.length = 0;
  return h;
}

function respond(h: Harness<RaftState>, from: number, success: boolean, matchIndex: number): void {
  const m: AppendEntriesResponse = { type: 'AppendEntriesResponse', term: h.state(1).currentTerm, success, matchIndex };
  h.proc(1).onMessage(h.ctx(1), from, m);
}

function raft(h: Harness<RaftState>): Raft {
  return h.proc(1) as Raft;
}

describe('#7 matchIndex comes from the request answered', () => {
  it('is set from what the request covered, not from the leader log that grew meanwhile', () => {
    const h = leader();
    raft(h).propose(h.ctx(1), 'a');
    raft(h).propose(h.ctx(1), 'b');
    raft(h).propose(h.ctx(1), 'c');
    expect(h.state(1).log).toHaveLength(3);
    respond(h, 2, true, 1); // the answer to the request that carried only 'a'
    expect(h.state(1).matchIndex['2']).toBe(1);
    expect(h.state(1).nextIndex['2']).toBe(2);
  });

  it('replaying an old success response never moves matchIndex backwards', () => {
    const h = leader();
    for (const c of ['a', 'b', 'c']) raft(h).propose(h.ctx(1), c);
    respond(h, 2, true, 1);
    respond(h, 2, true, 3);
    expect(h.state(1).matchIndex['2']).toBe(3);
    respond(h, 2, true, 1); // duplicate of the first response, delivered late
    respond(h, 2, true, 2); // an even later-arriving intermediate one
    expect(h.state(1).matchIndex['2']).toBe(3);
    expect(h.state(1).nextIndex['2']).toBe(4);
  });

  it('on failure nextIndex decrements and the leader retries at once; matchIndex is untouched', () => {
    const h = leader();
    for (const c of ['a', 'b', 'c']) raft(h).propose(h.ctx(1), c);
    respond(h, 2, true, 2);
    h.outbox.length = 0;
    respond(h, 2, false, 0);
    expect(h.state(1).nextIndex['2']).toBe(2);
    expect(h.state(1).matchIndex['2']).toBe(2);
    expect(h.outbox).toHaveLength(1);
    expect(h.outbox[0]?.to).toBe(2);
    expect(h.outbox[0]?.msg['prevLogIndex']).toBe(1);
    expect((h.outbox[0]?.msg['entries'] as unknown[]).length).toBe(2);
    // ...and never below 1.
    respond(h, 2, false, 0);
    respond(h, 2, false, 0);
    expect(h.state(1).nextIndex['2']).toBe(1);
  });
});

describe('#6 (AppendEntries responses)', () => {
  it('a response arriving after the leader stepped down in the same term is ignored', () => {
    const h = leader();
    raft(h).propose(h.ctx(1), 'a');
    h.state(1).role = 'follower';
    h.state(1).matchIndex = {};
    h.state(1).nextIndex = {};
    h.outbox.length = 0;
    respond(h, 2, true, 1);
    respond(h, 3, false, 0);
    expect(h.state(1).matchIndex).toEqual({});
    expect(h.outbox).toEqual([]);
  });
});

describe('#8 leaders only append', () => {
  it('propose appends one entry in the current term and replicates it to every peer', () => {
    const h = leader(5);
    expect(raft(h).propose(h.ctx(1), 'a')).toBe(true);
    expect(h.state(1).log).toEqual([{ term: 1, command: 'a' }]);
    expect(h.outbox.map((m) => [m.to, (m.msg['entries'] as unknown[]).length])).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
  });

  it('propose on a non-leader is refused and appends nothing', () => {
    const h = new Harness(3, Raft);
    expect(raft(h).propose(h.ctx(1), 'a')).toBe(false);
    expect(h.state(1).log).toEqual([]);
    expect(h.outbox).toEqual([]);
  });

  it('through proposals, failures, successes and stale replays the leader log only ever grows', () => {
    const h = leader();
    const snapshots: string[] = [];
    const step = (f: () => void) => {
      const before = h.state(1).log.map((e) => `${e.term}:${e.command}`).join(',');
      f();
      const after = h.state(1).log.map((e) => `${e.term}:${e.command}`).join(',');
      expect(after.startsWith(before)).toBe(true);
      snapshots.push(after);
    };
    step(() => raft(h).propose(h.ctx(1), 'a'));
    step(() => respond(h, 2, false, 0));
    step(() => raft(h).propose(h.ctx(1), 'b'));
    step(() => respond(h, 2, true, 2));
    step(() => respond(h, 3, true, 1));
    step(() => respond(h, 2, true, 1));
    step(() => raft(h).propose(h.ctx(1), 'c'));
    expect(snapshots.at(-1)).toBe('1:a,1:b,1:c');
  });
});

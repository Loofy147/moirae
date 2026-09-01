// Single-decree Paxos, transcribed from Lamport, "Paxos Made Simple" (2001).
// Read §2.2 before touching any handler. Every rule cites its section; every
// choice the paper leaves open is named in docs/PAXOS.md (C1–C8).
//
// Persistence discipline: promised, acceptedN and acceptedV are updated
// before any ctx.send in every handler (§2.2 — the acceptor's response must
// be remembered "even if it fails and restarts"). SPEC §3 records that the
// engine cannot observe this ordering in v0; the discipline is enforced by
// review, not by a test.

import type { Ctx, Message, NodeId, Process } from 'moirae-core';
import type { Accept, Accepted, PaxosMessage, Prepare, Promised } from './messages';
import {
  initialState,
  RETRY_TIMEOUT_MAX,
  RETRY_TIMEOUT_MIN,
  RETRY_TIMER,
  type PaxosState,
  type Value,
} from './state';

export class Paxos implements Process<PaxosState> {
  // §2.2–§2.3 — the acceptor "must remember this information even if it
  // fails and restarts". Proposer and learner state is volatile (C8).
  readonly persistent = ['promised', 'acceptedN', 'acceptedV'] as const;

  init(): PaxosState {
    return initialState();
  }

  onMessage(ctx: Ctx<PaxosState>, from: NodeId, msg: Message): void {
    const m = msg as PaxosMessage;
    switch (m.type) {
      case 'Prepare':
        this.onPrepare(ctx, from, m);
        break;
      case 'Promised':
        this.onPromised(ctx, from, m);
        break;
      case 'Accept':
        this.onAccept(ctx, from, m);
        break;
      case 'Accepted':
        this.onAccepted(ctx, from, m);
        break;
    }
  }

  onTimer(ctx: Ctx<PaxosState>, name: string): void {
    if (name !== RETRY_TIMER) return;
    const s = ctx.state;
    // C5 — a proposer whose attempt has not produced a learned value tries
    // again with a fresh, higher number. §2.4: progress is probable, not
    // guaranteed; safety never depends on this timer.
    if (s.wanted !== null && s.learned === null) this.startAttempt(ctx);
  }

  // One value per node, ever (PAXOS.md scope). Returns false if this node
  // already wants a value or has already learned the chosen one.
  propose(ctx: Ctx<PaxosState>, value: Value): boolean {
    const s = ctx.state;
    if (s.wanted !== null || s.learned !== null) return false;
    s.wanted = value;
    s.proposals.push(value); // for the validity invariant
    this.startAttempt(ctx);
    return true;
  }

  // §2.2 phase 1a — pick a number, ask everyone. C2: n = round·N + me keeps
  // proposers' numbers in disjoint sets and increasing per proposer.
  private startAttempt(ctx: Ctx<PaxosState>): void {
    const s = ctx.state;
    s.round += 1;
    s.attemptN = s.round * this.cluster(ctx) + ctx.me;
    s.phase = 'prepare';
    s.role = 'proposing'; // C9 — display only
    s.term = s.attemptN;
    s.promisesFrom = [];
    s.highestAccepted = null;
    // C1 — our own acceptor answers through the same rule as everyone
    // else's, locally; a refusal here is possible (we promised a higher n).
    const own = this.promiseRule(ctx, s.attemptN);
    if (own !== null) this.recordPromise(ctx, ctx.me, s.attemptN, own.acceptedN, own.acceptedV);
    if (s.phase === 'prepare') {
      // Still gathering (a single-node cluster is already in phase 2 here).
      for (const peer of ctx.peers) ctx.send(peer, { type: 'Prepare', n: s.attemptN });
    }
    ctx.setTimer(RETRY_TIMER, ctx.randomInt(RETRY_TIMEOUT_MIN, RETRY_TIMEOUT_MAX));
  }

  // §2.2 — "If an acceptor receives a prepare request with number n greater
  // than that of any prepare request to which it has already responded, then
  // it responds ... with a promise not to accept any more proposals numbered
  // less than n and with the highest-numbered proposal (if any) that it has
  // accepted." Strictly greater (PAXOS.md #1); anything else is ignored (#9).
  private promiseRule(
    ctx: Ctx<PaxosState>,
    n: number,
  ): { acceptedN: number; acceptedV: Value | null } | null {
    const s = ctx.state;
    if (n <= s.promised) return null;
    s.promised = n; // persisted before any response (§2.2)
    return { acceptedN: s.acceptedN, acceptedV: s.acceptedV };
  }

  // §2.2 P1a — "an acceptor can accept a proposal numbered n iff it has not
  // responded to a prepare request having a number greater than n": n ≥
  // promised, greater OR EQUAL — the proposer's own prepare set promised to
  // exactly n (PAXOS.md #2). C4: accepting raises promised, so the stored
  // accepted proposal is the highest-numbered one by construction.
  private acceptRule(ctx: Ctx<PaxosState>, n: number, v: Value): boolean {
    const s = ctx.state;
    if (n < s.promised) return false; // #9 — refusal is silence
    s.promised = n; // C4
    s.acceptedN = n; // persisted before announcing (§2.2)
    s.acceptedV = v;
    return true;
  }

  private onPrepare(ctx: Ctx<PaxosState>, from: NodeId, m: Prepare): void {
    const res = this.promiseRule(ctx, m.n);
    if (res === null) return; // #9
    ctx.send(from, {
      type: 'Promised',
      n: m.n,
      acceptedN: res.acceptedN,
      acceptedV: res.acceptedV,
    });
  }

  private onPromised(ctx: Ctx<PaxosState>, from: NodeId, m: Promised): void {
    const s = ctx.state;
    // #4 — a promise counts only for the attempt it answers; #5 — once
    // phase 2 has started for this number, its value is bound and late
    // promises change nothing.
    if (s.phase !== 'prepare' || m.n !== s.attemptN) return;
    this.recordPromise(ctx, from, m.n, m.acceptedN, m.acceptedV);
  }

  private recordPromise(
    ctx: Ctx<PaxosState>,
    acceptor: NodeId,
    n: number,
    acceptedN: number,
    acceptedV: Value | null,
  ): void {
    const s = ctx.state;
    if (s.promisesFrom.includes(acceptor)) return; // #4 — one acceptor, once
    s.promisesFrom.push(acceptor);
    // #3 — track the highest-numbered accepted proposal reported so far.
    if (acceptedN > 0 && acceptedV !== null) {
      if (s.highestAccepted === null || acceptedN > s.highestAccepted.n) {
        s.highestAccepted = { n: acceptedN, v: acceptedV };
      }
    }
    // §2.2 — a majority of acceptors for proposal n moves us to phase 2.
    if (s.promisesFrom.length * 2 > this.cluster(ctx)) this.startPhase2(ctx);
  }

  // §2.2 phase 2a — "v is the value of the highest-numbered proposal among
  // the responses, or is any value ... if the responders reported no
  // proposals" (PAXOS.md #3). From here on, attemptN means this value and
  // nothing else, ever (#5).
  private startPhase2(ctx: Ctx<PaxosState>): void {
    const s = ctx.state;
    s.phase = 'accept';
    const v = s.highestAccepted !== null ? s.highestAccepted.v : (s.wanted as Value);
    // C1 — our own acceptor takes the accept request through the same rule,
    // and it can refuse: if we promised a rival's higher number after our
    // own prepare, the majority that got us here came from peers alone.
    if (this.acceptRule(ctx, s.attemptN, v)) this.announceAccepted(ctx, s.attemptN, v);
    for (const peer of ctx.peers) ctx.send(peer, { type: 'Accept', n: s.attemptN, v });
  }

  private onAccept(ctx: Ctx<PaxosState>, _from: NodeId, m: Accept): void {
    if (!this.acceptRule(ctx, m.n, m.v)) return; // #9
    this.announceAccepted(ctx, m.n, m.v);
  }

  // §2.3 / C6 — an acceptor that accepts tells every learner, which is
  // every node here, our own tally included.
  private announceAccepted(ctx: Ctx<PaxosState>, n: number, v: Value): void {
    for (const peer of ctx.peers) ctx.send(peer, { type: 'Accepted', n, v });
    this.recordAccept(ctx, ctx.me, n, v);
  }

  private onAccepted(ctx: Ctx<PaxosState>, from: NodeId, m: Accepted): void {
    this.recordAccept(ctx, from, m.n, m.v);
  }

  // §2.3 — a learner discovers the chosen value by finding that a majority
  // of acceptors accepted a proposal: same n, one acceptor once (#8). A
  // tally is per (n, v) pair: the protocol never produces two values for
  // one n (#5, #6), so a second (n, v') tally is evidence for the
  // proposalIntegrity invariant, not something to merge or hide.
  private recordAccept(ctx: Ctx<PaxosState>, acceptor: NodeId, n: number, v: Value): void {
    const s = ctx.state;
    let tally = s.accepts.find((t) => t.n === n && t.v === v);
    if (tally === undefined) {
      tally = { n, v, by: [] };
      s.accepts.push(tally);
    }
    if (tally.by.includes(acceptor)) return; // #8 — duplicates count once
    tally.by.push(acceptor);
    if (tally.by.length * 2 > this.cluster(ctx) && s.learned === null) {
      s.learned = v; // set once; agreement() watches that it never changes
      s.role = 'learned'; // C9 — display only
      ctx.log('learned', { n, value: v });
      ctx.cancelTimer(RETRY_TIMER); // our value is in, or lost fairly — done
    }
  }

  private cluster(ctx: Ctx<PaxosState>): number {
    return ctx.peers.length + 1;
  }
}

// Shared shorthand for the Paxos harness tests. The Harness itself stays
// protocol-agnostic; everything Paxos-flavoured lives here.

import { Paxos, RETRY_TIMER } from '../src/index';
import type { PaxosState } from '../src/index';
import { Harness, type Sent } from './harness';

export type { PaxosState };
export type { Sent };
export { RETRY_TIMER };

export function harness(nodes: number): Harness<PaxosState> {
  return new Harness<PaxosState>(nodes, Paxos);
}

// An acceptor that has accepted (n, v) has, under C4, promised at least n.
export function seedAccepted(s: PaxosState, n: number, v: string): void {
  s.promised = n;
  s.acceptedN = n;
  s.acceptedV = v;
}

export function isPrepare(s: Sent): boolean {
  return (s.msg as { type: string }).type === 'Prepare';
}

export function isPromise(s: Sent): boolean {
  return (s.msg as { type: string }).type === 'Promised';
}

export function isAccept(s: Sent): boolean {
  return (s.msg as { type: string }).type === 'Accept';
}

export function isAccepted(s: Sent): boolean {
  return (s.msg as { type: string }).type === 'Accepted';
}

// Deliver the first pending message matching pred; throws if none does.
export function deliverWhere(h: Harness<PaxosState>, pred: (s: Sent) => boolean): Sent {
  const i = h.outbox.findIndex(pred);
  if (i === -1) throw new Error('helpers: no pending message matches');
  return h.deliver(i);
}

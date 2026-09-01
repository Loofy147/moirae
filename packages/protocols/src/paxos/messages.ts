// The four messages of single-decree Paxos, transcribed from "Paxos Made
// Simple" §2.2 (the two phases) and §2.3 (learning). There are no NACKs:
// a request an acceptor will not grant is ignored (§2.2, PAXOS.md C3).
// The sender of every message is the engine's delivery `from`; messages
// carry no sender field of their own.

import type { Message } from 'moirae-core';
import type { Value } from './state';

// Phase 1a (§2.2): "a proposer selects a proposal number n and sends a
// prepare request with number n to a majority of acceptors" — here to all,
// self included via the local path (C1).
export interface Prepare extends Message {
  readonly type: 'Prepare';
  readonly n: number;
}

// Phase 1b (§2.2) — the paper calls this response "a promise not to accept
// any more proposals numbered less than n", carrying "the highest-numbered
// proposal (if any) that it has accepted". Named Promised, not Promise, only
// to avoid shadowing the global. acceptedN 0 / acceptedV null = none.
export interface Promised extends Message {
  readonly type: 'Promised';
  readonly n: number; // the prepare this promise answers (PAXOS.md #4)
  readonly acceptedN: number;
  readonly acceptedV: Value | null;
}

// Phase 2a (§2.2): "an accept request for a proposal numbered n with a
// value v, where v is the value of the highest-numbered proposal among the
// responses, or is any value if the responders reported no proposals."
export interface Accept extends Message {
  readonly type: 'Accept';
  readonly n: number;
  readonly v: Value;
}

// Phase 2b / §2.3: an acceptor that accepts tells every node (C6 — the
// simple learning option; no distinguished learner).
export interface Accepted extends Message {
  readonly type: 'Accepted';
  readonly n: number;
  readonly v: Value;
}

export type PaxosMessage = Prepare | Promised | Accept | Accepted;

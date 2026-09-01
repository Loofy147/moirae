// Workload drivers for the Paxos engine-level tests. The shipped Paxos has
// no client logic (PAXOS.md scope); these subclasses arm a kick timer and
// call propose() when it fires, entirely through Ctx, so runs stay
// deterministic. propose() itself refuses once a value is wanted or learned.
//
// init's ctx parameter is optional only to stay override-compatible with
// the parameterless base init; the engine always passes it.

import type { Ctx } from 'moirae-core';
import { Paxos, type PaxosState } from '../src/index';

export const KICK_TIMER = 'kick';

// Node 1 proposes 'v1' at t=50; nobody else proposes.
export class PaxosSolo extends Paxos {
  override init(ctx?: Ctx<PaxosState>): PaxosState {
    const s = super.init();
    if (ctx !== undefined && ctx.me === 1) ctx.setTimer(KICK_TIMER, 50);
    return s;
  }

  override onTimer(ctx: Ctx<PaxosState>, name: string): void {
    if (name !== KICK_TIMER) {
      super.onTimer(ctx, name);
      return;
    }
    this.propose(ctx, `v${ctx.me}`);
  }
}

// Every node proposes its own value after a randomized delay — the
// contention case §2.4 warns about, which randomized retry (C5) resolves.
export class PaxosContend extends PaxosSolo {
  override init(ctx?: Ctx<PaxosState>): PaxosState {
    const s = super.init(ctx);
    if (ctx !== undefined) ctx.setTimer(KICK_TIMER, ctx.randomInt(10, 300));
    return s;
  }
}

// Node 1 proposes 'v1' at t=50; node 3 proposes 'v3' at t=2500 — long after
// the value is chosen. The scenario crashes node 3 in between, so its
// volatile learner state is gone and only the persisted acceptor state can
// force it onto the chosen value (PAXOS.md scenario 4).
export class PaxosStaggered extends PaxosSolo {
  override init(ctx?: Ctx<PaxosState>): PaxosState {
    const s = super.init(ctx);
    if (ctx !== undefined && ctx.me === 3) ctx.setTimer(KICK_TIMER, 2500);
    return s;
  }
}

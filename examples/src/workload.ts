// The example workload. The shipped Raft has no notion of clients; this
// subclass arms a `propose` timer on every node and, when it fires on a
// leader with budget left, appends one command. The budget lives on the
// process instance: a test driver's counter, deterministic, invisible to the
// protocol. (packages/protocols/test/workload.ts is the same driver for the
// protocol's own tests; the examples stay self-contained on purpose.)

import type { Ctx } from '@moira/core';
import { Raft, type RaftState } from '@moira/protocols';

export const PROPOSE_TIMER = 'propose';
export const PROPOSE_INTERVAL = 40;
export const PROPOSALS_PER_NODE = 20;

export class RaftWithLoad extends Raft {
  private proposed = 0;

  override init(ctx: Ctx<RaftState>): RaftState {
    const state = super.init(ctx);
    ctx.setTimer(PROPOSE_TIMER, PROPOSE_INTERVAL);
    return state;
  }

  override onTimer(ctx: Ctx<RaftState>, name: string): void {
    if (name !== PROPOSE_TIMER) {
      super.onTimer(ctx, name);
      return;
    }
    if (ctx.state.role === 'leader' && this.proposed < PROPOSALS_PER_NODE) {
      this.proposed += 1;
      this.propose(ctx, `n${ctx.me}-${this.proposed}`);
    }
    if (this.proposed < PROPOSALS_PER_NODE) ctx.setTimer(PROPOSE_TIMER, PROPOSE_INTERVAL);
  }
}

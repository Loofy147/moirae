// Test-only workload: the shipped Raft class has no notion of clients
// (docs/RAFT.md). Every node arms a `propose` timer; when it fires on a
// leader with budget left, the leader appends one command. The budget lives
// on the process instance, not in ctx.state — it is a test driver's counter,
// deterministic and invisible to the protocol.

import type { Ctx } from '@moira/core';
import { Raft, type RaftState } from '../src/index';

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

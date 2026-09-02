import { describe, expect, it } from 'vitest';
import { simulate } from 'moirae-core';
import {
  ABD,
  completedWriteReadFreshness,
  historyFromTrace,
  isLinearizable,
  tagMonotonicity,
} from '../src/index';
import type { ABDState } from '../src/index';
import type { Ctx } from 'moirae-core';

class ABDWritePartitionHealRead extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 1) ctx.setTimer('write', 0);
    if (ctx.me === 2) ctx.setTimer('read', 100);
    return state;
  }

  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'write' && ctx.me === 1) this.write(ctx, 'v1');
    if (name === 'read' && ctx.me === 2) this.read(ctx);
  }
}

class ABDCrashBeforeWriteCompletion extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 1) ctx.setTimer('write', 0);
    return state;
  }

  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'write' && ctx.me === 1) this.write(ctx, 'v1');
  }
}

class ABDConcurrentOverlap extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 1) ctx.setTimer('write', 0);
    if (ctx.me === 2) ctx.setTimer('read', 2);
    return state;
  }

  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'write' && ctx.me === 1) this.write(ctx, 'v1');
    if (name === 'read' && ctx.me === 2) this.read(ctx);
  }
}

function events(result: ReturnType<typeof simulate<ABDState>>, name: string) {
  return result.trace.filter(
    (event) => event.kind === 'log' && event.event === name,
  );
}

describe('ABD deterministic fault matrix', () => {
  it('heals a post-write partition without allowing a later read to regress', () => {
    const result = simulate<ABDState>({
      seed: 0xabd101,
      nodes: 3,
      process: ABDWritePartitionHealRead,
      until: { simTime: 250 },
      network: {
        latency: [1, 5],
        partitions: [{ groups: [[1], [2, 3]], start: 20, end: 80 }],
      },
      invariants: [tagMonotonicity(), completedWriteReadFreshness()],
    });

    expect(result.violation).toBeNull();
    expect(events(result, 'write-complete')).toHaveLength(1);
    expect(events(result, 'read-complete')).toHaveLength(1);
    expect(isLinearizable(historyFromTrace(result.trace))).toBe(true);

    const read = events(result, 'read-complete')[0];
    expect(read.data?.['value']).toBe('v1');
  });

  it('does not fabricate write completion when the writer crashes before a quorum', () => {
    const result = simulate<ABDState>({
      seed: 0xabd102,
      nodes: 3,
      process: ABDCrashBeforeWriteCompletion,
      until: { simTime: 100 },
      network: {
        latency: [20, 20],
        partitions: [{ groups: [[1], [2, 3]], start: 0, end: 10 }],
      },
      faults: { crashes: [{ node: 1, at: 5, restartAt: 60 }] },
      invariants: [tagMonotonicity()],
    });

    expect(result.violation).toBeNull();
    expect(events(result, 'write-start')).toHaveLength(1);
    expect(events(result, 'write-complete')).toHaveLength(0);
  });

  it('accepts a legal overlapping read/write history and preserves the returned tag', () => {
    const result = simulate<ABDState>({
      seed: 0xabd103,
      nodes: 3,
      process: ABDConcurrentOverlap,
      until: { simTime: 300 },
      network: { latency: [5, 15] },
      invariants: [tagMonotonicity(), completedWriteReadFreshness()],
    });

    expect(result.violation).toBeNull();
    expect(events(result, 'write-complete')).toHaveLength(1);
    expect(events(result, 'read-complete')).toHaveLength(1);
    expect(isLinearizable(historyFromTrace(result.trace))).toBe(true);
    expect(events(result, 'read-complete')[0].data?.['tag']).toEqual({ counter: 1, writerId: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { simulate } from 'moirae-core';
import type { Ctx, Invariant, WorldView } from 'moirae-core';
import {
  ABD,
  completedWriteReadFreshness,
  historyFromTrace,
  isLinearizable,
  tagMonotonicity,
} from '../src/index';
import type { ABDState } from '../src/index';

class ABDWriteThenRead extends ABD {
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

class ABDWriteRestart extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 1) ctx.setTimer('write', 0);
    return state;
  }
  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'write' && ctx.me === 1) this.write(ctx, `v${ctx.state.writeCounter + 1}`);
  }
}

class ABDStaleMessageAfterRestart extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 1) ctx.setTimer('write', 80);
    if (ctx.me === 2) ctx.setTimer('old-read', 0);
    return state;
  }
  override onRestart(ctx: Ctx<ABDState>): void {
    if (ctx.me === 2) ctx.setTimer('new-read', 1);
  }
  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'write' && ctx.me === 1) this.write(ctx, 'v1');
    if (name === 'old-read' && ctx.me === 2) this.read(ctx);
    if (name === 'new-read' && ctx.me === 2) this.read(ctx);
  }
}

class ABDReadMinority extends ABD {
  override init(ctx: Ctx<ABDState>): ABDState {
    const state = super.init();
    if (ctx.me === 2) ctx.setTimer('read', 0);
    return state;
  }
  override onTimer(ctx?: Ctx<ABDState>, name?: string): void {
    if (ctx === undefined || name === undefined) return;
    if (name === 'read' && ctx.me === 2) this.read(ctx);
  }
}

class ABDWriteMinority extends ABD {
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

function capture(): { invariant: Invariant<ABDState>; get: () => WorldView<ABDState> | null } {
  let last: WorldView<ABDState> | null = null;
  const invariant: Invariant<ABDState> = {
    name: 'abdCapture',
    check: (world) => { last = world; return null; },
  };
  return { invariant, get: () => last };
}

function logEvents(result: ReturnType<typeof simulate<ABDState>>, name: string) {
  return result.trace.filter(
    (event) =>
      (event as { kind: string; event?: string }).kind === 'log' &&
      (event as { event?: string }).event === name,
  );
}

describe('ABD on the engine', () => {
  it('completes write then read under delayed duplication/reordering without safety violations', () => {
    const captured = capture();
    const result = simulate<ABDState>({
      seed: 0xabd001, nodes: 3, process: ABDWriteThenRead, until: { simTime: 2_000 },
      network: { latency: [1, 20], duplicateRate: 0.25 },
      invariants: [tagMonotonicity(), completedWriteReadFreshness(), captured.invariant],
    });
    expect(result.violation).toBeNull();
    const world = captured.get();
    expect(world).not.toBeNull();
    const live = world?.nodes.filter((node) => node.state !== null) ?? [];
    expect(live).toHaveLength(3);
    for (const node of live) {
      expect(node.state?.register.value).toBe('v1');
      expect(node.state?.register.tag).toEqual({ counter: 1, writerId: 1 });
    }
    expect(logEvents(result, 'read-complete')).toHaveLength(1);
    expect(isLinearizable(historyFromTrace(result.trace))).toBe(true);
  });

  it('preserves the single-writer counter across crash/restart', () => {
    const captured = capture();
    const result = simulate<ABDState>({
      seed: 0xabd002, nodes: 3, process: ABDWriteRestart, until: { simTime: 500 },
      network: { latency: [1, 10] },
      faults: { crashes: [{ node: 1, at: 100, restartAt: 200 }] },
      invariants: [tagMonotonicity(), captured.invariant],
    });
    expect(result.violation).toBeNull();
    const crash = result.trace.find(
      (event) =>
        (event as { kind: string; fault?: string; node?: number }).kind === 'fault' &&
        (event as { fault?: string }).fault === 'crash',
    ) as { node?: number; persisted?: string[] } | undefined;
    expect(crash?.node).toBe(1);
    expect(crash?.persisted).toEqual(['register', 'writeCounter', 'nextOperationId']);
    expect(logEvents(result, 'write-complete').length).toBeGreaterThanOrEqual(2);
    const world = captured.get();
    const writer = world?.nodes.find((node) => node.id === 1);
    expect(writer?.state?.writeCounter).toBeGreaterThanOrEqual(2);
    expect(writer?.state?.register.tag).toEqual({ counter: 2, writerId: 1 });
  });

  it('does not let delayed pre-crash responses satisfy a post-restart read', () => {
    const result = simulate<ABDState>({
      seed: 0xabd003, nodes: 3, process: ABDStaleMessageAfterRestart, until: { simTime: 250 },
      network: { latency: [50, 50] },
      faults: { crashes: [{ node: 2, at: 10, restartAt: 20 }] },
      invariants: [tagMonotonicity(), completedWriteReadFreshness()],
    });
    expect(result.violation).toBeNull();
    const starts = logEvents(result, 'read-start');
    expect(starts).toHaveLength(2);
    const startIds = starts.map((event) => (event as { data?: { operationId?: string } }).data?.operationId);
    expect(startIds[0]).toBeDefined();
    expect(startIds[1]).toBeDefined();
    expect(startIds[1]).not.toBe(startIds[0]);
    const completions = logEvents(result, 'read-complete');
    expect(completions).toHaveLength(1);
    expect((completions[0] as { data?: { value?: string } }).data?.value).toBe('v1');
    expect((completions[0] as { t?: number }).t).toBeGreaterThanOrEqual(171);
    expect(isLinearizable(historyFromTrace(result.trace))).toBe(true);
  });

  it('does not complete a write during a writer-minority partition', () => {
    const result = simulate<ABDState>({
      seed: 0xabd004, nodes: 3, process: ABDWriteMinority, until: { simTime: 100 },
      network: { latency: [1, 1], partitions: [{ groups: [[1], [2, 3]], start: 0, end: 100 }] },
      invariants: [tagMonotonicity()],
    });
    expect(result.violation).toBeNull();
    expect(logEvents(result, 'write-start')).toHaveLength(1);
    expect(logEvents(result, 'write-complete')).toHaveLength(0);
  });

  it('does not complete a read from a minority partition', () => {
    const result = simulate<ABDState>({
      seed: 0xabd005, nodes: 3, process: ABDReadMinority, until: { simTime: 100 },
      network: { latency: [1, 1], partitions: [{ groups: [[1, 3], [2]], start: 0, end: 50 }] },
      invariants: [tagMonotonicity(), completedWriteReadFreshness()],
    });
    expect(result.violation).toBeNull();
    expect(logEvents(result, 'read-start')).toHaveLength(1);
    expect(logEvents(result, 'read-complete')).toHaveLength(0);
  });
});

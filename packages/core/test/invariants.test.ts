import { describe, expect, it } from 'vitest';
import type { Invariant, WorldView } from '../src/invariants';
import { simulate } from '../src/simulate';
import type { Ctx, Process } from '../src/types';

type Bag = Record<string, unknown>;

// A node that increments `ticks` every 10ms forever; node 1 crashes at its
// third tick if asked to.
class Ticker implements Process<Bag> {
  init(ctx: Ctx<Bag>): Bag {
    ctx.setTimer('tick', 10);
    return { ticks: 0 };
  }
  onMessage(): void {}
  onTimer(ctx: Ctx<Bag>): void {
    ctx.state['ticks'] = (ctx.state['ticks'] as number) + 1;
    ctx.setTimer('tick', 10);
  }
}

class CrashingTicker extends Ticker {
  override onTimer(ctx: Ctx<Bag>): void {
    super.onTimer(ctx);
    if (ctx.me === 1 && ctx.state['ticks'] === 3) ctx.crash();
  }
}

describe('invariants (SPEC §7)', () => {
  it('a violation ends the simulation at the violating step and is reported', () => {
    const noMoreThanTwoTicks: Invariant<Bag> = {
      name: 'noMoreThanTwoTicks',
      check: (world) => {
        for (const n of world.nodes) {
          if (n.state !== null && (n.state['ticks'] as number) > 2) {
            return `node ${n.id} has ${n.state['ticks']} ticks`;
          }
        }
        return null;
      },
    };
    const run = simulate({
      seed: 1,
      nodes: 2,
      process: Ticker,
      until: { simTime: 10_000 },
      invariants: [noMoreThanTwoTicks],
    });
    // Two nodes tick alternately: steps 1,2 -> 1 tick each; 3,4 -> 2; step 5 -> node 1 has 3.
    expect(run.violation).toEqual({
      invariant: 'noMoreThanTwoTicks',
      detail: 'node 1 has 3 ticks',
      step: 5,
      time: 30,
    });
    expect(run.steps).toBe(5);
    const last = run.trace[run.trace.length - 1] as unknown as Bag;
    expect(last['kind']).toBe('violation');
    expect(last['invariant']).toBe('noMoreThanTwoTicks');
    expect(last['detail']).toBe('node 1 has 3 ticks');
  });

  it('runs after init (step 0) and then after every step by default', () => {
    const steps: number[] = [];
    const run = simulate({
      seed: 1,
      nodes: 1,
      process: Ticker,
      until: { steps: 4 },
      invariants: [
        {
          name: 'recorder',
          check: (world) => {
            steps.push(world.step);
            return null;
          },
        },
      ],
    });
    expect(run.violation).toBeNull();
    expect(steps).toEqual([0, 1, 2, 3, 4]);
  });

  it('honours every: n', () => {
    const steps: number[] = [];
    simulate({
      seed: 1,
      nodes: 1,
      process: Ticker,
      until: { steps: 9 },
      invariants: [
        {
          name: 'recorder',
          every: 3,
          check: (world) => {
            steps.push(world.step);
            return null;
          },
        },
      ],
    });
    expect(steps).toEqual([0, 3, 6, 9]);
  });

  it('hands invariants a deep-frozen world: state cannot be mutated', () => {
    let captured: WorldView<Bag> | null = null;
    simulate({
      seed: 1,
      nodes: 1,
      process: Ticker,
      until: { steps: 1 },
      invariants: [
        {
          name: 'capture',
          check: (world) => {
            captured = world;
            return null;
          },
        },
      ],
    });
    const world = captured as unknown as WorldView<Bag>;
    const state = world.nodes[0]?.state as Bag;
    expect(() => {
      state['ticks'] = 99;
    }).toThrow(TypeError);
    expect(() => {
      (world.nodes as unknown[]).push({});
    }).toThrow(TypeError);
    expect(Object.isFrozen(world.trace[0])).toBe(true);
  });

  it('exposes crashed nodes with state null and the trace so far', () => {
    const seen: { crashed: boolean; state: Bag | null; traceLength: number }[] = [];
    simulate({
      seed: 1,
      nodes: 2,
      process: CrashingTicker,
      until: { simTime: 100 },
      invariants: [
        {
          name: 'watch-node-1',
          check: (world) => {
            const n1 = world.nodes[0];
            if (n1?.crashed) {
              if (seen.length === 0) seen.push({ crashed: true, state: n1.state, traceLength: world.trace.length });
            }
            return null;
          },
        },
      ],
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.crashed).toBe(true);
    expect(seen[0]?.state).toBeNull();
    expect(seen[0]?.traceLength).toBeGreaterThan(5);
  });

  it('rejects a non-positive every', () => {
    expect(() =>
      simulate({
        seed: 1,
        nodes: 1,
        process: Ticker,
        until: { steps: 1 },
        invariants: [{ name: 'bad', every: 0, check: () => null }],
      }),
    ).toThrow(/every/);
  });
});

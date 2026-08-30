import { describe, expect, it } from 'vitest';
import { simulate } from '../src/simulate';
import type { Ctx, Process } from '../src/types';

// ctx.randomInt(min, max): an integer in [min, max], from exactly one draw of
// the node's PRNG, mapped as min + floor(r * (max - min + 1)). The mapping is
// the one protocol authors were writing by hand, so a protocol that switches
// to randomInt produces a byte-identical trace.

type Bag = Record<string, unknown>;

function drawer(draw: (ctx: Ctx<Bag>) => number, count: number): new () => Process<Bag> {
  return class implements Process<Bag> {
    init(ctx: Ctx<Bag>): Bag {
      const values: number[] = [];
      for (let i = 0; i < count; i++) values.push(draw(ctx));
      return { values };
    }
    onMessage(): void {}
    onTimer(): void {}
  };
}

function valuesOf(run: ReturnType<typeof simulate>): number[] {
  const patch = (run.trace.find((e) => (e as { kind: string }).kind === 'state') as unknown as { patch: { values: number[] } }).patch;
  return patch.values;
}

describe('ctx.randomInt', () => {
  it('stays within the inclusive range and reaches both ends', () => {
    const run = simulate({ seed: 7, nodes: 1, process: drawer((ctx) => ctx.randomInt(3, 6), 2000), until: {} });
    const values = valuesOf(run);
    expect(Math.min(...values)).toBe(3);
    expect(Math.max(...values)).toBe(6);
    expect(new Set(values).size).toBe(4);
  });

  it('is one draw, mapped exactly as min + floor(random() * (max - min + 1))', () => {
    const byHand = simulate({
      seed: 0xc0ffee,
      nodes: 3,
      process: drawer((ctx) => 10 + Math.floor(ctx.random() * 21), 500),
      until: {},
    });
    const withRandomInt = simulate({
      seed: 0xc0ffee,
      nodes: 3,
      process: drawer((ctx) => ctx.randomInt(10, 30), 500),
      until: {},
    });
    expect(withRandomInt.jsonl).toBe(byHand.jsonl);
  });

  it('handles a degenerate range and negative bounds', () => {
    const run = simulate({ seed: 1, nodes: 1, process: drawer((ctx) => ctx.randomInt(-2, -2) + ctx.randomInt(-5, -3), 50), until: {} });
    for (const v of valuesOf(run)) {
      expect(v).toBeGreaterThanOrEqual(-7);
      expect(v).toBeLessThanOrEqual(-5);
    }
  });

  it('rejects non-integers and an inverted range loudly', () => {
    expect(() => simulate({ seed: 1, nodes: 1, process: drawer((ctx) => ctx.randomInt(1.5, 3), 1), until: {} })).toThrow(/randomInt/);
    expect(() => simulate({ seed: 1, nodes: 1, process: drawer((ctx) => ctx.randomInt(5, 3), 1), until: {} })).toThrow(/randomInt/);
  });
});

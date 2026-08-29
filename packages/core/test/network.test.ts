import { describe, expect, it } from 'vitest';
import { DefaultNetwork } from '../src/network';
import { Pcg32 } from '../src/pcg32';

const MSG = { from: 1, to: 2, msgId: 0 };

describe('DefaultNetwork', () => {
  it('with the default config draws nothing and delivers immediately', () => {
    const net = new DefaultNetwork({}, 2);
    const rng = new Pcg32(1n, 1n);
    const twin = new Pcg32(1n, 1n);
    for (let i = 0; i < 100; i++) {
      expect(net.route(MSG, rng, 500)).toEqual({
        kind: 'deliver',
        deliveries: [{ at: 500, dup: false }],
      });
    }
    // Not a single draw was consumed.
    expect(rng.nextUint32()).toBe(twin.nextUint32());
  });

  it('draws uniform integer latency within [min, max] inclusive', () => {
    const net = new DefaultNetwork({ latency: [10, 13] }, 2);
    const rng = new Pcg32(2n, 2n);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const r = net.route(MSG, rng, 100);
      if (r.kind !== 'deliver') throw new Error('unexpected drop');
      const at = r.deliveries[0]?.at as number;
      expect(at).toBeGreaterThanOrEqual(110);
      expect(at).toBeLessThanOrEqual(113);
      seen.add(at);
    }
    expect([...seen].length).toBe(4); // every value in range is reachable
  });

  it('drops with reason loss at the configured rate', () => {
    const always = new DefaultNetwork({ dropRate: 1 }, 2);
    expect(always.route(MSG, new Pcg32(3n, 3n), 0)).toEqual({ kind: 'drop', reason: 'loss' });

    const half = new DefaultNetwork({ dropRate: 0.5 }, 2);
    const rng = new Pcg32(4n, 4n);
    let drops = 0;
    for (let i = 0; i < 4000; i++) if (half.route(MSG, rng, 0).kind === 'drop') drops++;
    expect(drops).toBeGreaterThan(1800);
    expect(drops).toBeLessThan(2200);
  });

  it('duplicates as a second delivery marked dup', () => {
    const net = new DefaultNetwork({ duplicateRate: 1, latency: [1, 5] }, 2);
    const r = net.route(MSG, new Pcg32(5n, 5n), 100);
    if (r.kind !== 'deliver') throw new Error('unexpected drop');
    expect(r.deliveries).toHaveLength(2);
    expect(r.deliveries[0]?.dup).toBe(false);
    expect(r.deliveries[1]?.dup).toBe(true);
    for (const d of r.deliveries) {
      expect(d.at).toBeGreaterThanOrEqual(101);
      expect(d.at).toBeLessThanOrEqual(105);
    }
  });

  it('draws in a fixed order: drop, duplicate, then one latency per delivery', () => {
    const net = new DefaultNetwork({ dropRate: 0.5, duplicateRate: 0.5, latency: [0, 9] }, 2);
    const rng = new Pcg32(6n, 6n);
    const twin = new Pcg32(6n, 6n);
    for (let i = 0; i < 200; i++) {
      // Predict the outcome from the twin stream, in the documented order.
      const dropDraw = twin.random();
      if (dropDraw < 0.5) {
        expect(net.route(MSG, rng, 0)).toEqual({ kind: 'drop', reason: 'loss' });
        continue;
      }
      const dup = twin.random() < 0.5;
      const first = Math.floor(twin.random() * 10);
      const expected = [{ at: first, dup: false }];
      if (dup) expected.push({ at: Math.floor(twin.random() * 10), dup: true });
      expect(net.route(MSG, rng, 0)).toEqual({ kind: 'deliver', deliveries: expected });
    }
  });

  it('rejects malformed configuration loudly', () => {
    expect(() => new DefaultNetwork({ latency: [5, 2] }, 2)).toThrow(/latency/);
    expect(() => new DefaultNetwork({ latency: [-1, 2] }, 2)).toThrow(/latency/);
    expect(() => new DefaultNetwork({ latency: [1.5, 2] }, 2)).toThrow(/latency/);
    expect(() => new DefaultNetwork({ dropRate: 1.2 }, 2)).toThrow(/dropRate/);
    expect(() => new DefaultNetwork({ duplicateRate: -0.1 }, 2)).toThrow(/duplicateRate/);
    expect(() => new DefaultNetwork({ dropRate: Number.NaN }, 2)).toThrow(/dropRate/);
  });
});

describe('DefaultNetwork partitions', () => {
  const groups = [[1, 2], [3]];

  it('drops across the boundary while active, delivers within a group, and heals', () => {
    const net = new DefaultNetwork({ partitions: [{ groups, start: 10, end: 20 }] }, 3);
    const rng = new Pcg32(1n, 1n);
    const twin = new Pcg32(1n, 1n);
    const across = { from: 1, to: 3, msgId: 0 };
    const within = { from: 1, to: 2, msgId: 1 };
    expect(net.route(across, rng, 5).kind).toBe('deliver');
    net.startPartition(0);
    expect(net.route(across, rng, 15)).toEqual({ kind: 'drop', reason: 'partition' });
    expect(net.route(within, rng, 15).kind).toBe('deliver');
    net.endPartition();
    expect(net.route(across, rng, 25).kind).toBe('deliver');
    // Partition decisions consume no randomness.
    expect(rng.nextUint32()).toBe(twin.nextUint32());
  });

  it('rejects malformed partitions loudly', () => {
    const bad = (partitions: unknown, nodes = 3) =>
      () => new DefaultNetwork({ partitions: partitions as never }, nodes);
    expect(bad([{ groups: [[1, 2], [2, 3]], start: 0, end: 1 }])).toThrow(/two groups/);
    expect(bad([{ groups: [[1, 2]], start: 0, end: 1 }])).toThrow(/node 3 is in no group/);
    expect(bad([{ groups: [[1, 2], [3, 4]], start: 0, end: 1 }])).toThrow(/node 4 does not exist/);
    expect(bad([{ groups, start: 5, end: 5 }])).toThrow(/start < end/);
    expect(
      bad([
        { groups, start: 0, end: 10 },
        { groups, start: 5, end: 15 },
      ]),
    ).toThrow(/overlap/);
    // Adjacent windows are fine.
    expect(
      bad([
        { groups, start: 0, end: 10 },
        { groups, start: 10, end: 15 },
      ]),
    ).not.toThrow();
  });
});

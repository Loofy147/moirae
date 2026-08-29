// DefaultNetwork, transcribed from SPEC §6. It is the only network model, so
// it is a concrete class rather than the interface SPEC sketches (CLAUDE.md:
// one implementation means a concrete type); route() has exactly the §6
// shape, with one deviation: a drop carries its reason, because the trace
// (§5) records why a message was lost.
//
// Randomness comes from a dedicated network PRNG stream owned by the engine,
// drawn in a fixed order per send: drop, then duplicate, then one latency per
// delivery. That order is part of the byte format. A partition drop is decided
// before any draw and consumes none. With the default config nothing is drawn
// at all and delivery is immediate — the Phase 1 path.

import type { Pcg32 } from './pcg32';
import type { NodeId, SimTime } from './types';

// A hard partition: disjoint groups covering every node, active for
// start <= t < end. Whether a message crosses a boundary is decided at send
// time (SPEC §6: dropped, not delayed).
export interface Partition {
  readonly groups: readonly (readonly NodeId[])[];
  readonly start: SimTime;
  readonly end: SimTime;
}

export interface NetworkConfig {
  readonly latency?: readonly [min: number, max: number]; // integer ms, inclusive, uniform
  readonly dropRate?: number; // probability in [0, 1]
  readonly duplicateRate?: number; // probability in [0, 1]
  readonly partitions?: readonly Partition[]; // must not overlap in time
}

export interface InFlight {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly msgId: number;
}

export interface Delivery {
  readonly at: SimTime;
  readonly dup: boolean; // true for the extra copy of a duplicated message
}

export type Routing =
  | { readonly kind: 'drop'; readonly reason: 'loss' | 'partition' }
  | { readonly kind: 'deliver'; readonly deliveries: readonly Delivery[] };

export class DefaultNetwork {
  readonly partitions: readonly Partition[];
  private readonly minLatency: number;
  private readonly maxLatency: number;
  private readonly dropRate: number;
  private readonly duplicateRate: number;
  private group: Map<NodeId, number> | null = null; // node -> group index while partitioned; lookup only

  constructor(config: NetworkConfig, nodes: number) {
    const [min, max] = config.latency ?? [0, 0];
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      throw new Error(
        `network.latency must be integer [min, max] with 0 <= min <= max, got [${min}, ${max}]`,
      );
    }
    this.minLatency = min;
    this.maxLatency = max;
    this.dropRate = rate('dropRate', config.dropRate);
    this.duplicateRate = rate('duplicateRate', config.duplicateRate);
    this.partitions = config.partitions ?? [];
    this.partitions.forEach((p, i) => validatePartition(p, i, nodes));
    for (let i = 0; i < this.partitions.length; i++) {
      for (let j = i + 1; j < this.partitions.length; j++) {
        const a = this.partitions[i] as Partition;
        const b = this.partitions[j] as Partition;
        if (a.start < b.end && b.start < a.end) {
          throw new Error(`network.partitions[${i}] and [${j}] overlap in time`);
        }
      }
    }
  }

  startPartition(index: number): void {
    const p = this.partitions[index];
    if (p === undefined) throw new Error(`no such partition: ${index}`);
    const group = new Map<NodeId, number>();
    p.groups.forEach((members, g) => {
      for (const node of members) group.set(node, g);
    });
    this.group = group;
  }

  endPartition(): void {
    this.group = null;
  }

  // Called once per send (SPEC §6).
  route(msg: InFlight, rng: Pcg32, now: SimTime): Routing {
    if (this.group !== null && this.group.get(msg.from) !== this.group.get(msg.to)) {
      return { kind: 'drop', reason: 'partition' };
    }
    if (this.dropRate > 0 && rng.random() < this.dropRate) {
      return { kind: 'drop', reason: 'loss' };
    }
    const dup = this.duplicateRate > 0 && rng.random() < this.duplicateRate;
    const deliveries: Delivery[] = [{ at: now + this.delay(rng), dup: false }];
    if (dup) deliveries.push({ at: now + this.delay(rng), dup: true });
    return { kind: 'deliver', deliveries };
  }

  private delay(rng: Pcg32): number {
    if (this.minLatency === this.maxLatency) return this.minLatency; // no draw
    return this.minLatency + Math.floor(rng.random() * (this.maxLatency - this.minLatency + 1));
  }
}

function rate(name: string, value: number | undefined): number {
  const v = value ?? 0;
  if (!(v >= 0 && v <= 1)) {
    throw new Error(`network.${name} must be a probability in [0, 1], got ${value}`);
  }
  return v;
}

function validatePartition(p: Partition, index: number, nodes: number): void {
  const where = `network.partitions[${index}]`;
  if (!(p.start >= 0) || !(p.end > p.start)) {
    throw new Error(`${where}: need 0 <= start < end, got start=${p.start} end=${p.end}`);
  }
  const seen = new Set<NodeId>(); // membership only, never iterated
  for (const members of p.groups) {
    for (const node of members) {
      if (!Number.isInteger(node) || node < 1 || node > nodes) {
        throw new Error(`${where}: node ${node} does not exist`);
      }
      if (seen.has(node)) throw new Error(`${where}: node ${node} appears in two groups`);
      seen.add(node);
    }
  }
  for (let node = 1; node <= nodes; node++) {
    if (!seen.has(node)) throw new Error(`${where}: node ${node} is in no group`);
  }
}

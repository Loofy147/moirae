// DefaultNetwork, transcribed from SPEC §6. It is the only network model, so
// it is a concrete class rather than the interface SPEC sketches (CLAUDE.md:
// one implementation means a concrete type); route() has exactly the §6
// shape, with one deviation: a drop carries its reason, because the trace
// (§5) records why a message was lost.
//
// Randomness comes from a dedicated network PRNG stream owned by the engine,
// drawn in a fixed order per send: drop, then duplicate, then one latency per
// delivery. That order is part of the byte format. With the default config
// nothing is drawn at all and delivery is immediate — the Phase 1 path.

import type { Pcg32 } from './pcg32';
import type { NodeId, SimTime } from './types';

export interface NetworkConfig {
  readonly latency?: readonly [min: number, max: number]; // integer ms, inclusive, uniform
  readonly dropRate?: number; // probability in [0, 1]
  readonly duplicateRate?: number; // probability in [0, 1]
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
  | { readonly kind: 'drop'; readonly reason: 'loss' }
  | { readonly kind: 'deliver'; readonly deliveries: readonly Delivery[] };

export class DefaultNetwork {
  private readonly minLatency: number;
  private readonly maxLatency: number;
  private readonly dropRate: number;
  private readonly duplicateRate: number;

  constructor(config: NetworkConfig) {
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
  }

  // Called once per send (SPEC §6).
  route(msg: InFlight, rng: Pcg32, now: SimTime): Routing {
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

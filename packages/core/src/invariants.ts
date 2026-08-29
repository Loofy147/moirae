// Invariants, transcribed from SPEC §7. An invariant sees a deep-frozen
// snapshot of the world after a step and returns null (holds) or a detail
// string (violated). The first violation ends the simulation.

import type { TraceEvent } from './trace';
import type { NodeId, SimTime } from './types';

export interface WorldNode<S> {
  readonly id: NodeId;
  readonly crashed: boolean;
  readonly state: S | null; // null while crashed
}

export interface WorldView<S> {
  readonly time: SimTime;
  readonly step: number;
  readonly nodes: readonly WorldNode<S>[]; // ascending by id
  // The event history so far. Shared with the engine for O(1) access; the
  // elements are frozen, the array is typed read-only — do not mutate it.
  readonly trace: readonly TraceEvent[];
}

export interface Invariant<S> {
  readonly name: string;
  readonly every?: number; // check every n steps; default 1
  check(world: WorldView<S>): string | null;
}

export interface Violation {
  readonly invariant: string;
  readonly detail: string;
  readonly step: number;
  readonly time: SimTime;
}

// The trace schema, transcribed from SPEC §5. This file is the contract
// between the engine and every consumer (ADR-003): the studio imports these
// types and nothing else from the engine. Field order in the emitting literals
// is the serialization order — keep it stable, it is part of the byte format.

import type { NetworkConfig } from './network';
import type { Message, NodeId, SimTime } from './types';

export interface TraceHeader {
  kind: 'header';
  v: 1; // trace format version (ADR-003: versioned from day one)
  seed: number;
  nodes: number;
  network?: NetworkConfig; // present only when a network was configured; absent = default network
}

export interface InitEvent {
  t: SimTime;
  seq: number;
  kind: 'init';
  node: NodeId;
}

export interface SendEvent {
  t: SimTime;
  seq: number;
  kind: 'send';
  from: NodeId;
  to: NodeId;
  msgId: number;
  msg: Message;
}

export interface DeliverEvent {
  t: SimTime;
  seq: number;
  kind: 'deliver';
  msgId: number;
  dup?: true; // the extra copy of a duplicated message; absent on the original delivery
}

export interface DropEvent {
  t: SimTime;
  seq: number;
  kind: 'drop';
  msgId: number;
  reason: string;
}

// patch: changed top-level state fields; a field deleted from the state
// appears as null. The viewer reconstructs state by folding patches.
export interface StateEvent {
  t: SimTime;
  seq: number;
  kind: 'state';
  node: NodeId;
  patch: Record<string, unknown>;
}

export interface TimerEvent {
  t: SimTime;
  seq: number;
  kind: 'timer';
  node: NodeId;
  name: string;
}

export interface LogEvent {
  t: SimTime;
  seq: number;
  kind: 'log';
  node: NodeId;
  event: string;
  data?: Record<string, unknown>;
}

export interface FaultEvent {
  t: SimTime;
  seq: number;
  kind: 'fault';
  fault: string;
  node?: NodeId;
  groups?: NodeId[][];
}

export interface ViolationEvent {
  t: SimTime;
  seq: number;
  kind: 'violation';
  invariant: string;
  detail: string;
}

export type TraceEvent =
  | TraceHeader
  | InitEvent
  | SendEvent
  | DeliverEvent
  | DropEvent
  | StateEvent
  | TimerEvent
  | LogEvent
  | FaultEvent
  | ViolationEvent;

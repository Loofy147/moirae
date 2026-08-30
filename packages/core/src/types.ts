// The protocol author's entire world, transcribed from SPEC §3. A process may
// only observe the simulation through Ctx — time via now(), randomness via
// random(), scheduling via setTimer(). There is no other supported way.

export type NodeId = number; // 1-based, 1..nodes (SPEC §5 examples)
export type SimTime = number; // logical milliseconds since t=0

// Messages must be JSON-serializable data: they are copied by JSON round-trip
// at send time and written verbatim into the trace.
export interface Message {
  type: string;
  [field: string]: unknown;
}

export interface Ctx<S> {
  readonly me: NodeId;
  readonly peers: readonly NodeId[];
  state: S;

  now(): SimTime; // logical clock, never wall clock
  random(): number; // [0,1), from the per-node seeded PRNG
  randomInt(min: number, max: number): number; // integer in [min, max]; one draw of random()

  send(to: NodeId, msg: Message): void;
  broadcast(msg: Message): void;

  setTimer(name: string, delayMs: number): void; // replaces an existing timer of the same name
  cancelTimer(name: string): void;

  log(event: string, data?: Record<string, unknown>): void;
  crash(): void; // self-crash; state is lost unless marked persistent
}

export interface Process<S> {
  // Top-level state fields that survive a crash (SPEC §3). Everything else is
  // lost. The snapshot is taken at the crash event; intra-handler write
  // ordering is not modelled — see the limitation recorded in SPEC §3.
  readonly persistent?: readonly (keyof S)[];
  init(ctx: Ctx<S>): S;
  onMessage(ctx: Ctx<S>, from: NodeId, msg: Message): void;
  onTimer(ctx: Ctx<S>, name: string): void;
  // Called on restart after init(), with the persisted fields already
  // overlaid onto the fresh state.
  onRestart?(ctx: Ctx<S>, persisted: Partial<S>): void;
}

// The scheduler (SPEC §4): a single-threaded loop over a priority queue of
// events totally ordered by (time, seq). One step = pop one event, dispatch
// it, append the resulting effects to the queue. Determinism is the entire
// point: every ordering decision goes through the queue's explicit
// comparator, every random draw through a per-node seeded PRNG, and the
// trace is serialized at emission time so later mutation cannot reach it.

import { EventQueue } from './event-queue';
import { fnv1a64String } from './hash';
import { Pcg32 } from './pcg32';
import type { TraceEvent } from './trace';
import type { Ctx, Message, NodeId, Process, SimTime } from './types';

interface DeliverEv {
  kind: 'deliver';
  to: NodeId;
  from: NodeId;
  msgId: number;
  msg: Message;
}

interface TimerEv {
  kind: 'timer';
  node: NodeId;
  name: string;
  gen: number;
}

type EngineEvent = DeliverEv | TimerEv;

export interface SimulateOptions<S extends Record<string, unknown>> {
  seed: number;
  nodes: number;
  process: new () => Process<S>;
  // The loop also terminates when the queue is empty.
  until: { simTime?: SimTime; steps?: number };
}

export interface SimulationResult {
  readonly trace: readonly TraceEvent[];
  readonly jsonl: string;
  readonly steps: number;
  readonly time: SimTime;
}

interface NodeRuntime<S> {
  readonly id: NodeId;
  readonly proc: Process<S>;
  readonly prng: Pcg32;
  readonly timers: Map<string, number>; // timer name -> live generation; lookup only, never iterated
  ctx: Ctx<S>;
  state: S;
  crashed: boolean;
}

export function simulate<S extends Record<string, unknown>>(
  opts: SimulateOptions<S>,
): SimulationResult {
  const nodeCount = opts.nodes;
  const lines: string[] = [];
  const queue = new EventQueue<EngineEvent>();
  let now: SimTime = 0;
  let traceSeq = 0;
  let nextMsgId = 0;
  let nextTimerGen = 0;
  let steps = 0;

  // Serialize immediately: a trace line captures values as they were at
  // emission, so a protocol mutating its state or a sent message afterwards
  // cannot rewrite history. Field order in these literals is the byte format.
  const emit = (event: TraceEvent): void => {
    lines.push(JSON.stringify(event));
  };

  emit({ kind: 'header', v: 1, seed: opts.seed, nodes: nodeCount });

  const runtimes: NodeRuntime<S>[] = [];
  const byId = (id: NodeId): NodeRuntime<S> => {
    const rt = runtimes[id - 1];
    if (rt === undefined) throw new Error(`no such node: ${id}`);
    return rt;
  };

  const send = (rt: NodeRuntime<S>, to: NodeId, msg: Message): void => {
    if (rt.crashed) return; // a crashed node sends nothing
    if (!Number.isInteger(to) || to < 1 || to > nodeCount) {
      throw new Error(`node ${rt.id} sent to nonexistent node ${to}`);
    }
    // Copy so the in-flight message is isolated from later sender mutation.
    const copy = JSON.parse(JSON.stringify(msg)) as Message;
    const msgId = nextMsgId++;
    emit({ t: now, seq: traceSeq++, kind: 'send', from: rt.id, to, msgId, msg: copy });
    // Phase 1 delivery: same simTime, ordered after the current event by seq.
    // Latency, drops and partitions arrive with the network model (Phase 2).
    queue.insert(now, { kind: 'deliver', to, from: rt.id, msgId, msg: copy });
  };

  // Per-key JSON snapshot of the state, so nested mutation is visible in the
  // diff. Object.keys and Map iteration are safe here: the state object is
  // built by deterministic protocol code, so its key insertion order is
  // itself deterministic.
  const snapshot = (state: Record<string, unknown> | undefined): Map<string, string> => {
    const snap = new Map<string, string>();
    if (state !== undefined) {
      for (const key of Object.keys(state)) {
        snap.set(key, JSON.stringify(state[key]) ?? 'undefined');
      }
    }
    return snap;
  };

  const emitStatePatch = (rt: NodeRuntime<S>, before: Map<string, string>): void => {
    const state = rt.state as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let changed = false;
    // Deleted fields first (as null), in pre-handler key order.
    for (const key of before.keys()) {
      if (!(key in state)) {
        patch[key] = null;
        changed = true;
      }
    }
    for (const key of Object.keys(state)) {
      const serialized = JSON.stringify(state[key]) ?? 'undefined';
      if (before.get(key) !== serialized) {
        patch[key] = state[key];
        changed = true;
      }
    }
    if (changed) {
      emit({ t: now, seq: traceSeq++, kind: 'state', node: rt.id, patch });
    }
  };

  for (let id = 1; id <= nodeCount; id++) {
    const peers: NodeId[] = [];
    for (let p = 1; p <= nodeCount; p++) {
      if (p !== id) peers.push(p);
    }
    const rt: NodeRuntime<S> = {
      id,
      proc: new opts.process(),
      // SPEC §4: per-node streams derived from the root seed, so adding a
      // node does not reshuffle the streams of existing nodes.
      prng: new Pcg32(fnv1a64String(`${opts.seed}/${id}`), BigInt(id)),
      timers: new Map(),
      ctx: undefined as unknown as Ctx<S>,
      state: undefined as unknown as S,
      crashed: false,
    };
    rt.ctx = {
      me: id,
      peers,
      get state(): S {
        return rt.state;
      },
      set state(s: S) {
        rt.state = s;
      },
      now: () => now,
      random: () => rt.prng.random(),
      send: (to, msg) => {
        send(rt, to, msg);
      },
      broadcast: (msg) => {
        for (const p of peers) send(rt, p, msg);
      },
      setTimer: (name, delayMs) => {
        if (!Number.isFinite(delayMs) || delayMs < 0) {
          throw new Error(`node ${id} set timer '${name}' with invalid delay ${delayMs}`);
        }
        const gen = ++nextTimerGen;
        rt.timers.set(name, gen); // replaces any live timer of the same name
        queue.insert(now + delayMs, { kind: 'timer', node: id, name, gen });
      },
      cancelTimer: (name) => {
        rt.timers.delete(name);
      },
      log: (event, data) => {
        emit(
          data === undefined
            ? { t: now, seq: traceSeq++, kind: 'log', node: id, event }
            : { t: now, seq: traceSeq++, kind: 'log', node: id, event, data },
        );
      },
      crash: () => {
        if (!rt.crashed) {
          rt.crashed = true;
          emit({ t: now, seq: traceSeq++, kind: 'fault', fault: 'crash', node: id });
        }
      },
    };
    runtimes.push(rt);
  }

  for (const rt of runtimes) {
    emit({ t: 0, seq: traceSeq++, kind: 'init', node: rt.id });
    const before = snapshot(undefined);
    rt.state = rt.proc.init(rt.ctx);
    emitStatePatch(rt, before);
  }

  const untilTime = opts.until.simTime ?? Infinity;
  const untilSteps = opts.until.steps ?? Infinity;
  while (steps < untilSteps) {
    const next = queue.pop();
    if (next === undefined) break;
    if (next.time > untilTime) {
      now = untilTime;
      break;
    }
    now = next.time;
    steps++;
    const ev = next.event;
    if (ev.kind === 'deliver') {
      const rt = byId(ev.to);
      if (rt.crashed) {
        emit({ t: now, seq: traceSeq++, kind: 'drop', msgId: ev.msgId, reason: 'crashed' });
      } else {
        emit({ t: now, seq: traceSeq++, kind: 'deliver', msgId: ev.msgId });
        const before = snapshot(rt.state);
        rt.proc.onMessage(rt.ctx, ev.from, ev.msg);
        emitStatePatch(rt, before);
      }
    } else {
      const rt = byId(ev.node);
      // A stale generation means the timer was replaced or cancelled; a
      // crashed node's timers never fire. Either way: silently discarded.
      if (!rt.crashed && rt.timers.get(ev.name) === ev.gen) {
        rt.timers.delete(ev.name); // timers are one-shot
        emit({ t: now, seq: traceSeq++, kind: 'timer', node: rt.id, name: ev.name });
        const before = snapshot(rt.state);
        rt.proc.onTimer(rt.ctx, ev.name);
        emitStatePatch(rt, before);
      }
    }
  }

  const jsonl = lines.join('\n') + '\n';
  return {
    trace: lines.map((line) => JSON.parse(line) as TraceEvent),
    jsonl,
    steps,
    time: now,
  };
}

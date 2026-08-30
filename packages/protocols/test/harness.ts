// A scripted Ctx for protocol unit tests. Deliberately thin: it records sends,
// timer calls and log calls, and fires timers or delivers messages only when a
// test says so. It implements NO engine semantics — no clock, no ordering, no
// timer replacement, no crash/restart, no persistence. Anything needing those
// is a simulate() scenario, not a harness test. `random` is a test input, not
// a PRNG.

import type { Ctx, Message, NodeId, Process } from 'moirae-core';

export interface Sent {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly msg: Message;
}

export interface TimerCall {
  readonly node: NodeId;
  readonly op: 'set' | 'cancel';
  readonly name: string;
  readonly delay?: number;
}

export class Harness<S extends Record<string, unknown>> {
  readonly outbox: Sent[] = []; // sent, not yet delivered
  readonly timerCalls: TimerCall[] = [];
  readonly logCalls: { node: NodeId; event: string; data?: Record<string, unknown> }[] = [];
  random: () => number = () => 0.5;
  private readonly states: S[] = [];
  private readonly procs: Process<S>[] = [];
  private readonly ctxs: Ctx<S>[] = [];

  constructor(
    readonly nodes: number,
    factory: new () => Process<S>,
  ) {
    for (let id = 1; id <= nodes; id++) {
      this.procs.push(new factory());
      this.ctxs.push(this.makeCtx(id));
    }
    for (let id = 1; id <= nodes; id++) {
      this.states[id - 1] = this.proc(id).init(this.ctx(id));
    }
  }

  state(id: NodeId): S {
    return this.states[id - 1] as S;
  }

  proc(id: NodeId): Process<S> {
    return this.procs[id - 1] as Process<S>;
  }

  ctx(id: NodeId): Ctx<S> {
    return this.ctxs[id - 1] as Ctx<S>;
  }

  fire(id: NodeId, name: string): void {
    this.proc(id).onTimer(this.ctx(id), name);
  }

  // Deliver the pending message at `index` (FIFO by default). Which message
  // goes when is entirely the test's choice — that is what makes reordering
  // scriptable.
  deliver(index = 0): Sent {
    const sent = this.outbox.splice(index, 1)[0];
    if (sent === undefined) throw new Error(`harness: no pending message at ${index}`);
    this.proc(sent.to).onMessage(this.ctx(sent.to), sent.from, sent.msg);
    return sent;
  }

  // Deliver a copy of a pending message without consuming it.
  duplicate(index: number): Sent {
    const sent = this.outbox[index];
    if (sent === undefined) throw new Error(`harness: no pending message at ${index}`);
    const copy = JSON.parse(JSON.stringify(sent.msg)) as Message;
    this.proc(sent.to).onMessage(this.ctx(sent.to), sent.from, copy);
    return sent;
  }

  drop(index = 0): Sent {
    const sent = this.outbox.splice(index, 1)[0];
    if (sent === undefined) throw new Error(`harness: no pending message at ${index}`);
    return sent;
  }

  deliverAll(): void {
    while (this.outbox.length > 0) this.deliver(0);
  }

  // Deliver every pending message matching `pred`, drop the rest.
  deliverOnly(pred: (s: Sent) => boolean): void {
    const pending = this.outbox.splice(0, this.outbox.length);
    for (const s of pending) {
      if (pred(s)) this.proc(s.to).onMessage(this.ctx(s.to), s.from, s.msg);
    }
  }

  timersOf(id: NodeId): TimerCall[] {
    return this.timerCalls.filter((t) => t.node === id);
  }

  private makeCtx(id: NodeId): Ctx<S> {
    const peers: NodeId[] = [];
    for (let p = 1; p <= this.nodes; p++) if (p !== id) peers.push(p);
    const { states, outbox, timerCalls, logCalls } = this;
    return {
      me: id,
      peers,
      get state(): S {
        return states[id - 1] as S;
      },
      set state(s: S) {
        states[id - 1] = s;
      },
      now: () => 0,
      random: () => this.random(),
      // The engine's mapping, so a controlled random() steers randomInt too.
      randomInt: (min, max) => min + Math.floor(this.random() * (max - min + 1)),
      send: (to, msg) => {
        outbox.push({ from: id, to, msg: JSON.parse(JSON.stringify(msg)) as Message });
      },
      broadcast: () => {
        throw new Error('harness: broadcast is not used by Raft; send per peer');
      },
      setTimer: (name, delay) => {
        timerCalls.push({ node: id, op: 'set', name, delay });
      },
      cancelTimer: (name) => {
        timerCalls.push({ node: id, op: 'cancel', name });
      },
      log: (event, data) => {
        logCalls.push(data === undefined ? { node: id, event } : { node: id, event, data });
      },
      crash: () => {
        throw new Error('harness: crash is engine behaviour; use a simulate() scenario');
      },
    };
  }
}

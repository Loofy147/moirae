import { describe, expect, it } from 'vitest';
import { EventQueue, type Scheduled } from '../src/event-queue';
import { Pcg32 } from '../src/pcg32';

describe('EventQueue', () => {
  it('pops in time order', () => {
    const q = new EventQueue<string>();
    q.insert(30, 'c');
    q.insert(10, 'a');
    q.insert(20, 'b');
    expect(q.pop()?.event).toBe('a');
    expect(q.pop()?.event).toBe('b');
    expect(q.pop()?.event).toBe('c');
    expect(q.pop()).toBeUndefined();
  });

  it('breaks time ties by insertion order — the seq tiebreaker', () => {
    const q = new EventQueue<string>();
    q.insert(5, 'first');
    q.insert(5, 'second');
    q.insert(5, 'third');
    expect(q.pop()?.event).toBe('first');
    expect(q.pop()?.event).toBe('second');
    expect(q.pop()?.event).toBe('third');
  });

  it('assigns seq monotonically across interleaved insert and pop', () => {
    const q = new EventQueue<number>();
    const a = q.insert(1, 0);
    q.pop();
    const b = q.insert(1, 1);
    expect(b.seq).toBeGreaterThan(a.seq);
  });

  it('peek returns the minimum without removing it', () => {
    const q = new EventQueue<string>();
    q.insert(2, 'later');
    q.insert(1, 'sooner');
    expect(q.peek()?.event).toBe('sooner');
    expect(q.size).toBe(2);
  });

  it('agrees with a linear-scan model over thousands of interleaved operations', () => {
    // Model: an array scanned for the (time, seq) minimum with the same
    // explicit comparator. No Array.sort — sort stability must never be
    // load-bearing anywhere, tests included.
    const q = new EventQueue<number>();
    const model: Scheduled<number>[] = [];
    const rng = new Pcg32(0xdecafn, 1n);
    let payload = 0;
    for (let op = 0; op < 5000; op++) {
      if (model.length === 0 || rng.random() < 0.6) {
        // Small time range to force many ties.
        const time = Math.floor(rng.random() * 20);
        const entry = q.insert(time, payload++);
        model.push(entry);
      } else {
        let min = 0;
        for (let i = 1; i < model.length; i++) {
          const m = model[i] as Scheduled<number>;
          const best = model[min] as Scheduled<number>;
          if (m.time < best.time || (m.time === best.time && m.seq < best.seq)) min = i;
        }
        const expected = model.splice(min, 1)[0] as Scheduled<number>;
        const actual = q.pop();
        expect(actual?.time).toBe(expected.time);
        expect(actual?.seq).toBe(expected.seq);
        expect(actual?.event).toBe(expected.event);
      }
    }
    while (model.length > 0) {
      let min = 0;
      for (let i = 1; i < model.length; i++) {
        const m = model[i] as Scheduled<number>;
        const best = model[min] as Scheduled<number>;
        if (m.time < best.time || (m.time === best.time && m.seq < best.seq)) min = i;
      }
      const expected = model.splice(min, 1)[0] as Scheduled<number>;
      expect(q.pop()?.seq).toBe(expected.seq);
    }
    expect(q.pop()).toBeUndefined();
  });
});

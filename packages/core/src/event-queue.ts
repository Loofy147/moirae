// The scheduler's priority queue. Ordering is total and explicit: (time, seq),
// where seq is a monotonic counter assigned here at insertion (SPEC §4). It is
// the tiebreaker that makes same-time ordering reproducible. Nothing is ever
// ordered by object identity, collection iteration order, or sort stability —
// the heap comparator below is the only ordering authority in the engine.

export interface Scheduled<T> {
  readonly time: number;
  readonly seq: number;
  readonly event: T;
}

function before<T>(a: Scheduled<T>, b: Scheduled<T>): boolean {
  return a.time < b.time || (a.time === b.time && a.seq < b.seq);
}

export class EventQueue<T> {
  private readonly heap: Scheduled<T>[] = [];
  private nextSeq = 0;

  get size(): number {
    return this.heap.length;
  }

  insert(time: number, event: T): Scheduled<T> {
    const entry: Scheduled<T> = { time, seq: this.nextSeq++, event };
    const heap = this.heap;
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(entry, heap[parent] as Scheduled<T>)) break;
      heap[i] = heap[parent] as Scheduled<T>;
      i = parent;
    }
    heap[i] = entry;
    return entry;
  }

  peek(): Scheduled<T> | undefined {
    return this.heap[0];
  }

  pop(): Scheduled<T> | undefined {
    const heap = this.heap;
    const top = heap[0];
    if (top === undefined) return undefined;
    const last = heap.pop() as Scheduled<T>;
    if (heap.length > 0) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        let candidate = last;
        if (left < heap.length && before(heap[left] as Scheduled<T>, candidate)) {
          smallest = left;
          candidate = heap[left] as Scheduled<T>;
        }
        if (right < heap.length && before(heap[right] as Scheduled<T>, candidate)) {
          smallest = right;
        }
        if (smallest === i) break;
        heap[i] = heap[smallest] as Scheduled<T>;
        i = smallest;
      }
      heap[i] = last;
    }
    return top;
  }
}

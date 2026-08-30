import { describe, expect, it } from 'vitest';
import { clean } from '@moira/examples';
import { deriveModel } from '../src/trace/model';
import { parseJsonl } from '../src/trace/parse';

// The gate, computed. The demo's whole claim is that a viewer can see the
// minority side of the partition fail to elect a leader. This pins that
// claim to the committed clean fixture: if a future engine or protocol
// change makes nodes 1 or 2 elect someone inside the band, the build fails
// rather than the GIF quietly becoming a lie. The studio's source runs no
// simulation; this test drives the example and hands the studio's pure
// model the resulting bytes, as a file would.

describe('the gate, on the clean-partition fixture', () => {
  const model = deriveModel(parseJsonl(clean.run().jsonl));
  const band = model.partitions[0];

  it('has exactly one partition window, [1,2] | [3,4,5]', () => {
    expect(model.partitions).toHaveLength(1);
    expect(band?.groups).toEqual([[1, 2], [3, 4, 5]]);
  });

  it('the trace satisfies the role and term conventions the lanes rely on', () => {
    expect(model.conventions).toEqual({ role: true, term: true });
  });

  it('nodes 1 and 2 never become leader inside the band', () => {
    for (const node of [1, 2]) {
      const inside = (model.roles.get(node) ?? []).filter(
        (r) => r.role === 'leader' && r.start >= (band?.start ?? 0) && r.start < (band?.end ?? 0),
      );
      expect(inside, `node ${node}`).toEqual([]);
    }
  });

  it('nodes 1 and 2 keep trying: candidate spells inside the band, none becoming leader', () => {
    const attempts = [1, 2].flatMap((node) =>
      (model.roles.get(node) ?? []).filter(
        (r) => r.role === 'candidate' && r.start >= (band?.start ?? 0) && r.start < (band?.end ?? 0),
      ),
    );
    expect(attempts.length).toBeGreaterThan(2);
  });

  it('the majority side has a leader the whole time — before, during and at the end of the band', () => {
    const start = band?.start ?? 0;
    const end = band?.end ?? 0;
    for (const t of [start - 1, start + (end - start) / 2, end - 1]) {
      const leaders = [3, 4, 5].filter((n) => model.stateAt(n, t)?.['role'] === 'leader');
      expect(leaders, `at t=${t}`).toHaveLength(1);
    }
    // ...and the minority has none at any of those moments.
    for (const t of [start + 1, start + (end - start) / 2, end - 1]) {
      const leaders = [1, 2].filter((n) => model.stateAt(n, t)?.['role'] === 'leader');
      expect(leaders, `at t=${t}`).toEqual([]);
    }
  });

  it('vote requests from the minority die at the wall', () => {
    const wallDrops = model.messages.filter(
      (m) =>
        m.drop?.reason === 'partition' &&
        m.send.msg.type === 'RequestVote' &&
        (m.send.from === 1 || m.send.from === 2) &&
        m.send.t >= (band?.start ?? 0) &&
        m.send.t < (band?.end ?? 0),
    );
    expect(wallDrops.length).toBeGreaterThan(5);
  });

  it('ends with one leader and every node alive', () => {
    const end = model.duration;
    const leaders = model.nodes.filter((n) => model.stateAt(n, end)?.['role'] === 'leader');
    expect(leaders).toHaveLength(1);
    expect(model.nodes.every((n) => model.stateAt(n, end) !== null)).toBe(true);
  });
});

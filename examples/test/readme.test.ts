import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { run } from '../src/ping';

// One skeleton, three places: examples/src/ping.ts is the file; the README's
// "Write a protocol" block and CONTRIBUTING's "A skeleton to copy" block are
// copies, byte for byte. Drift in any direction fails the build; regenerate
// the block from the file rather than editing a copy by hand.
function blockUnder(path: string, heading: string, occurrence = 0): string {
  const doc = readFileSync(path, 'utf8');
  const section = doc.indexOf(heading);
  expect(section, `${path} has no "${heading}"`).toBeGreaterThan(-1);
  let open = section;
  for (let i = 0; i <= occurrence; i++) open = doc.indexOf('```ts\n', open + 1);
  open += '```ts\n'.length;
  const close = doc.indexOf('```\n', open);
  return doc.slice(open, close);
}

it('the README protocol block is examples/src/ping.ts verbatim', () => {
  expect(blockUnder('README.md', '## Write a protocol')).toBe(readFileSync('examples/src/ping.ts', 'utf8'));
});

it('the CONTRIBUTING skeleton is examples/src/ping.ts verbatim', () => {
  // The section's first ts block is the Process interface; the skeleton is the second.
  expect(blockUnder('CONTRIBUTING.md', '## The interface, and a skeleton to copy', 1)).toBe(
    readFileSync('examples/src/ping.ts', 'utf8'),
  );
});

// The sample runs, and — the sibling of "nothing went wrong" — things happen:
// messages flow, the partition drops some, node 2 crashes and comes back.
it('the README protocol runs and exercises what it configures', () => {
  const r = run();
  expect(r.violation).toBeNull();
  const count = (pred: (e: Record<string, unknown>) => boolean) =>
    r.trace.filter((e) => pred(e as unknown as Record<string, unknown>)).length;
  expect(count((e) => e['kind'] === 'deliver')).toBeGreaterThan(50);
  expect(count((e) => e['kind'] === 'drop' && e['reason'] === 'partition')).toBeGreaterThan(0);
  expect(count((e) => e['fault'] === 'crash')).toBe(1);
  expect(count((e) => e['fault'] === 'restart')).toBe(1);
});

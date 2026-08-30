import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { run } from '../src/ping';

// The README's "Write a protocol" block is examples/src/ping.ts, byte for
// byte. Drift in either direction fails the build; regenerate the block from
// the file rather than editing the README by hand.
it('the README protocol block is examples/src/ping.ts verbatim', () => {
  const readme = readFileSync('README.md', 'utf8');
  const file = readFileSync('examples/src/ping.ts', 'utf8');
  const section = readme.indexOf('## Write a protocol');
  expect(section).toBeGreaterThan(-1);
  const open = readme.indexOf('```ts\n', section) + '```ts\n'.length;
  const close = readme.indexOf('```\n', open);
  expect(readme.slice(open, close)).toBe(file);
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

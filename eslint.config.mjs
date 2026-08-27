import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// ADR-002: ambient nondeterminism is banned in the engine and in protocols.
// Time comes from ctx.now(), randomness from ctx.random(), scheduling from
// ctx.setTimer(). There is no other way to get any of them, and inline
// eslint-disable comments are dead in these packages (noInlineConfig below).
const BAN =
  'is nondeterministic and banned in core/protocols (ADR-002). ' +
  'Use ctx.now() for time, ctx.random() for randomness, ctx.setTimer() for scheduling.';

const bannedGlobals = [
  // time
  'Date',
  'performance',
  'Intl',
  // scheduling
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  // randomness / environment
  'crypto',
  'process',
  'navigator',
  // IO / network
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  // concurrency and GC observation
  'Worker',
  'SharedWorker',
  'MessageChannel',
  'BroadcastChannel',
  'Atomics',
  'SharedArrayBuffer',
  'WeakRef',
  'FinalizationRegistry',
  // escape hatches to all of the above
  'globalThis',
  'window',
  'self',
  'global',
];

const bannedNodeImports = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', 'coverage/', 'out/'],
  },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ['packages/core/**/*.ts', 'packages/protocols/**/*.ts'],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-restricted-globals': [
        'error',
        ...bannedGlobals.map((name) => ({ name, message: `'${name}' ${BAN}` })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: `'Math.random' ${BAN}` },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: bannedNodeImports.map((name) => ({
            name,
            message: `Node builtin '${name}' ${BAN}`,
          })),
          patterns: [
            {
              group: ['node:*'],
              message: `This node builtin ${BAN}`,
            },
          ],
        },
      ],
    },
  },
);

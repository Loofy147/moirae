import { builtinModules } from 'node:module';
import tseslint from 'typescript-eslint';

// ADR-002: ambient nondeterminism is banned in the engine and in protocols.
// Time comes from ctx.now(), randomness from ctx.random(), scheduling from
// ctx.setTimer(). Inline eslint-disable comments are dead in these packages
// (noInlineConfig below). Lint is the first line of defence, not a proof:
// exotic indirection can still slip through, and review is the backstop —
// ADR-002 records the known limits.
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
  'Function',
];

const bannedNodeImports = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Methods whose output depends on the host locale, wherever they are called.
const localeMethods =
  '^(localeCompare|toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleLowerCase|toLocaleUpperCase)$';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', 'coverage/', 'out/'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.recommended],
  },
  {
    // ADR-003: the studio is a pure function of the trace file. It imports
    // the trace schema type from the engine and nothing else — never engine
    // code, never a protocol, never an example.
    files: ['apps/studio/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@moira/core',
              message:
                'ADR-003: the studio imports only the trace schema type from the engine — use `import type`.',
              allowTypeImports: true,
            },
            {
              name: '@moira/protocols',
              message: 'ADR-003: the studio is a pure function of the trace; it does not import protocols.',
            },
            {
              name: '@moira/examples',
              message: 'ADR-003: the studio does not run scenarios; it replays trace files.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'packages/core/**/*.{ts,tsx,mts,cts}',
      'packages/protocols/**/*.{ts,tsx,mts,cts}',
    ],
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
      // eval and Function are escape hatches to every banned global.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Any use of Math except plain `Math.method(...)` — aliasing
          // (`const m = Math`), computed access (`Math[k]`), or passing Math
          // around would put Math.random back in reach.
          selector: "Identifier[name='Math']:not(MemberExpression[computed=false] > .object)",
          message: `Aliasing or indirect access to 'Math' ${BAN}`,
        },
        {
          selector: "MemberExpression[object.name='Math'][computed=true]",
          message: `Computed access to 'Math' ${BAN}`,
        },
        {
          selector: `MemberExpression[computed=false][property.name=/${localeMethods}/]`,
          message: `This locale-dependent method ${BAN}`,
        },
        {
          selector: `MemberExpression[computed=true][property.value=/${localeMethods}/]`,
          message: `This locale-dependent method ${BAN}`,
        },
        {
          // no-restricted-imports only sees static declarations; a dynamic
          // import could reach node builtins. The engine's import graph is
          // static, so dynamic import has no legitimate use here at all.
          selector: 'ImportExpression',
          message: `Dynamic import() ${BAN} Use static imports.`,
        },
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

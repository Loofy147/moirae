import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// ADR-002 makes the lint ban load-bearing: if the config silently weakens, the
// project's reproducibility promise dies without a test failing. This suite is
// the test that fails. It lints in-memory fixtures at virtual paths inside the
// restricted packages, so no banned code ever exists on disk.

const CORE = 'packages/core/src/__lint_guard_fixture__.ts';
const PROTOCOLS = 'packages/protocols/src/__lint_guard_fixture__.ts';
const STUDIO = 'apps/studio/src/__lint_guard_fixture__.ts';

const eslint = new ESLint();

async function lint(filePath: string, code: string) {
  const results = await eslint.lintText(code, { filePath });
  return results[0]?.messages ?? [];
}

function rulesIn(messages: { ruleId: string | null }[]): (string | null)[] {
  return messages.map((m) => m.ruleId);
}

describe('the nondeterminism ban (ADR-002)', () => {
  it('flags Date in core', async () => {
    const messages = await lint(CORE, 'export const t = Date.now();\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });

  it('flags Date in protocols', async () => {
    const messages = await lint(PROTOCOLS, 'export const t = Date.now();\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });

  it('flags Math.random in core', async () => {
    const messages = await lint(CORE, 'export const r = Math.random();\n');
    expect(rulesIn(messages)).toContain('no-restricted-properties');
  });

  it('flags setTimeout in core', async () => {
    const messages = await lint(CORE, 'export const h = setTimeout(() => undefined, 10);\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });

  it('flags crypto in core', async () => {
    const messages = await lint(CORE, 'export const id = crypto.randomUUID();\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });

  it('flags globalThis, the escape hatch to everything else', async () => {
    const messages = await lint(CORE, 'export const d = globalThis.Date;\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });

  it('flags Date in .mts and .tsx files too — the ban is not tied to one extension', async () => {
    const mts = await lint(CORE.replace(/\.ts$/, '.mts'), 'export const t = Date.now();\n');
    const tsx = await lint(CORE.replace(/\.ts$/, '.tsx'), 'export const t = Date.now();\n');
    expect(rulesIn(mts)).toContain('no-restricted-globals');
    expect(rulesIn(tsx)).toContain('no-restricted-globals');
  });

  it('flags eval and the Function constructor, escape hatches to every banned global', async () => {
    const evl = await lint(CORE, "export const t = eval('Date.now()') as number;\n");
    const fn = await lint(
      CORE,
      "export const t = new Function('return Date.now()')() as number;\n",
    );
    expect(rulesIn(evl)).toContain('no-eval');
    expect(rulesIn(fn)).toContain('no-restricted-globals');
  });

  it('flags aliased and computed access to Math, which would put Math.random back in reach', async () => {
    const aliased = await lint(CORE, 'const m = Math;\nexport const r = m.random();\n');
    const computed = await lint(
      CORE,
      "const k = 'random' as const;\nexport const r = Math[k]();\n",
    );
    expect(rulesIn(aliased)).toContain('no-restricted-syntax');
    expect(rulesIn(computed)).toContain('no-restricted-syntax');
  });

  it('flags locale-dependent methods, whose output depends on the host environment', async () => {
    const messages = await lint(
      CORE,
      "export const c = 'a'.localeCompare('b');\nexport const s = (1.5).toLocaleString();\n",
    );
    expect(rulesIn(messages)).toContain('no-restricted-syntax');
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it('flags dynamic import, which no-restricted-imports cannot see', async () => {
    const builtin = await lint(CORE, "export const p = import('node:fs');\n");
    const relative = await lint(CORE, "export const p = import('./somewhere.js');\n");
    expect(rulesIn(builtin)).toContain('no-restricted-syntax');
    expect(rulesIn(relative)).toContain('no-restricted-syntax');
  });

  it('flags node builtin imports in protocols, bare and prefixed', async () => {
    const bare = await lint(PROTOCOLS, "import * as fs from 'fs';\nexport const x = fs;\n");
    const prefixed = await lint(
      PROTOCOLS,
      "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
    );
    expect(rulesIn(bare)).toContain('no-restricted-imports');
    expect(rulesIn(prefixed)).toContain('no-restricted-imports');
  });

  it('is not suppressed by an inline eslint-disable comment', async () => {
    const messages = await lint(
      CORE,
      '// eslint-disable-next-line no-restricted-properties\nexport const r = Math.random();\n',
    );
    // The violation still fires…
    expect(rulesIn(messages)).toContain('no-restricted-properties');
    // …and the dead comment itself is reported, which --max-warnings 0 turns
    // into a CI failure.
    expect(messages.some((m) => m.message.includes('noInlineConfig'))).toBe(true);
  });

  it('does not restrict the studio, which lives outside the simulation', async () => {
    const messages = await lint(STUDIO, 'export const t = Date.now();\n');
    expect(messages).toEqual([]);
  });

  it('leaves deterministic code alone, including plain Math methods', async () => {
    const messages = await lint(
      CORE,
      'export function add(a: number, b: number): number {\n' +
        '  return Math.floor(a) + Math.max(b, 0) + Math.abs(a - b);\n' +
        '}\n',
    );
    expect(messages).toEqual([]);
  });
});

describe('ADR-003: the studio imports only the trace schema type', () => {
  const STUDIO_SRC = 'apps/studio/src/__lint_guard_fixture__.ts';

  it('flags a value import from the engine', async () => {
    const messages = await lint(STUDIO_SRC, "import { simulate } from '@nemea/core';\nexport const s = simulate;\n");
    expect(rulesIn(messages)).toContain('@typescript-eslint/no-restricted-imports');
  });

  it('allows a type-only import of the trace schema', async () => {
    const messages = await lint(
      STUDIO_SRC,
      "import type { TraceEvent } from '@nemea/core';\nexport const events: TraceEvent[] = [];\n",
    );
    expect(messages).toEqual([]);
  });

  it('flags protocols and examples, type imports included', async () => {
    const protocols = await lint(STUDIO_SRC, "import type { RaftState } from '@nemea/protocols';\nexport const s: RaftState | null = null;\n");
    const examples = await lint(STUDIO_SRC, "import { run } from '@nemea/examples';\nexport const r = run;\n");
    expect(rulesIn(protocols)).toContain('@typescript-eslint/no-restricted-imports');
    expect(rulesIn(examples)).toContain('@typescript-eslint/no-restricted-imports');
  });
});

describe('example protocols live under the same ban', () => {
  it('flags Date in examples/src', async () => {
    const messages = await lint('examples/src/__lint_guard_fixture__.ts', 'export const t = Date.now();\n');
    expect(rulesIn(messages)).toContain('no-restricted-globals');
  });
});

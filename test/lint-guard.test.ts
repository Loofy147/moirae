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

  it('leaves deterministic code alone', async () => {
    const messages = await lint(
      CORE,
      'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    expect(messages).toEqual([]);
  });
});

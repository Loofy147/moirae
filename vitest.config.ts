import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'test/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/*/test/**/*.test.ts',
      'examples/test/**/*.test.ts',
    ],
    watch: false,
    // The lint guard drives the ESLint API and shares CPU with the 200-seed Raft
    // fuzz worker; the 5s default flaked under contention.
    testTimeout: 30_000,
  },
});

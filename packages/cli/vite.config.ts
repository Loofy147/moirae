// Bundles the CLI into one ESM file for Node: the engine, Raft, the example
// scenario and this package's own code, with only Node builtins external.
// The studio is built separately and copied next to it by scripts/build.mjs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as {
  version: string;
};

export default defineConfig({
  define: { __MOIRAE_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'cli.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The dev server serves the repo's out/ directory, where `pnpm examples`
  // writes the example traces: open ?trace=/clean-partition.jsonl. Traces are
  // regenerated, never bundled.
  publicDir: '../../out',
  build: { copyPublicDir: false },
});

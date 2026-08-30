// Library build for publishing: one ESM file. Zero dependencies (ADR-004),
// so nothing is external. Types come from tsc (tsconfig.build.json).
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
  },
});

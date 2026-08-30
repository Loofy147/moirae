// Library build for publishing: one ESM file, with the engine external (it is
// a dependency, resolved by the consumer). Types come from tsc.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    rollupOptions: { external: ['moirae-core'] },
  },
});

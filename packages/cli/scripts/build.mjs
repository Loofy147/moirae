// Build the publishable package: dist/cli.js (bundled) and dist/studio/
// (the built studio). Runs on `pnpm build` and on `prepack`, so a tarball can
// never ship stale output. Uses Vite's Node API directly — no shelling out.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const dist = join(pkg, 'dist');
const studioRoot = join(pkg, '..', '..', 'apps', 'studio');
const studioDist = join(studioRoot, 'dist');

rmSync(dist, { recursive: true, force: true });
await build({ root: pkg, configFile: join(pkg, 'vite.config.ts'), logLevel: 'warn' });
await build({ root: studioRoot, configFile: join(studioRoot, 'vite.config.ts'), logLevel: 'warn' });
if (!existsSync(join(studioDist, 'index.html'))) throw new Error(`studio build missing at ${studioDist}`);
cpSync(studioDist, join(dist, 'studio'), { recursive: true });
console.log('built dist/cli.js and dist/studio/');

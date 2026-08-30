// Build the publishable package: dist/cli.js (bundled) and dist/studio/
// (the built studio). Runs on `pnpm build` and on `prepack`, so a tarball can
// never ship stale output.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const dist = join(pkg, 'dist');
const studioDist = join(pkg, '..', '..', 'apps', 'studio', 'dist');

rmSync(dist, { recursive: true, force: true });
execSync('pnpm exec vite build', { cwd: pkg, stdio: 'inherit' });
execSync('pnpm --filter @nemea/studio build', { cwd: pkg, stdio: 'inherit' });
if (!existsSync(join(studioDist, 'index.html'))) throw new Error(`studio build missing at ${studioDist}`);
cpSync(studioDist, join(dist, 'studio'), { recursive: true });
console.log('built dist/cli.js and dist/studio/');

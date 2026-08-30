// Record the README GIF from the clean scenario, deterministically: the
// built studio is served by the CLI, a headless browser screenshots the bare
// layout at fixed simulated times, and ffmpeg assembles the frames.
//
//   pnpm examples                              # writes out/clean-partition.jsonl
//   pnpm --filter nemea build                  # dist/cli.js + dist/studio
//   node scripts/record-gif.mjs [--browser <path to msedge/chrome>]
//
// The sequence (docs: Phase 6 recording plan), 12 fps:
//   0.0–1.5 s  sim 0→1.5 s        the calm before: one election, a leader
//   1.5–2.5 s  hold at 1.5 s      the wall drops; one second to read it
//   2.5–8.5 s  sim 1.5→3.5 s ⅓×  the minority tries and fails, counted live
//   8.5–11 s   sim 3.5→6 s   1×  heal, a new leader, a crash and a return
//   11–14 s    hold at 6 s        the whole picture
// Requires ffmpeg on PATH. No project dependency.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const browser =
  args[args.indexOf('--browser') + 1 || -1] ??
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!browser) throw new Error('no headless browser found; pass --browser <path>');

const FPS = 12;
const trace = join(root, 'out', 'clean-partition.jsonl');
const cli = join(root, 'packages', 'cli', 'dist', 'cli.js');
const frames = join(root, 'out', 'gif-frames');
const gif = join(root, 'docs', 'nemea-demo.gif');
for (const f of [trace, cli]) if (!existsSync(f)) throw new Error(`missing ${f} — see the header of this script`);

// The frame schedule: [simulated time, real seconds].
const plan = [];
const seg = (from, to, seconds) => {
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i++) plan.push(from + ((to - from) * i) / n);
};
seg(0, 1500, 1.5);
seg(1500, 1500, 1.0);
seg(1500, 3500, 6.0);
seg(3500, 6000, 2.5);
seg(6000, 6000, 3.0);

const port = 6767;
const server = spawn(process.execPath, [cli, 'replay', trace, '--no-open', '--port', String(port)], { stdio: 'ignore' });
try {
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const shots = new Map(); // simulated time -> frame file, so holds reuse one screenshot
  plan.forEach((t, i) => {
    const file = join(frames, `f${String(i).padStart(4, '0')}.png`);
    const key = Math.round(t);
    const existing = shots.get(key);
    if (existing !== undefined) {
      copyFileSync(existing, file);
      return;
    }
    const url = `${base}?trace=/trace.jsonl&chrome=0&t=${key}`;
    const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1020,530', '--virtual-time-budget=6000', `--screenshot=${file}`, url], { stdio: 'ignore' });
    if (r.status !== 0 || !existsSync(file)) throw new Error(`screenshot failed for t=${key}`);
    shots.set(key, file);
    if (i % 12 === 0) console.log(`frame ${i + 1}/${plan.length} (t=${key} ms)`);
  });
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%04d.png'), '-vf', 'scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', gif],
    { stdio: 'inherit' },
  );
  console.log(`wrote ${gif} (${plan.length} frames, ${(plan.length / FPS).toFixed(1)} s)`);
} finally {
  server.kill();
}

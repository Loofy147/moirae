// nemea — deterministic simulation testing for distributed systems.
//
//   nemea demo               run the clean Raft scenario, show the trace in the studio
//   nemea replay <trace>     open an existing trace in the studio
//
// Everything a stranger needs on a machine that has never seen the repo:
// this file is bundled with the engine, the Raft implementation, the example
// scenario and the built studio. No build step, no dependencies.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean } from '@nemea/examples';
import { serveStudio } from './serve';
import { summarize } from './summary';

const HELP = `nemea ${__NEMEA_VERSION__} — deterministic simulation testing for distributed systems

usage:
  nemea demo [--out <file>] [--port <n>] [--no-open] [--no-serve]
      Run five Raft nodes through a network partition and a crash, print what
      happened, write the trace, and open it in the studio.
      --out <file>   where to write the trace (default: nemea-demo.jsonl)
      --port <n>     studio port (default: any free port)
      --no-open      do not open a browser
      --no-serve     print the summary and write the trace, then exit

  nemea replay <trace.jsonl> [--port <n>] [--no-open]
      Open a trace in the studio. A trace replays byte for byte on any machine.

  nemea --version
  nemea --help
`;

interface Flags {
  readonly positional: string[];
  readonly out: string | null;
  readonly port: number;
  readonly open: boolean;
  readonly serve: boolean;
}

function parse(argv: readonly string[]): Flags {
  const positional: string[] = [];
  let out: string | null = null;
  let port = 0;
  let open = true;
  let serve = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--out') out = argv[++i] ?? null;
    else if (a === '--port') port = Number(argv[++i] ?? '0');
    else if (a === '--no-open') open = false;
    else if (a === '--no-serve') serve = false;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number');
  return { positional, out, port, open, serve };
}

function studioDir(): string {
  return fileURLToPath(new URL('./studio/', import.meta.url));
}

async function serve(trace: string, flags: Flags): Promise<void> {
  const dir = studioDir();
  if (!existsSync(dir)) throw new Error(`the studio is missing from this install (${dir})`);
  const served = await serveStudio({ studioDir: dir, trace, port: flags.port, open: flags.open, log: console.log });
  console.log('press Ctrl-C to stop');
  process.on('SIGINT', () => {
    served.close();
    process.exit(0);
  });
}

async function demo(flags: Flags): Promise<void> {
  const result = clean.run();
  const out = resolve(process.cwd(), flags.out ?? 'nemea-demo.jsonl');
  writeFileSync(out, result.jsonl);
  console.log(summarize(result.jsonl));
  console.log('');
  console.log(`trace written to ${out}`);
  if (result.violation !== null) {
    console.log(`invariant violated: ${JSON.stringify(result.violation)}`);
    process.exit(1);
  }
  if (flags.serve) await serve(result.jsonl, flags);
}

async function replay(flags: Flags): Promise<void> {
  const file = flags.positional[1];
  if (file === undefined) throw new Error('replay needs a trace file');
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  const trace = readFileSync(path, 'utf8');
  const first = trace.split('\n')[0] ?? '';
  if (!first.includes('"kind":"header"')) throw new Error(`${file} does not look like a nemea trace (no header line)`);
  console.log(summarize(trace));
  console.log('');
  await serve(trace, flags);
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(HELP);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(__NEMEA_VERSION__);
    return;
  }
  const flags = parse(argv);
  switch (flags.positional[0]) {
    case 'demo':
      await demo(flags);
      break;
    case 'replay':
      await replay(flags);
      break;
    default:
      throw new Error(`unknown command ${flags.positional[0] ?? ''}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`nemea: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

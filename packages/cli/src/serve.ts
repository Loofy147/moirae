// Serve the bundled studio on localhost with one trace, and open a browser.
// A tiny static server on node:http — no framework, no dependency.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl; charset=utf-8',
  '.ico': 'image/x-icon',
};

export interface ServeOptions {
  readonly studioDir: string; // directory holding the studio's index.html and assets/
  readonly trace: string; // the JSONL text to serve at /trace.jsonl
  readonly port: number; // 0 = any free port
  readonly open: boolean;
  readonly log: (line: string) => void;
}

export interface Served {
  readonly url: string;
  close(): void;
}

export function serveStudio(opts: ServeOptions): Promise<Served> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/trace.jsonl') {
      res.statusCode = 200;
      res.setHeader('content-type', TYPES['.jsonl'] as string);
      res.end(opts.trace);
      return;
    }
    const rel = path === '/' ? 'index.html' : normalize(path).replace(/^[/\\]+/, '');
    if (rel.includes('..')) {
      res.statusCode = 400;
      res.end('bad path');
      return;
    }
    const file = join(opts.studioDir, rel);
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  });

  return new Promise((resolve) => {
    server.listen(opts.port, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : opts.port;
      const url = `http://127.0.0.1:${port}/?trace=/trace.jsonl`;
      opts.log(`studio: ${url}`);
      if (opts.open) openBrowser(url, opts.log);
      resolve({ url, close: () => server.close() });
    });
  });
}

function openBrowser(url: string, log: (line: string) => void): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => log(`could not open a browser; open ${url} yourself`));
    child.unref();
  } catch {
    log(`could not open a browser; open ${url} yourself`);
  }
}

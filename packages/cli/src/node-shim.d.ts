// The Node APIs this CLI uses, declared minimally. @types/node is not a
// dependency (yet); replacing this file with it is a one-line change.

declare module 'node:http' {
  export interface IncomingMessage {
    url?: string;
    method?: string;
  }
  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string | Uint8Array): void;
  }
  export interface Server {
    listen(port: number, host: string, callback: () => void): void;
    close(): void;
    address(): { port: number } | string | null;
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { isFile(): boolean };
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function extname(path: string): string;
  export function normalize(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string;
}

declare module 'node:child_process' {
  export function spawn(
    command: string,
    args: string[],
    options?: { detached?: boolean; stdio?: 'ignore'; shell?: boolean },
  ): { unref(): void; on(event: 'error', listener: (err: Error) => void): void };
}

declare const process: {
  readonly argv: string[];
  readonly platform: string;
  cwd(): string;
  exit(code?: number): never;
  on(event: 'SIGINT', listener: () => void): void;
};

// Injected by the build (vite define) from package.json.
declare const __MOIRAE_VERSION__: string;

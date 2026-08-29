// Minimal ambient typing for the two node:fs calls the examples test uses to
// write traces into out/. @types/node is deliberately not a dependency yet;
// when a real CLI needs Node APIs, that is the moment to add it.
declare module 'node:fs' {
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string): void;
}

// FNV-1a 64-bit over UTF-8 bytes. Written in-repo per ADR-004: the trace hash
// and the per-node seed derivation (SPEC §4) must never change behaviour
// underneath us, because every stored seed in existence depends on them.
// Constants from draft-eastlake-fnv (FNV-1a, 64-bit).

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

// UTF-8 encoding of a JS string. Well-formed surrogate pairs become one code
// point; lone surrogates become U+FFFD, matching WHATWG TextEncoder (which is
// not available here: core is typed against bare ES2022, no platform globals).
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      } else {
        cp = 0xfffd;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return out;
}

export function fnv1a64(bytes: ArrayLike<number>): bigint {
  let h = FNV64_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt((bytes[i] as number) & 0xff);
    h = (h * FNV64_PRIME) & MASK64;
  }
  return h;
}

export function fnv1a64String(s: string): bigint {
  return fnv1a64(utf8Bytes(s));
}

export function hex64(v: bigint): string {
  return v.toString(16).padStart(16, '0');
}

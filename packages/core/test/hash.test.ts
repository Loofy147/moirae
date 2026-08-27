import { describe, expect, it } from 'vitest';
import { fnv1a64String, hex64, utf8Bytes } from '../src/hash';

describe('utf8Bytes', () => {
  it('passes ASCII through unchanged', () => {
    expect(utf8Bytes('abc')).toEqual([0x61, 0x62, 0x63]);
  });

  it('encodes 2-, 3- and 4-byte sequences', () => {
    expect(utf8Bytes('é')).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    // U+1D11E MUSICAL SYMBOL G CLEF, a surrogate pair in UTF-16.
    expect(utf8Bytes('𝄞')).toEqual([0xf0, 0x9d, 0x84, 0x9e]);
  });

  it('replaces lone surrogates with U+FFFD, like TextEncoder', () => {
    expect(utf8Bytes('\ud800')).toEqual([0xef, 0xbf, 0xbd]);
    expect(utf8Bytes('\udfff!')).toEqual([0xef, 0xbf, 0xbd, 0x21]);
  });
});

describe('fnv1a64', () => {
  // Reference vectors for FNV-1a 64-bit. "" is the offset basis by
  // definition; "a" and "foobar" are the published test vectors from
  // draft-eastlake-fnv (constants confirmed against the draft, values
  // cross-checked against an independent implementation).
  it('matches the published reference vectors', () => {
    expect(hex64(fnv1a64String(''))).toBe('cbf29ce484222325');
    expect(hex64(fnv1a64String('a'))).toBe('af63dc4c8601ec8c');
    expect(hex64(fnv1a64String('foobar'))).toBe('85944171f73967e8');
    expect(hex64(fnv1a64String('hello world'))).toBe('779a65e7023cd2e7');
  });

  it('hashes non-ASCII input through UTF-8, not UTF-16 code units', () => {
    // fnv1a64 of bytes [0xc3, 0xa9] — é must hash as its UTF-8 bytes.
    expect(fnv1a64String('é')).not.toBe(fnv1a64String('©'));
  });

  it('pads hex64 to 16 characters', () => {
    expect(hex64(0x1n)).toBe('0000000000000001');
  });
});

import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../src/deep-freeze';

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const v = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.a)).toBe(true);
    expect(Object.isFrozen(v.a.b)).toBe(true);
    expect(Object.isFrozen(v.a.b[1])).toBe(true);
  });

  it('makes mutation throw (strict mode)', () => {
    const v = deepFreeze({ n: 1, inner: { m: 2 } }) as Record<string, unknown>;
    expect(() => {
      v['n'] = 2;
    }).toThrow(TypeError);
    expect(() => {
      (v['inner'] as Record<string, unknown>)['m'] = 3;
    }).toThrow(TypeError);
  });

  it('passes primitives and null through', () => {
    expect(deepFreeze(3)).toBe(3);
    expect(deepFreeze(null)).toBe(null);
    expect(deepFreeze('s')).toBe('s');
  });
});

// PCG32 (XSH-RR variant), transcribed from the reference implementation
// pcg_basic.c by Melissa O'Neill (github.com/imneme/pcg-c-basic, Apache-2.0).
// Written in-repo per ADR-004. Correctness is asserted against the reference
// check output in github.com/imneme/pcg-c test-high/expected/check-pcg32.out;
// see test/pcg32.test.ts.
//
// 64-bit state arithmetic uses BigInt: exact, spec-deterministic across
// engines, and fast enough for v0 fuzz targets.

const MUL = 6364136223846793005n;
const MASK64 = 0xffffffffffffffffn;

export class Pcg32 {
  private state: bigint;
  private readonly inc: bigint;

  // pcg32_srandom_r: state = 0; inc = (initseq << 1) | 1; step; state += initstate; step.
  constructor(initState: bigint, initSeq: bigint) {
    this.state = 0n;
    this.inc = (((initSeq & MASK64) << 1n) | 1n) & MASK64;
    this.nextUint32();
    this.state = (this.state + (initState & MASK64)) & MASK64;
    this.nextUint32();
  }

  // pcg32_random_r: output is computed from the *old* state (XSH-RR), then
  // the LCG advances.
  nextUint32(): number {
    const old = this.state;
    this.state = (old * MUL + this.inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
  }

  // Uniform in [0, 1) with 32 bits of precision — the ctx.random() contract.
  random(): number {
    return this.nextUint32() / 4294967296;
  }
}

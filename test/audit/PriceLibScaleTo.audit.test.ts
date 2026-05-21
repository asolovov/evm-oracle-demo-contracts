// Audit-finding regression test for M-02 (PriceLib.scaleTo cast sign-flip).
//
// Originally a PoC showing that `int256(10**diff)` for `diff == 77` silently
// reinterpreted to a negative number (since `10**77 > 2**255`), producing a
// signed-wrong result on the scale-up path and a sign-flipped quotient on the
// scale-down path. Remediated in the same audit branch by wrapping the cast
// in OZ `SafeCast.toInt256`, which reverts on `value > int256.max`. See
// `audit/findings.md#M-02`.

import { expect } from "chai";
import { network } from "hardhat";

describe("AUDIT M-02: PriceLib.scaleTo cast regression", () => {
  it("diff = 76 still returns the correct positive factor (boundary, unchanged)", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    const out = await harness.read.scaleTo([1n, 0, 76]);
    expect(out).to.equal(10n ** 76n);
  });

  it("diff = 77 now reverts via SafeCast (was: silent negative result)", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    await conn.viem.assertions.revertWithCustomError(
      harness.read.scaleTo([1n, 0, 77]) as unknown as Promise<unknown>,
      harness,
      "SafeCastOverflowedUintToInt",
    );
  });

  it("diffDown = 77 now reverts via SafeCast (was: silent sign-flipped divisor)", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    await conn.viem.assertions.revertWithCustomError(
      harness.read.scaleTo([0n, 77, 0]) as unknown as Promise<unknown>,
      harness,
      "SafeCastOverflowedUintToInt",
    );
  });

  it("scale-up still reverts when the product itself would overflow int256 (default 0.8 checked arithmetic)", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    // diff = 76 ⇒ factor = 10**76 (positive, fits int256). src = int256.max / 10**75 ≈ 5.78
    // so `src * 10**76` overflows. Confirms the second line of defence (checked mul) still fires.
    const src = (1n << 255n) - 1n; // int256.max
    let threw = false;
    try {
      await harness.read.scaleTo([src, 0, 76]);
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
  });
});

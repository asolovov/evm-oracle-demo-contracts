// Audit-finding PoC tests for PriceLib.scaleTo cast soundness.
//
// These tests demonstrate findings rather than enforce desired behavior;
// they may PASS today (demonstrating the bug) and become failing assertions
// after remediation. See audit/findings.md for context.

import { expect } from "chai";
import { network } from "hardhat";

describe("AUDIT: PriceLib.scaleTo cast soundness", () => {
  it("diff = 77 produces a NEGATIVE factor due to int256(uint256(10**77)) sign-bit collision", async () => {
    // 10**77 has bit 255 set (> 2^255), so int256(uint256(10**77)) is negative.
    // The function computes `factor = int256(10**diff)` then `src * factor`. With src=1
    // and diff=77 we should mathematically get 10**77 (a positive number too large for
    // int256, which SHOULD revert under checked arithmetic), but instead we get a
    // negative finite value because Solidity's uint->int cast reinterprets bits.
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);

    // src = 1, srcDecimals = 0, dstDecimals = 77 -> result expected to be 10**77 but
    // 10**77 > int256.max so a sound implementation would revert. Current impl
    // silently returns a NEGATIVE value.
    const out = await harness.read.scaleTo([1n, 0, 77]);
    // 10**77 - 2**256 (two's-complement reinterpretation)
    const expectedNegative = (10n ** 77n) - (1n << 256n);
    expect(out).to.equal(expectedNegative);
    // sanity: it is in fact negative
    expect(out < 0n).to.equal(true);
  });

  it("diff = 76 still produces a correct positive factor (boundary check)", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    const out = await harness.read.scaleTo([1n, 0, 76]);
    expect(out).to.equal(10n ** 76n);
  });

  it("scaling DOWN with diffDown = 77 also produces a negative divisor (silent wrong answer)", async () => {
    // Symmetric problem on the scale-down branch.
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    // src = 0 should be safe — division of zero — but the divisor is still wrong.
    const out = await harness.read.scaleTo([0n, 77, 0]);
    expect(out).to.equal(0n); // 0 / anything is 0; bug latent but not surfaced here.

    // With a non-zero src the result sign is now wrong.
    // src = 10**77 cannot be expressed as int256, so we use a smaller src that exercises
    // the divisor branch with a negative-after-cast divisor. src = 10**75 / int256(10**77).
    const src = 10n ** 75n;
    const negativeDivisor = (10n ** 77n) - (1n << 256n);
    const out2 = await harness.read.scaleTo([src, 77, 0]);
    // Solidity int division truncates toward zero. Off-chain check:
    const expected = src / negativeDivisor; // expect 0 because |src| < |divisor|, but sign is flipped
    expect(out2).to.equal(expected);
    // Off-chain: 10^75 / -(10^76+) = 0 (truncates toward 0). So functionally still 0 here.
    // The bug surfaces clearly with larger src; see next assertion.
  });

  it("with src exceeding |negativeDivisor| the sign of the answer flips", async () => {
    const conn = await network.connect();
    const harness = await conn.viem.deployContract("PriceLibHarness", []);
    // |negativeDivisor| ≈ 1.58e76. Use src = 5e76 so |src| > |divisor|, result is negative
    // when it should be positive (+3 if divisor were +10^77, but ~ -3 here).
    // We construct src as a literal int256 positive value comfortably below int256.max.
    const src = 5n * 10n ** 76n;
    const out = await harness.read.scaleTo([src, 77, 0]);
    expect(out < 0n).to.equal(true);
  });
});

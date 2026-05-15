import { expect } from "chai";
import fc from "fast-check";

describe("scaffold smoke", () => {
  it("test runner is alive", () => {
    expect(2 + 2).to.equal(4);
  });

  it("fast-check property runs", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
      { numRuns: 64 },
    );
  });
});

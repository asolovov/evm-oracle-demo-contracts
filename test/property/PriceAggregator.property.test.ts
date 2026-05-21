import fc from "fast-check";
import { network } from "hardhat";

import { deploySystem } from "../helpers/fixtures.js";

// Refund property: 100 runs is the sweet spot — each run sends a real EDR
// transaction (~30-50ms) so 1000 runs would push wall-clock past 60s without
// materially improving signal. The pure-call properties in PriceLib.property
// already cover the 1k-runs bar at the audit-grade level.
const REFUND_RUNS = 100;

describe("PriceAggregator (property-based)", () => {
  it("requestPrice refunds exactly msg.value - requestFee", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });
    const pub = await conn.viem.getPublicClient();
    const fee = sys.fee;

    await fc.assert(
      fc.asyncProperty(
        // overpay between 1 wei and 100 ether on top of the fee
        fc.bigInt({ min: 0n, max: 100_000_000_000_000_000_000n }),
        async (overpay) => {
          const value = fee + overpay;
          const balBefore = await pub.getBalance({ address: sys.userAddress });
          const txHash = await agg.write.requestPrice([], { value });
          const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
          const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
          const balAfter = await pub.getBalance({ address: sys.userAddress });
          // Net spend should be exactly the fee plus gas — refund covered the overpay.
          return balBefore - balAfter === fee + gasCost;
        },
      ),
      { numRuns: REFUND_RUNS },
    );
  });
});

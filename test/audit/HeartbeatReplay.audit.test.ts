// Audit-finding regression test for M-01 (heartbeat replay).
//
// Originally a PoC showing that anyone could replay a captured heartbeat
// (reqId=0) to overwrite the latest round with stale data, since reqId=0 was
// exempt from the per-reqId replay guard and `maxAge` defaulted to
// `type(uint256).max`. Remediated in the same audit branch by adding a
// monotonic-`startedAt` gate in `PriceAggregator.fulfillPrice`: any new
// submission must carry a strictly newer reporter-attested observation time
// than the latest stored round. See `audit/findings.md#M-01`.
//
// Both tests now assert the gate fires under the original attack scenarios.

import { network } from "hardhat";

import { signPrice, type DomainParams, type PriceMessage } from "../helpers/eip712.js";
import { deploySystem, type DeployedSystem } from "../helpers/fixtures.js";

async function signQuorum(sys: DeployedSystem, domain: DomainParams, message: PriceMessage) {
  return Promise.all(sys.reporters.slice(0, 2).map((w) => signPrice(w, w.account!.address, domain, message)));
}

describe("AUDIT M-01: heartbeat-replay regression", () => {
  it("stale-timestamp gate blocks a heartbeat replay (was: silent overwrite of latest round)", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };

    // Legitimate heartbeat at (price=100, timestamp=100).
    const m1: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 100n, timestamp: 100n };
    const sigs1 = await signQuorum(sys, domain, m1);
    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // Newer heartbeat at (price=200, timestamp=200) — the legitimate current price.
    const m2: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 200n, timestamp: 200n };
    const sigs2 = await signQuorum(sys, domain, m2);
    await agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, sigs2]);

    // ATTACK (pre-fix): stranger replays sigs1 to overwrite the latest round with stale data.
    // POST-FIX: the monotonic-startedAt gate rejects with StaleTimestamp(100, 200).
    const wallets = await conn.viem.getWalletClients();
    const stranger = wallets[8];
    const aggAsStranger = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: stranger },
    });
    await conn.viem.assertions.revertWithCustomError(
      aggAsStranger.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]),
      agg,
      "StaleTimestamp",
    );
  });

  it("stale-timestamp gate generalises beyond heartbeats: a consumer-driven replay with the same timestamp also reverts", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };

    // First request fulfilled at timestamp=50.
    const m1: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 100n, timestamp: 50n };
    const sigs1 = await signQuorum(sys, domain, m1);
    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // A different reqId (2) but reusing the same observation time is rejected — even though
    // the replay guard alone (which is keyed by reqId) wouldn't catch it.
    const m2: PriceMessage = { reqId: 2n, assetId: sys.assetId, price: 100n, timestamp: 50n };
    const sigs2 = await signQuorum(sys, domain, m2);
    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, sigs2]),
      agg,
      "StaleTimestamp",
    );
  });
});

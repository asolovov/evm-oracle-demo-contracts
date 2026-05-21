import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, parseEther } from "viem";

import { signPrice, type PriceMessage } from "../helpers/eip712.js";
import { deploySystem } from "../helpers/fixtures.js";
import { lower } from "../helpers/address.js";

describe("End-to-end flow", () => {
  it("PriceConsumer → PriceAggregator → fulfillPrice → consumer reads latestAnswer", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const consumer = await conn.viem.getContractAt("PriceConsumer", sys.consumer, {
      client: { wallet: sys.user },
    });
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const pub = await conn.viem.getPublicClient();

    // 1. Consumer wires correctly
    expect(lower(await consumer.read.aggregator())).to.equal(lower(sys.aggregator));

    // 2. Consumer forwards a request with surplus fee; aggregator refunds; consumer relays the refund.
    const overpay = sys.fee + parseEther("0.5");
    const balBefore = await pub.getBalance({ address: sys.userAddress });
    const txHash = await consumer.write.requestPrice([], { value: overpay });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    const balAfter = await pub.getBalance({ address: sys.userAddress });

    expect(balBefore - balAfter).to.equal(sys.fee + gasCost);
    expect(await consumer.read.lastReqId()).to.equal(1n);

    // 3. Reporters sign, oracle submits, aggregator records the round.
    const message: PriceMessage = {
      reqId: 1n,
      assetId: sys.assetId,
      price: 3450_00000000n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    };
    const sigs = await Promise.all(
      sys.reporters
        .slice(0, 2)
        .map((w) =>
          signPrice(w, w.account!.address, { chainId: sys.chainId, verifyingContract: sys.aggregator }, message),
        ),
    );
    await agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]);

    // 4. Consumer reads the new answer via Chainlink-compatible interface.
    expect(await consumer.read.latestAnswer()).to.equal(message.price);
    const round = await agg.read.latestRoundData();
    expect(round[1]).to.equal(message.price);
  });

  it("survives reporter set rotation mid-stream (old set deauthorized, new set works)", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const wallets = await conn.viem.getWalletClients();

    // Submit one fulfillment with the original reporters.
    const m1: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 1n, timestamp: 1n };
    const sigs1 = await Promise.all(
      sys.reporters
        .slice(0, 2)
        .map((w) => signPrice(w, w.account!.address, { chainId: sys.chainId, verifyingContract: sys.aggregator }, m1)),
    );
    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);

    // Deploy a fresh ReporterSet with different signers.
    const newReporters = [wallets[5], wallets[6], wallets[7]];
    const newReporterAddrs = newReporters.map((w) => w.account!.address as `0x${string}`);
    const newSet = await conn.viem.deployContract("ReporterSet", [sys.ownerAddress, newReporterAddrs, 2n]);
    await agg.write.setReporterSet([newSet.address]);

    // Old reporters' sigs should now be rejected.
    const m2: PriceMessage = { reqId: 2n, assetId: sys.assetId, price: 2n, timestamp: 2n };
    const oldSigs = await Promise.all(
      sys.reporters
        .slice(0, 2)
        .map((w) => signPrice(w, w.account!.address, { chainId: sys.chainId, verifyingContract: sys.aggregator }, m2)),
    );
    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, oldSigs]),
      agg,
      "InsufficientSignatures",
    );

    // New reporters can fulfill.
    const newSigs = await Promise.all(
      newReporters
        .slice(0, 2)
        .map((w) => signPrice(w, w.account!.address, { chainId: sys.chainId, verifyingContract: sys.aggregator }, m2)),
    );
    await agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, newSigs]);
    expect(await agg.read.latestRoundId()).to.equal(2n);
  });

  it("registry: every registered asset resolves to a deployed aggregator", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const reg = await conn.viem.getContractAt("OracleRegistry", sys.registry);

    const assets = await reg.read.listAssets();
    expect(assets).to.have.length(1);
    expect(getAddress(await reg.read.getAggregator([assets[0]]))).to.equal(getAddress(sys.aggregator));
  });
});

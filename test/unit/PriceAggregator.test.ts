import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, keccak256, maxUint256, parseEther, toBytes, zeroAddress } from "viem";

import { signPrice, type DomainParams, type PriceMessage } from "../helpers/eip712.js";
import { deploySystem, type DeployedSystem } from "../helpers/fixtures.js";
import { lower } from "../helpers/address.js";

const ASSET_WETH = keccak256(toBytes("WETH/USD"));

async function signQuorum(
  sys: DeployedSystem,
  domain: DomainParams,
  message: PriceMessage,
  signers = sys.reporters.slice(0, 2),
) {
  return Promise.all(signers.map((w) => signPrice(w, w.account!.address, domain, message)));
}

describe("PriceAggregator", () => {
  it("constructor: stores immutable state and defaults maxAge to uint256.max", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    expect(await agg.read.assetId()).to.equal(sys.assetId);
    expect(await agg.read.decimals()).to.equal(8);
    expect(await agg.read.description()).to.equal("WETH/USD - Lighthouse demo");
    expect(await agg.read.version()).to.equal(1n);
    expect(await agg.read.requestFee()).to.equal(sys.fee);
    expect(await agg.read.maxAge()).to.equal(maxUint256);
    expect(lower(await agg.read.reporterSet())).to.equal(lower(sys.reporterSet));
  });

  it("constructor: reverts when reporter set is the zero address", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    let threw = false;
    try {
      await conn.viem.deployContract("PriceAggregator", [
        wallets[0].account!.address,
        zeroAddress,
        ASSET_WETH,
        8,
        "WETH/USD",
        1n,
        0n,
      ]);
    } catch (e) {
      threw = true;
      expect(String(e)).to.match(/ZeroReporterSet/);
    }
    expect(threw).to.equal(true);
  });

  it("requestPrice: emits PriceRequested with monotonic reqId, refunds excess", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });
    const pub = await conn.viem.getPublicClient();

    const balBefore = await pub.getBalance({ address: sys.userAddress });

    const overpay = sys.fee + parseEther("1");
    const txHash = await agg.write.requestPrice([], { value: overpay });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;

    expect(await agg.read.nextReqId()).to.equal(1n);

    const balAfter = await pub.getBalance({ address: sys.userAddress });
    // Should have paid only the fee + gas (refund returned the difference).
    expect(balBefore - balAfter).to.equal(sys.fee + gasCost);

    const events = await agg.getEvents.PriceRequested();
    expect(events.length).to.be.greaterThan(0);
    const last = events[events.length - 1];
    expect(last.args.reqId).to.equal(1n);
    expect(getAddress(last.args.requester!)).to.equal(getAddress(sys.userAddress));
  });

  it("requestPrice: works at exact fee (no refund)", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });

    await agg.write.requestPrice([], { value: sys.fee });
    expect(await agg.read.nextReqId()).to.equal(1n);
  });

  it("requestPrice: increments nextReqId across multiple calls", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });
    await agg.write.requestPrice([], { value: sys.fee });
    await agg.write.requestPrice([], { value: sys.fee });
    await agg.write.requestPrice([], { value: sys.fee });
    expect(await agg.read.nextReqId()).to.equal(3n);
  });

  it("requestPrice: reverts on insufficient fee", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });
    await conn.viem.assertions.revertWithCustomError(
      agg.write.requestPrice([], { value: sys.fee - 1n }),
      agg,
      "InsufficientFee",
    );
  });

  it("fulfillPrice: 2-of-3 sigs succeed; round state + event recorded", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    const message: PriceMessage = {
      reqId: 1n,
      assetId: sys.assetId,
      price: 3450_00000000n,
      timestamp: 1_700_000_000n,
    };
    const sigs = await signQuorum(sys, { chainId: sys.chainId, verifyingContract: sys.aggregator }, message);

    const before = await agg.read.latestRoundId();
    await agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]);
    const after = await agg.read.latestRoundId();
    expect(after).to.equal(before + 1n);

    const round = await agg.read.latestRoundData();
    expect(round[0]).to.equal(after);
    expect(round[1]).to.equal(message.price);
    expect(round[2]).to.equal(message.timestamp);
    expect(round[4]).to.equal(after);

    expect(await agg.read.fulfilled([message.reqId])).to.equal(true);

    const events = await agg.getEvents.PriceFulfilled();
    expect(events.map((e) => e.args.price)).to.include(message.price);
  });

  it("fulfillPrice: same non-zero reqId cannot be reused", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    const message: PriceMessage = { reqId: 7n, assetId: sys.assetId, price: 1n, timestamp: 1n };
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };
    const sigs = await signQuorum(sys, domain, message);

    await agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]);
    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]),
      agg,
      "ReqIdAlreadyFulfilled",
    );
  });

  it("fulfillPrice: reqId=0 (heartbeat) allows repeated submissions", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };

    const m1: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 100n, timestamp: 1n };
    const m2: PriceMessage = { reqId: 0n, assetId: sys.assetId, price: 101n, timestamp: 2n };

    const sigs1 = await signQuorum(sys, domain, m1);
    const sigs2 = await signQuorum(sys, domain, m2);

    await agg.write.fulfillPrice([m1.reqId, m1.price, m1.timestamp, sigs1]);
    await agg.write.fulfillPrice([m2.reqId, m2.price, m2.timestamp, sigs2]);

    expect(await agg.read.latestRoundId()).to.equal(2n);
    expect(await agg.read.fulfilled([0n])).to.equal(false); // reqId=0 never marked
  });

  it("fulfillPrice: rejects when fewer than threshold signatures provided", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    const message: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 1n, timestamp: 1n };
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };
    const sigs = await signQuorum(sys, domain, message, sys.reporters.slice(0, 1));

    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]),
      agg,
      "InsufficientSignatures",
    );
  });

  it("fulfillPrice: rejects sigs over a digest with the wrong assetId baked in", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    const wrongAsset = keccak256(toBytes("WBTC/USD"));
    const wrongMessage: PriceMessage = { reqId: 1n, assetId: wrongAsset, price: 1n, timestamp: 1n };
    const sigs = await signQuorum(sys, { chainId: sys.chainId, verifyingContract: sys.aggregator }, wrongMessage);

    // submission claims the digest is for sys.assetId, but sigs were taken over wrongAsset
    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([wrongMessage.reqId, wrongMessage.price, wrongMessage.timestamp, sigs]),
      agg,
      "InsufficientSignatures",
    );
  });

  it("fulfillPrice: rejects sigs from non-reporters", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);
    const wallets = await conn.viem.getWalletClients();
    const stranger = wallets[8];

    const message: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 1n, timestamp: 1n };
    const domain = { chainId: sys.chainId, verifyingContract: sys.aggregator };
    const sigs = await Promise.all([stranger, stranger].map((w) => signPrice(w, w.account!.address, domain, message)));

    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]),
      agg,
      "InsufficientSignatures",
    );
  });

  it("fulfillPrice: strict maxAge rejects stale submissions", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await agg.write.setMaxAge([60n]); // 60s tolerance

    const message: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 1n, timestamp: 1n }; // long ago
    const sigs = await signQuorum(sys, { chainId: sys.chainId, verifyingContract: sys.aggregator }, message);

    await conn.viem.assertions.revertWithCustomError(
      agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]),
      agg,
      "SubmissionTooOld",
    );
  });

  it("fulfillPrice: strict maxAge accepts submission whose timestamp is in the future (no skew check upward)", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await agg.write.setMaxAge([60n]);

    const pub = await conn.viem.getPublicClient();
    const block = await pub.getBlock();
    const futureTimestamp = block.timestamp + 1_000n;

    const message: PriceMessage = {
      reqId: 1n,
      assetId: sys.assetId,
      price: 1n,
      timestamp: futureTimestamp,
    };
    const sigs = await signQuorum(sys, { chainId: sys.chainId, verifyingContract: sys.aggregator }, message);

    await agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]);
    expect(await agg.read.latestRoundId()).to.equal(1n);
  });

  it("latestRoundData / getRoundData: revert before any fulfillment", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await conn.viem.assertions.revertWithCustomError(
      agg.read.latestRoundData() as unknown as Promise<unknown>,
      agg,
      "NoRoundData",
    );
    await conn.viem.assertions.revertWithCustomError(
      agg.read.getRoundData([1n]) as unknown as Promise<unknown>,
      agg,
      "NoRoundData",
    );
  });

  it("getRoundData: returns historical round after fulfillment", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    const message: PriceMessage = { reqId: 1n, assetId: sys.assetId, price: 42n, timestamp: 1n };
    const sigs = await signQuorum(sys, { chainId: sys.chainId, verifyingContract: sys.aggregator }, message);
    await agg.write.fulfillPrice([message.reqId, message.price, message.timestamp, sigs]);

    const round = await agg.read.getRoundData([1n]);
    expect(round[0]).to.equal(1n);
    expect(round[1]).to.equal(42n);
    expect(round[2]).to.equal(1n);
  });

  it("setRequestFee: owner-only, emits RequestFeeChanged", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await conn.viem.assertions.emitWithArgs(agg.write.setRequestFee([777n]), agg, "RequestFeeChanged", [sys.fee, 777n]);
    expect(await agg.read.requestFee()).to.equal(777n);
  });

  it("setRequestFee: rejects non-owner", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const aggStranger = await conn.viem.getContractAt("PriceAggregator", sys.aggregator, {
      client: { wallet: sys.user },
    });
    await conn.viem.assertions.revertWithCustomError(
      aggStranger.write.setRequestFee([1n]),
      aggStranger,
      "OwnableUnauthorizedAccount",
    );
  });

  it("setMaxAge: owner-only, emits MaxAgeChanged", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await conn.viem.assertions.emitWithArgs(agg.write.setMaxAge([60n]), agg, "MaxAgeChanged", [maxUint256, 60n]);
    expect(await agg.read.maxAge()).to.equal(60n);
  });

  it("requestPrice: reverts RefundFailed when the caller cannot accept ETH", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const caller = await conn.viem.deployContract("NonPayableCaller", []);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await conn.viem.assertions.revertWithCustomError(
      caller.write.callRequestPrice([sys.aggregator], { value: sys.fee + parseEther("0.1") }),
      agg,
      "RefundFailed",
    );
  });

  it("setReporterSet: owner-only, rejects zero, emits ReporterSetChanged on success", async () => {
    const conn = await network.connect();
    const sys = await deploySystem(conn);
    const agg = await conn.viem.getContractAt("PriceAggregator", sys.aggregator);

    await conn.viem.assertions.revertWithCustomError(agg.write.setReporterSet([zeroAddress]), agg, "ZeroReporterSet");

    const newSet = await conn.viem.deployContract("ReporterSet", [sys.ownerAddress, sys.reporterAddresses, 2n]);
    await conn.viem.assertions.emitWithArgs(agg.write.setReporterSet([newSet.address]), agg, "ReporterSetChanged", [
      getAddress(sys.reporterSet),
      getAddress(newSet.address),
    ]);
    expect(lower(await agg.read.reporterSet())).to.equal(lower(newSet.address));
  });
});

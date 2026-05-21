import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toBytes, zeroAddress, type Hex } from "viem";

import { buildDigest, signPrice } from "../helpers/eip712.js";

const ASSET_WETH = keccak256(toBytes("WETH/USD"));

describe("PriceLib (via PriceLibHarness)", () => {
  describe("buildDigest", () => {
    it("matches viem's hashTypedData output for the same inputs", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());

      const params = {
        reqId: 42n,
        assetId: ASSET_WETH,
        price: 3450_00000000n,
        timestamp: 1_700_000_000n,
        chainId,
        aggregator: harness.address,
      };

      const onChain = await harness.read.buildDigest([
        params.reqId,
        params.assetId,
        params.price,
        params.timestamp,
        params.chainId,
        params.aggregator,
      ]);

      const offChain = buildDigest(
        { chainId, verifyingContract: harness.address },
        { reqId: params.reqId, assetId: params.assetId, price: params.price, timestamp: params.timestamp },
      );

      expect(onChain).to.equal(offChain);
    });

    it("changes when any field changes (sanity)", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const base = [1n, ASSET_WETH, 100n, 1n, 1n, harness.address] as const;

      const d0 = await harness.read.buildDigest([...base]);
      const dReq = await harness.read.buildDigest([2n, base[1], base[2], base[3], base[4], base[5]]);
      const dAsset = await harness.read.buildDigest([
        base[0],
        keccak256(toBytes("WBTC/USD")),
        base[2],
        base[3],
        base[4],
        base[5],
      ]);
      const dPrice = await harness.read.buildDigest([base[0], base[1], 101n, base[3], base[4], base[5]]);
      const dTs = await harness.read.buildDigest([base[0], base[1], base[2], 2n, base[4], base[5]]);
      const dChain = await harness.read.buildDigest([base[0], base[1], base[2], base[3], 2n, base[5]]);
      const dAgg = await harness.read.buildDigest([base[0], base[1], base[2], base[3], base[4], zeroAddress]);

      const all = new Set([d0, dReq, dAsset, dPrice, dTs, dChain, dAgg]);
      expect(all.size).to.equal(7);
    });
  });

  describe("scaleTo", () => {
    it("returns input when srcDecimals == dstDecimals", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      expect(await harness.read.scaleTo([123n, 8, 8])).to.equal(123n);
      expect(await harness.read.scaleTo([-456n, 18, 18])).to.equal(-456n);
    });

    it("scales up exactly", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      expect(await harness.read.scaleTo([1n, 0, 8])).to.equal(100_000_000n);
      expect(await harness.read.scaleTo([-3n, 2, 6])).to.equal(-30_000n);
    });

    it("scales down with truncation toward zero", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      expect(await harness.read.scaleTo([100_000_000n, 8, 0])).to.equal(1n);
      // truncation: 199/100 = 1
      expect(await harness.read.scaleTo([199n, 2, 0])).to.equal(1n);
      // negative truncation: -199/100 = -1 (Solidity int div truncates toward zero)
      expect(await harness.read.scaleTo([-199n, 2, 0])).to.equal(-1n);
    });

    it("reverts on overflow when scaling up beyond int256 max", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const big = 1n << 200n;
      let threw = false;
      try {
        await harness.read.scaleTo([big, 0, 60]);
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });

  describe("verifySignatures", () => {
    const buildSigners = async (conn: Awaited<ReturnType<typeof network.connect>>) => {
      const wallets = await conn.viem.getWalletClients();
      const reporters = [wallets[1], wallets[2], wallets[3]];
      const stranger = wallets[4];
      const reporterAddrs = reporters.map((w) => w.account!.address as `0x${string}`);
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());

      const message = { reqId: 1n, assetId: ASSET_WETH, price: 100n, timestamp: 1n };
      const domain = { chainId, verifyingContract: harness.address };
      const digest = buildDigest(domain, message);

      const signWith = async (wallet: (typeof wallets)[number]): Promise<Hex> =>
        signPrice(wallet, wallet.account!.address, domain, message);

      return { reporters, reporterAddrs, stranger, harness, digest, signWith };
    };

    it("returns true with exactly threshold valid signatures (2-of-3)", async () => {
      const conn = await network.connect();
      const { reporters, reporterAddrs, harness, digest, signWith } = await buildSigners(conn);

      const sigs = [await signWith(reporters[0]), await signWith(reporters[1])];
      expect(await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n])).to.equal(true);
    });

    it("returns true with surplus signatures (3-of-3 when threshold is 2)", async () => {
      const conn = await network.connect();
      const { reporters, reporterAddrs, harness, digest, signWith } = await buildSigners(conn);

      const sigs = [await signWith(reporters[0]), await signWith(reporters[1]), await signWith(reporters[2])];
      expect(await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n])).to.equal(true);
    });

    it("returns false when threshold is zero", async () => {
      const conn = await network.connect();
      const { reporterAddrs, harness, digest } = await buildSigners(conn);
      expect(await harness.read.verifySignatures([digest, [], reporterAddrs, 0n])).to.equal(false);
    });

    it("returns false when signatures.length < threshold", async () => {
      const conn = await network.connect();
      const { reporters, reporterAddrs, harness, digest, signWith } = await buildSigners(conn);
      const sigs = [await signWith(reporters[0])];
      expect(await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n])).to.equal(false);
    });

    it("ignores duplicate signatures from the same reporter (dedupe)", async () => {
      const conn = await network.connect();
      const { reporters, reporterAddrs, harness, digest, signWith } = await buildSigners(conn);
      const sig = await signWith(reporters[0]);
      // Same reporter twice — should NOT count as two distinct signers.
      expect(await harness.read.verifySignatures([digest, [sig, sig], reporterAddrs, 2n])).to.equal(false);
    });

    it("returns false when only unauthorized signers sign", async () => {
      const conn = await network.connect();
      const { reporterAddrs, stranger, harness, digest, signWith } = await buildSigners(conn);
      const sigs = [await signWith(stranger), await signWith(stranger)];
      expect(await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n])).to.equal(false);
    });

    it("skips malformed signatures without throwing", async () => {
      const conn = await network.connect();
      const { reporters, reporterAddrs, harness, digest, signWith } = await buildSigners(conn);
      const sig0 = await signWith(reporters[0]);
      const malformed = "0x1234" as Hex; // too short
      // Malformed BEFORE valid — forces the recovery-error `continue` branch to run.
      expect(await harness.read.verifySignatures([digest, [malformed, sig0], reporterAddrs, 1n])).to.equal(true);
    });
  });
});

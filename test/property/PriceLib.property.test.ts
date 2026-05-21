import { expect } from "chai";
import fc from "fast-check";
import { network } from "hardhat";
import { keccak256, toBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { buildDigest, signPrice, type PriceMessage } from "../helpers/eip712.js";

const ASSET_WETH = keccak256(toBytes("WETH/USD"));

const PROPERTY_RUNS = 1_000;

describe("PriceLib (property-based)", () => {
  describe("buildDigest", () => {
    it("matches off-chain hashTypedData over random inputs", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: (1n << 80n) - 1n }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.bigInt({ min: -(1n << 200n), max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }),
          async (reqId, assetBytes, price, ts) => {
            const assetHex = `0x${Buffer.from(assetBytes).toString("hex")}` as Hex;
            const onChain = await harness.read.buildDigest([reqId, assetHex, price, ts, chainId, harness.address]);
            const offChain = buildDigest(
              { chainId, verifyingContract: harness.address },
              { reqId, assetId: assetHex, price, timestamp: ts },
            );
            return onChain === offChain;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it("distinct inputs produce distinct digests (collision resistance within sampled space)", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: 1n << 64n }),
          fc.bigInt({ min: 0n, max: 1n << 64n }),
          fc.bigInt({ min: 0n, max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: 1n << 200n }),
          async (reqA, reqB, pA, pB) => {
            fc.pre(reqA !== reqB || pA !== pB);
            const dA = await harness.read.buildDigest([reqA, ASSET_WETH, pA, 0n, 1n, harness.address]);
            const dB = await harness.read.buildDigest([reqB, ASSET_WETH, pB, 0n, 1n, harness.address]);
            return dA !== dB;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  });

  describe("scaleTo", () => {
    it("round-trips for non-shrinking pairs (dstDecimals >= srcDecimals)", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: -(1n << 64n), max: 1n << 64n }),
          fc.integer({ min: 0, max: 18 }),
          fc.integer({ min: 0, max: 30 }),
          async (value, srcDec, dstDec) => {
            const src = srcDec;
            const dst = Math.max(src, dstDec);
            const scaled = await harness.read.scaleTo([value, src, dst]);
            const factor = 10n ** BigInt(dst - src);
            return scaled === value * factor;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it("scaling down is the inverse of scaling up when no truncation occurs", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: -(1n << 60n), max: 1n << 60n }),
          fc.integer({ min: 0, max: 18 }),
          fc.integer({ min: 0, max: 12 }),
          async (value, srcDec, addedDec) => {
            const up = await harness.read.scaleTo([value, srcDec, srcDec + addedDec]);
            const down = await harness.read.scaleTo([up, srcDec + addedDec, srcDec]);
            return down === value;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  });

  describe("verifySignatures", () => {
    it("never passes with sigs only from unauthorized signers", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const reporterAddrs = [
        wallets[1].account!.address,
        wallets[2].account!.address,
        wallets[3].account!.address,
      ] as `0x${string}`[];
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());
      const message: PriceMessage = { reqId: 1n, assetId: ASSET_WETH, price: 1n, timestamp: 1n };
      const domain = { chainId, verifyingContract: harness.address };
      const digest = buildDigest(domain, message);

      const accountCache = new Map<string, PrivateKeyAccount>();

      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (k1, k2, k3) => {
            const make = (bytes: Uint8Array): PrivateKeyAccount => {
              const key = `0x${Buffer.from(bytes).toString("hex")}`;
              if (accountCache.has(key)) return accountCache.get(key)!;
              try {
                const acct = privateKeyToAccount(key as Hex);
                if (reporterAddrs.some((a) => a.toLowerCase() === acct.address.toLowerCase())) {
                  // Vanishingly unlikely collision with hardhat signers — skip this case.
                  return privateKeyToAccount(generatePrivateKey());
                }
                accountCache.set(key, acct);
                return acct;
              } catch {
                return privateKeyToAccount(generatePrivateKey());
              }
            };

            const a1 = make(k1);
            const a2 = make(k2);
            const a3 = make(k3);

            const sig = async (acct: PrivateKeyAccount): Promise<Hex> =>
              acct.signTypedData({
                domain: {
                  name: "LIGHTHOUSE_V1",
                  version: "1",
                  chainId: Number(chainId),
                  verifyingContract: harness.address,
                },
                types: {
                  Price: [
                    { name: "reqId", type: "uint256" },
                    { name: "assetId", type: "bytes32" },
                    { name: "price", type: "int256" },
                    { name: "timestamp", type: "uint256" },
                  ],
                },
                primaryType: "Price",
                message,
              });

            const sigs = [await sig(a1), await sig(a2), await sig(a3)];
            const ok = await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n]);
            return ok === false;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it("authorized M-of-N sigs over the canonical digest always pass", async () => {
      const conn = await network.connect();
      const harness = await conn.viem.deployContract("PriceLibHarness", []);
      const wallets = await conn.viem.getWalletClients();
      const reporters = [wallets[1], wallets[2], wallets[3]];
      const reporterAddrs = reporters.map((w) => w.account!.address as `0x${string}`);
      const pub = await conn.viem.getPublicClient();
      const chainId = BigInt(await pub.getChainId());

      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: 1n << 64n }),
          fc.bigInt({ min: -(1n << 200n), max: 1n << 200n }),
          fc.bigInt({ min: 0n, max: 1n << 32n }),
          async (reqId, price, ts) => {
            const message: PriceMessage = { reqId, assetId: ASSET_WETH, price, timestamp: ts };
            const domain = { chainId, verifyingContract: harness.address };
            const digest = buildDigest(domain, message);

            // Two random distinct reporters
            const idxA = Number(reqId % 3n);
            const idxB = (idxA + 1) % 3;
            const sigs = await Promise.all([
              signPrice(reporters[idxA], reporters[idxA].account!.address, domain, message),
              signPrice(reporters[idxB], reporters[idxB].account!.address, domain, message),
            ]);

            const ok = await harness.read.verifySignatures([digest, sigs, reporterAddrs, 2n]);
            return ok === true;
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  });
});

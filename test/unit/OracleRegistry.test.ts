import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, keccak256, toBytes, zeroAddress, zeroHash } from "viem";

import { lower } from "../helpers/address.js";

const ASSET_WETH = keccak256(toBytes("WETH/USD"));
const ASSET_WBTC = keccak256(toBytes("WBTC/USD"));

describe("OracleRegistry", () => {
  it("constructor: sets owner", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    expect(lower(await reg.read.owner())).to.equal(lower(wallets[0].account!.address));
  });

  it("registerAsset: registers new asset and emits AssetRegistered", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    const agg = wallets[1].account!.address;

    await conn.viem.assertions.emitWithArgs(reg.write.registerAsset([ASSET_WETH, agg]), reg, "AssetRegistered", [
      ASSET_WETH,
      getAddress(agg),
    ]);

    expect(lower(await reg.read.getAggregator([ASSET_WETH]))).to.equal(lower(agg));
    expect(await reg.read.listAssets()).to.deep.equal([ASSET_WETH]);
  });

  it("registerAsset: updates existing asset and emits AssetUpdated (not AssetRegistered)", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    const agg1 = wallets[1].account!.address;
    const agg2 = wallets[2].account!.address;

    await reg.write.registerAsset([ASSET_WETH, agg1]);

    await conn.viem.assertions.emitWithArgs(reg.write.registerAsset([ASSET_WETH, agg2]), reg, "AssetUpdated", [
      ASSET_WETH,
      getAddress(agg1),
      getAddress(agg2),
    ]);

    expect(lower(await reg.read.getAggregator([ASSET_WETH]))).to.equal(lower(agg2));
    // listAssets remains length 1
    expect(await reg.read.listAssets()).to.deep.equal([ASSET_WETH]);
  });

  it("registerAsset: tracks insertion order across multiple assets", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);

    await reg.write.registerAsset([ASSET_WETH, wallets[1].account!.address]);
    await reg.write.registerAsset([ASSET_WBTC, wallets[2].account!.address]);

    expect(await reg.read.listAssets()).to.deep.equal([ASSET_WETH, ASSET_WBTC]);
  });

  it("registerAsset: reverts on zero asset id", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    await conn.viem.assertions.revertWithCustomError(
      reg.write.registerAsset([zeroHash, wallets[1].account!.address]),
      reg,
      "ZeroAssetId",
    );
  });

  it("registerAsset: reverts on zero aggregator", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    await conn.viem.assertions.revertWithCustomError(
      reg.write.registerAsset([ASSET_WETH, zeroAddress]),
      reg,
      "ZeroAggregator",
    );
  });

  it("registerAsset: rejects non-owner caller", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    const strangerReg = await conn.viem.getContractAt("OracleRegistry", reg.address, {
      client: { wallet: wallets[2] },
    });
    await conn.viem.assertions.revertWithCustomError(
      strangerReg.write.registerAsset([ASSET_WETH, wallets[1].account!.address]),
      strangerReg,
      "OwnableUnauthorizedAccount",
    );
  });

  it("getAggregator: returns zero address for unknown asset", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    expect(await reg.read.getAggregator([ASSET_WETH])).to.equal(zeroAddress);
  });

  it("listAssets: empty initially", async () => {
    const conn = await network.connect();
    const wallets = await conn.viem.getWalletClients();
    const reg = await conn.viem.deployContract("OracleRegistry", [wallets[0].account!.address]);
    expect(await reg.read.listAssets()).to.deep.equal([]);
  });
});

import { keccak256, toBytes, type Hex, type WalletClient } from "viem";
import type { network } from "hardhat";

export type NetworkConnection = Awaited<ReturnType<typeof network.connect>>;

export const DEFAULT_DECIMALS = 8;
export const DEFAULT_VERSION = 1n;
export const DEFAULT_FEE = 1_000_000_000_000_000n; // 0.001 ether
export const WETH_ASSET_ID: Hex = keccak256(toBytes("WETH/USD"));

export interface DeployedSystem {
  reporterSet: `0x${string}`;
  registry: `0x${string}`;
  aggregator: `0x${string}`;
  consumer: `0x${string}`;
  owner: WalletClient;
  ownerAddress: `0x${string}`;
  reporters: WalletClient[];
  reporterAddresses: `0x${string}`[];
  user: WalletClient;
  userAddress: `0x${string}`;
  threshold: bigint;
  assetId: Hex;
  fee: bigint;
  chainId: bigint;
}

/// Deploy a fully wired system: ReporterSet (3 signers, 2-of-3) + OracleRegistry +
/// PriceAggregator + PriceConsumer, with the asset registered in the registry.
export async function deploySystem(conn: NetworkConnection): Promise<DeployedSystem> {
  const wallets = await conn.viem.getWalletClients();
  const owner = wallets[0];
  const r1 = wallets[1];
  const r2 = wallets[2];
  const r3 = wallets[3];
  const user = wallets[4];

  const ownerAddress = owner.account!.address;
  const reporterAddresses: `0x${string}`[] = [r1.account!.address, r2.account!.address, r3.account!.address];
  const reporters = [r1, r2, r3];
  const userAddress = user.account!.address;
  const threshold = 2n;

  const reporterSet = await conn.viem.deployContract("ReporterSet", [ownerAddress, reporterAddresses, threshold]);

  const registry = await conn.viem.deployContract("OracleRegistry", [ownerAddress]);

  const aggregator = await conn.viem.deployContract("PriceAggregator", [
    ownerAddress,
    reporterSet.address,
    WETH_ASSET_ID,
    DEFAULT_DECIMALS,
    "WETH/USD - Lighthouse demo",
    DEFAULT_VERSION,
    DEFAULT_FEE,
  ]);

  await registry.write.registerAsset([WETH_ASSET_ID, aggregator.address]);

  const consumer = await conn.viem.deployContract("PriceConsumer", [aggregator.address]);

  const pub = await conn.viem.getPublicClient();
  const chainId = BigInt(await pub.getChainId());

  return {
    reporterSet: reporterSet.address,
    registry: registry.address,
    aggregator: aggregator.address,
    consumer: consumer.address,
    owner,
    ownerAddress,
    reporters,
    reporterAddresses,
    user,
    userAddress,
    threshold,
    assetId: WETH_ASSET_ID,
    fee: DEFAULT_FEE,
    chainId,
  };
}

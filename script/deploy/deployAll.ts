// End-to-end deployment of the contract stack onto Ethereum Sepolia.
//
// Flow:
//   1. Ensure 3 reporter keypairs exist on disk (generated if missing).
//   2. Deploy ReporterSet(owner = deployer, reporters, threshold = 2).
//   3. Deploy OracleRegistry(owner = deployer).
//   4. For each of 10 assets: deploy PriceAggregator, then call
//      OracleRegistry.registerAsset(assetId, aggregator).
//   5. Persist addresses to deployments/ethereum-sepolia/addresses.json.
//   6. Copy compiled ABIs to deployments/ethereum-sepolia/abis/.
//
// Idempotency: re-running redeploys (Hardhat doesn't cache addresses). If you
// need a resumable deploy, switch to Hardhat Ignition. For this 12-contract
// run a plain script is faster.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";
import type { Hex } from "viem";

import { ASSETS } from "../../config/assets.js";
import { ensureReporters } from "./generateReporters.js";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ARTIFACTS_DIR = join(REPO_ROOT, "artifacts", "src");
const OUT_DIR = join(REPO_ROOT, "deployments", "ethereum-sepolia");
const ABI_DIR = join(OUT_DIR, "abis");

const THRESHOLD = 2n;
const VERSION = 1n;
const REQUEST_FEE = 0n;

interface AggregatorRecord {
  symbol: string;
  description: string;
  decimals: number;
  assetId: Hex;
  address: `0x${string}`;
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: `0x${string}`;
  reporterSet: `0x${string}`;
  reporterAddresses: `0x${string}`[];
  threshold: string;
  oracleRegistry: `0x${string}`;
  aggregators: AggregatorRecord[];
}

async function main(): Promise<void> {
  console.log("=== evm-oracle-demo-contracts :: Ethereum Sepolia deploy ===");

  if (!process.env.SEPOLIA_RPC_URL) throw new Error("missing SEPOLIA_RPC_URL");
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("missing DEPLOYER_PRIVATE_KEY");

  const { addresses: reporterAddresses } = ensureReporters();
  console.log("reporters:", reporterAddresses.join(", "));

  const conn = await network.connect({ network: "sepolia", chainType: "l1" });
  const [deployer] = await conn.viem.getWalletClients();
  const pub = await conn.viem.getPublicClient();
  const deployerAddr = deployer.account!.address;
  const chainId = await pub.getChainId();
  if (chainId !== 11155111) throw new Error(`unexpected chainId ${chainId}; expected 11155111 (Ethereum Sepolia)`);

  const balance = await pub.getBalance({ address: deployerAddr });
  console.log(`deployer: ${deployerAddr}`);
  console.log(`balance:  ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance < 30_000_000_000_000_000n) {
    throw new Error(`deployer balance below 0.03 ETH safety floor; got ${balance} wei`);
  }

  console.log("\n--- 1/3 ReporterSet ---");
  const reporterSet = await conn.viem.deployContract("ReporterSet", [
    deployerAddr,
    reporterAddresses,
    THRESHOLD,
  ]);
  console.log(`  → ${reporterSet.address}`);

  console.log("\n--- 2/3 OracleRegistry ---");
  const registry = await conn.viem.deployContract("OracleRegistry", [deployerAddr]);
  console.log(`  → ${registry.address}`);

  console.log("\n--- 3/3 PriceAggregator × 10 ---");
  const aggregators: AggregatorRecord[] = [];
  for (const asset of ASSETS) {
    process.stdout.write(`  ${asset.symbol.padEnd(5)} `);
    const aggregator = await conn.viem.deployContract("PriceAggregator", [
      deployerAddr,
      reporterSet.address,
      asset.assetId,
      asset.decimals,
      asset.description,
      VERSION,
      REQUEST_FEE,
    ]);
    process.stdout.write(`deployed ${aggregator.address} ... `);
    const registerTxHash = await registry.write.registerAsset([asset.assetId, aggregator.address]);
    // Wait for the receipt before the next deploy or the local nonce tracker
    // races the pending register and the RPC rejects with "replacement
    // transaction underpriced".
    await pub.waitForTransactionReceipt({ hash: registerTxHash });
    process.stdout.write("registered\n");
    aggregators.push({
      symbol: asset.symbol,
      description: asset.description,
      decimals: asset.decimals,
      assetId: asset.assetId,
      address: aggregator.address,
    });
  }

  const record: DeploymentRecord = {
    network: "ethereum-sepolia",
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    reporterSet: reporterSet.address,
    reporterAddresses,
    threshold: THRESHOLD.toString(),
    oracleRegistry: registry.address,
    aggregators,
  };

  writeArtifacts(record);

  console.log("\n=== summary ===");
  console.log(`reporterSet:    ${record.reporterSet}`);
  console.log(`oracleRegistry: ${record.oracleRegistry}`);
  for (const a of aggregators) {
    console.log(`  ${a.symbol.padEnd(5)} ${a.address}`);
  }
  console.log(`\nartifacts: ${OUT_DIR}/`);
}

function writeArtifacts(record: DeploymentRecord): void {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(ABI_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "addresses.json"), JSON.stringify(record, null, 2) + "\n");

  for (const contract of ["ReporterSet", "OracleRegistry", "PriceAggregator", "PriceConsumer"]) {
    const subdir = contract === "PriceConsumer" ? "consumers" : contract === "PriceAggregator" || contract === "ReporterSet" || contract === "OracleRegistry" ? "core" : "core";
    const artifactPath = join(ARTIFACTS_DIR, subdir, `${contract}.sol`, `${contract}.json`);
    if (!existsSync(artifactPath)) {
      console.warn(`[abi] missing ${artifactPath}, skipping`);
      continue;
    }
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { abi: unknown };
    writeFileSync(join(ABI_DIR, `${contract}.json`), JSON.stringify({ abi: artifact.abi }, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

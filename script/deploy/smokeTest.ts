// On-chain smoke test against the deployed system on Ethereum Sepolia.
//
// 1. Reads deployments/ethereum-sepolia/addresses.json.
// 2. Reads OracleRegistry.listAssets() — confirms 10 assets registered.
// 3. Calls PriceAggregator.requestPrice on the WETH aggregator with fee=0 —
//    confirms `PriceRequested(reqId=N, requester=deployer)` event is emitted.
// 4. Reads latestRoundData() — should revert NoRoundData (no fulfillment yet).
//    Confirms via a read attempt that catches the expected revert.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { network } from "hardhat";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DEPLOY_PATH = join(REPO_ROOT, "deployments", "ethereum-sepolia", "addresses.json");

interface AggregatorRecord {
  symbol: string;
  address: `0x${string}`;
}

interface DeploymentRecord {
  oracleRegistry: `0x${string}`;
  aggregators: AggregatorRecord[];
}

async function main(): Promise<void> {
  if (!process.env.SEPOLIA_RPC_URL) throw new Error("missing SEPOLIA_RPC_URL");
  if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("missing DEPLOYER_PRIVATE_KEY");

  const record = JSON.parse(readFileSync(DEPLOY_PATH, "utf8")) as DeploymentRecord;
  const wethAgg = record.aggregators.find((a) => a.symbol === "WETH")!;
  console.log(`registry:  ${record.oracleRegistry}`);
  console.log(`weth agg:  ${wethAgg.address}`);

  const conn = await network.connect({ network: "sepolia", chainType: "l1" });
  const pub = await conn.viem.getPublicClient();
  const [deployer] = await conn.viem.getWalletClients();

  console.log("\n--- 1/3 OracleRegistry.listAssets() ---");
  const registry = await conn.viem.getContractAt("OracleRegistry", record.oracleRegistry);
  const assets = await registry.read.listAssets();
  console.log(`  ${assets.length} assets registered`);
  if (assets.length !== 10) throw new Error(`expected 10 assets, got ${assets.length}`);

  console.log("\n--- 2/3 requestPrice on WETH aggregator ---");
  const agg = await conn.viem.getContractAt("PriceAggregator", wethAgg.address);
  const fee = await agg.read.requestFee();
  console.log(`  requestFee: ${fee}`);
  const nextReqIdBefore = await agg.read.nextReqId();
  console.log(`  nextReqId before: ${nextReqIdBefore}`);

  const txHash = await agg.write.requestPrice([], { value: fee });
  console.log(`  tx: ${txHash}`);
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  console.log(`  mined in block ${receipt.blockNumber} (gas ${receipt.gasUsed})`);

  const nextReqIdAfter = await agg.read.nextReqId();
  console.log(`  nextReqId after:  ${nextReqIdAfter}`);
  if (nextReqIdAfter !== nextReqIdBefore + 1n) {
    throw new Error(`nextReqId did not advance by 1`);
  }

  // Decode PriceRequested events from this receipt.
  const events = await agg.getEvents.PriceRequested({}, { blockHash: receipt.blockHash });
  if (events.length === 0) throw new Error("no PriceRequested event found in receipt block");
  const last = events[events.length - 1];
  console.log(`  event PriceRequested(reqId=${last.args.reqId}, requester=${last.args.requester})`);
  if (last.args.reqId !== nextReqIdAfter) {
    throw new Error(`PriceRequested.reqId (${last.args.reqId}) mismatches nextReqId (${nextReqIdAfter})`);
  }
  if (last.args.requester?.toLowerCase() !== deployer.account!.address.toLowerCase()) {
    throw new Error(`requester mismatch`);
  }

  console.log("\n--- 3/3 latestRoundData() expected to revert NoRoundData (no fulfillment yet) ---");
  let reverted = false;
  try {
    await agg.read.latestRoundData();
  } catch (err) {
    reverted = true;
    const msg = (err as Error).message;
    if (!msg.includes("NoRoundData")) {
      console.warn(`  reverted but not with NoRoundData: ${msg.split("\n")[0]}`);
    } else {
      console.log("  ok — reverted with NoRoundData");
    }
  }
  if (!reverted) throw new Error("latestRoundData did not revert");

  console.log("\n=== smoke test passed ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

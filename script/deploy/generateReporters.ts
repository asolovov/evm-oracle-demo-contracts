// Generate the 3 reporter keypairs for the initial ReporterSet.
//
// PRIVATE KEYS NEVER LEAVE LOCAL DISK. They land under `.reporters/` which is
// gitignored. The deployment script reads ONLY the addresses from here; the
// private keys travel to the VPS via secure copy when the off-chain
// `oracle-service` is provisioned (task 11).
//
// Idempotent: rerunning prints the existing addresses without regenerating.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const REPORTER_DIR = join(REPO_ROOT, ".reporters");

interface ReporterFile {
  index: number;
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

function reporterPath(index: number): string {
  return join(REPORTER_DIR, `reporter${index}.json`);
}

export function ensureReporters(): { addresses: `0x${string}`[] } {
  if (!existsSync(REPORTER_DIR)) {
    mkdirSync(REPORTER_DIR, { recursive: true, mode: 0o700 });
  }

  const addresses: `0x${string}`[] = [];
  for (let i = 1; i <= 3; ++i) {
    const path = reporterPath(i);
    if (existsSync(path)) {
      const existing = JSON.parse(readFileSync(path, "utf8")) as ReporterFile;
      addresses.push(existing.address);
      continue;
    }
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const data: ReporterFile = { index: i, address: account.address, privateKey: pk };
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    addresses.push(account.address);
    console.log(`[reporters] generated reporter${i} → ${account.address}`);
  }
  return { addresses };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { addresses } = ensureReporters();
  console.log("[reporters] addresses:");
  addresses.forEach((a, i) => console.log(`  reporter${i + 1}: ${a}`));
  console.log(`[reporters] private keys saved at ${REPORTER_DIR}/reporter{1,2,3}.json (0600, gitignored)`);
}

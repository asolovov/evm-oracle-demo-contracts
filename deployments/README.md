# Deployments

Each subdirectory holds the artefacts for one network deployment:

| File / dir | Source of truth | Consumed by |
|------------|-----------------|-------------|
| `addresses.json` | written by `script/deploy/deployAll.ts` | off-chain services + frontend at build/run time |
| `abis/*.json` | copied from `artifacts/src/**` at deploy time | off-chain services (Go: `protobuf-loaded`; TS: viem `getContract`) |
| `.verify-args/` | written by `script/deploy/verifyAll.sh` | local-only, gitignored |

## How to bump a deployment

1. **From scratch.** Wipe the network's directory, regenerate keys (`script/deploy/generateReporters.ts`), run `script/deploy/deployAll.ts`, then `script/deploy/verifyAll.sh`. Commit the new `addresses.json` + `abis/`.
2. **Single-asset re-add (e.g. aggregator bug fix).** Easier to redeploy the whole stack — `OracleRegistry.registerAsset` accepts overwrites and emits `AssetUpdated`. Document in CHANGELOG which asset's aggregator moved and the new address; downstream services may need a config refresh.

## Networks

### `ethereum-sepolia/`

- Chain id: 11155111
- Deployer: see `addresses.json#deployer`
- Block explorer: <https://sepolia.etherscan.io/>
- Initial deploy: 2026-05-26 — first live testnet snapshot for the demo.

The reporter set (3 EOAs, threshold 2-of-3) was generated locally and saved to `.reporters/` (gitignored). Private keys never enter the repo or any remote system; they move to the VPS via secure copy when `oracle-service` is provisioned in task 11.

## Audit lineage

Contracts deployed from `feat/deploy-sepolia` branched off `feat/internal-audit-v1`, which carries both Medium remediations (M-01 monotonic-`startedAt` gate; M-02 `SafeCast.toInt256` in `PriceLib.scaleTo`). See `audit/reports/internal-audit-v1.md`.

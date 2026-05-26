# Changelog

All notable changes to `evm-oracle-demo-contracts` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Deployed

- **Ethereum Sepolia** (chain id 11155111, deployer
  `0xCEf4FE1CA9071f4ed4baD6c1087CEb08838A983E`, 2026-05-26): 12 contracts —
  `ReporterSet` (2-of-3, three freshly-generated reporter EOAs),
  `OracleRegistry`, and 10 `PriceAggregator` instances (WETH, WBTC, LINK,
  UNI, AAVE, XAU, XAG, SPX, WTI, HG), each with `decimals = 8`, `version = 1`,
  `requestFee = 0`, and `maxAge = type(uint256).max` (demo default). All 12
  contracts verified on Etherscan; smoke test passed (10 assets resolved
  through the registry; `requestPrice` on WETH emitted
  `PriceRequested(reqId=1, requester=deployer)`). Addresses + ABIs committed
  to `deployments/ethereum-sepolia/`.

### Added

- `script/deploy/{generateReporters.ts, deployAll.ts, smokeTest.ts,
  verifyAll.sh}` — reproducible deployment + verification + smoke-test
  pipeline.
- `config/assets.ts` — canonical 10-asset metadata table consumed by the
  deploy script and downstream services.
- `deployments/README.md` — entry point for the deployments tree;
  documents the bump procedure.

### Changed

- `hardhat.config.ts` adds an Ethereum Sepolia network entry (`type: "http"`,
  `chainType: "l1"`, `chainId: 11155111`) gated on `SEPOLIA_RPC_URL` +
  `DEPLOYER_PRIVATE_KEY` env vars, and an Etherscan verify config gated on
  `SEPOLIA_ETHERSCAN_API_KEY`.
- `.gitignore` excludes `.reporters/` (per-deployment reporter private keys)
  and `deployments/*/.verify-args/` (transient `--constructor-args-path`
  modules).

### Security

- **M-01 (Medium) fix** — Heartbeat replay closed in `PriceAggregator.fulfillPrice`.
  Added a monotonic-`startedAt` gate: any new submission must carry a
  `timestamp` strictly greater than `_rounds[latestRoundId].startedAt`. New
  custom error `StaleTimestamp(submittedAt, latestStartedAt)` exposes the
  trigger. The gate fires independently of `maxAge`, so the demo-permissive
  default (`maxAge = type(uint256).max`) is no longer a replay vector. See
  `audit/findings.md#M-01`.
- **M-02 (Medium) fix** — `PriceLib.scaleTo` silent sign-flip on
  `int256(10 ** 77)` closed. Both magnitude casts now go through
  `SafeCast.toInt256`, which reverts with `SafeCastOverflowedUintToInt(value)`
  when the value exceeds `int256.max`. See `audit/findings.md#M-02`.

### Added

- **`PriceLib`** — pure library exposing EIP-712 digest construction
  (`LIGHTHOUSE_V1` domain, `abi.encode`-only struct + domain hashing), M-of-N
  ECDSA signature verification with dedupe + short-circuit, and safe `int256`
  decimals scaling.
- **`ReporterSet`** — `Ownable2Step` registry of authorized reporters with
  bounded `addReporter` / `removeReporter` / `setThreshold` and `ReporterAdded` /
  `ReporterRemoved` / `ThresholdChanged` events. Swap-pop removal maintains the
  `address[]` canonical ordering. Constructor accepts an initial set + threshold.
- **`PriceAggregator`** — per-asset feed, ABI-compatible with Chainlink's
  `AggregatorV3Interface`. `requestPrice` is `nonReentrant` and refunds the
  exact excess fee; `fulfillPrice` verifies M-of-N reporter signatures over an
  EIP-712 digest that includes `chainId` + aggregator address, records a new
  round, and emits `PriceFulfilled`. `reqId == 0` is reserved as a heartbeat
  sentinel and is exempt from the per-reqId replay guard. `maxAge` defaults to
  `type(uint256).max` (demo-permissive) and can be tightened by the owner.
- **`OracleRegistry`** — `Ownable2Step` `assetId → aggregator` directory.
  Insertion order preserved in `listAssets`; distinct `AssetRegistered` and
  `AssetUpdated` events on first registration vs. repointing.
- **`PriceConsumer`** — concrete reference consumer that forwards
  `requestPrice` to the aggregator, captures the assigned `reqId`, and relays
  the refund back to the original caller.
- **Tests** — 77 total (71 from task 03 + 6 audit regression tests). The
  audit suite (Mocha + viem + chai): 60 unit tests across the four
  contracts (using a `PriceLibHarness` for the internal-library entry points),
  3 integration tests covering the full
  `PriceConsumer → fulfillPrice → consumer reads` cycle, and 7 property-based
  tests via `fast-check` (1,000 runs each on the pure paths; 100 runs on the
  fee-refund property that sends real EDR transactions). Audit regression
  tests under `test/audit/` assert that the M-01 and M-02 remediations hold
  against the originally-exploitable scenarios.
- **`audit/` tree** — full deliverables of internal-audit-v1:
  `findings.md`, `THREAT_MODEL.md`, `CHECKLIST.md`,
  `reports/internal-audit-v1.md`, `reports/access-control-matrix.md`,
  `reports/storage-layouts.md`, raw `slither-v1.txt` and `coverage-v1.txt`
  captures, plus the regression PoCs under `test/audit/`. Report status:
  `draft`, awaiting human peer sign-off; 0 Critical / 0 High; 2 Medium
  (both remediated); 3 Low (open); 7 Informational (accepted).
- **Coverage tooling** — `npx hardhat test mocha --coverage` reports 100% line
  + statement coverage on `src/core/` and `src/libs/`.
- **Slither** — `slither-all.sol` aggregator file + `scripts/run-slither.sh`
  helper to run Slither against standalone solc (working around the
  Hardhat-v3 / crytic-compile 0.3.x incompatibility). CI's `slither` job is
  now blocking. Findings: zero; six intentional patterns documented and
  suppressed with NatSpec rationale.

### Changed

- CI `slither` job is now blocking (was non-blocking, baseline-only in `0.1.0`).
- CI / package `engines` already require Node ≥ 22.13.0 (Hardhat v3 floor).

### Removed

- Scaffold-only `test/scaffold.test.ts` (replaced by the unit / integration /
  property suites under `test/unit/`, `test/integration/`, `test/property/`).

## [0.1.0] — 2026-05-15

### Added

- Initial Hardhat v3 + viem + Mocha scaffold (no Foundry, no `node:test`).
- Solidity 0.8.24 pinned uniformly; SPDX MIT on every `.sol`.
- Source tree per spec: `src/interfaces/`, `src/core/` (abstract stubs),
  `src/libs/PriceLib.sol` (stub), `src/consumers/PriceConsumer.sol` (stub).
- Interface contracts (`IAggregatorV3`, `ILighthouseAggregator`,
  `IOracleRegistry`, `IReporterSet`) with full NatSpec.
- Solhint + Prettier + baseline Slither config.
- SHA-pinned GitHub Actions CI: `compile`, `test`, `solhint` blocking;
  `slither` non-blocking baseline.
- MIT `LICENSE`; README with author credentials footer.

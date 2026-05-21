# Changelog

All notable changes to `evm-oracle-demo-contracts` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Tests** — 71 total (Mocha + viem + chai): 60 unit tests across the four
  contracts (using a `PriceLibHarness` for the internal-library entry points),
  3 integration tests covering the full
  `PriceConsumer → fulfillPrice → consumer reads` cycle, and 7 property-based
  tests via `fast-check` (1,000 runs each on the pure paths; 100 runs on the
  fee-refund property that sends real EDR transactions).
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

# uw-oracle-contracts

[![CI](https://github.com/asolovov/uw-oracle-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/asolovov/uw-oracle-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://docs.soliditylang.org/en/v0.8.24/)

> Pull-based, multi-source price oracle for crypto + RWA assets. Chainlink `AggregatorV3Interface`-compatible.

Solidity component of **Lighthouse Oracle** — a portfolio demo covering the
full senior-blockchain-engineer stack on a single self-hosted VPS (Solidity +
Go microservices + Next.js dashboard + multi-source aggregation + signed
price submission + deployable infra).

The live demo aggregates 10 assets (5 crypto, 5 RWA) on Base Sepolia and
Optimism Sepolia from three independent free-tier sources per asset class,
submits prices via 2-of-3 reporter signatures, and exposes everything through
a public REST/WebSocket API and a Next.js dashboard.

## Status

**Scaffold only.** This repo currently contains the build toolchain,
interface contracts, and stub implementations. Core logic (signature
verification, fulfillment, reporter management, registry) lands in
[task 03](https://github.com/asolovov/uw-oracle-contracts/issues?q=task-03).

## Stack

- **Solidity 0.8.24** — pinned uniformly across every `.sol` file.
- **Hardhat v3** with `@nomicfoundation/hardhat-toolbox-viem` — compile, test, deploy.
- **Mocha + chai + fast-check** — unit, integration, and property-based tests.
- **OpenZeppelin Contracts v5** (MIT) — `Ownable2Step`, `ReentrancyGuard`.
- **@chainlink/contracts v1** (MIT) — `AggregatorV3Interface` import **only**.
  This project does NOT fork Chainlink. Implementation is original.
- **Solhint + Prettier + Slither** — lint, format, static analysis (Slither becomes blocking in task 03).

## Repository layout

```
src/
  interfaces/
    IAggregatorV3.sol          # re-export of Chainlink's interface
    ILighthouseAggregator.sol  # extended pull-oracle interface
    IOracleRegistry.sol
    IReporterSet.sol
  core/
    PriceAggregator.sol        # stub — task 03
    OracleRegistry.sol         # stub — task 03
    ReporterSet.sol            # stub — task 03
  consumers/
    PriceConsumer.sol          # minimal example consumer
  libs/
    PriceLib.sol               # stub — task 03
test/
script/
  deploy/
```

## Getting started

```sh
git clone https://github.com/asolovov/uw-oracle-contracts.git
cd uw-oracle-contracts
npm ci
cp .env.example .env

npx hardhat compile
npx hardhat test mocha
npm run lint
```

Optional static analysis (requires Python + `pip install slither-analyzer`):

```sh
npm run slither
```

## Security notes

- This is a **demo**, not a production oracle. See the parent project's spec
  for the full list of demo-vs-production simplifications.
- Reporter keys live on disk on a single VPS in the live deployment. In
  production they would be split across independent operators and held in
  Vault / KMS / HSM.
- Submission age is recorded but **not gating** by default. A `strict`
  toggle exists in code so the same path can run with production semantics.

## License

[MIT](./LICENSE).

`@chainlink/contracts` and `@openzeppelin/contracts` are imported under MIT
and remain the property of their respective authors.

---

## Built by Andrei Solovov

Senior blockchain engineer — Solidity, Go, EVM infrastructure.

- LinkedIn — <https://www.linkedin.com/in/andrei-solovov/>
- GitHub — <https://github.com/asolovov>
- Source — <https://github.com/asolovov/uw-oracle-contracts>
- Upwork — rendered on the live dashboard `/about` page when `NEXT_PUBLIC_UPWORK_URL` is configured.

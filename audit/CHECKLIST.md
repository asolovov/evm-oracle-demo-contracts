# Peer self-review checklist — internal-audit-v1

Per task 03.1 step 8. One row per check × per concrete contract. Mark each
PASS / FAIL / N/A with one-line rationale.

Legend:
- **PASS** — meets the criterion.
- **FAIL** — criterion not met. Cross-reference a finding in `findings.md`.
- **N/A** — does not apply to this contract.

## PriceAggregator (`src/core/PriceAggregator.sol`)

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Constructor disables initializers | N/A | Non-upgradeable contract; no proxy pattern. |
| 2 | All public/external functions have explicit visibility + NatSpec | PASS | Every entry has `external`/`public` + `///` block; inheritDoc on interface methods. |
| 3 | Custom errors used consistently; no bare `require(false)` | PASS | Six custom errors declared; no `require` in the contract body. |
| 4 | No `tx.origin` usage | PASS | grep clean. |
| 5 | No unbounded loops over user-supplied arrays | PASS | The only loop (in `PriceLib.verifySignatures`) is bounded by `signatures.length` and self-griefing. |
| 6 | No `delegatecall` to user-supplied addresses | PASS | grep clean. |
| 7 | Events emitted on every state change | PASS | `PriceRequested`, `PriceFulfilled`, `RequestFeeChanged`, `MaxAgeChanged`, `ReporterSetChanged`. |
| 8 | Overflow / underflow checked (default in `^0.8.24`); `unchecked` blocks NatSpec-commented | PASS | Two `unchecked` blocks: `reqId = ++nextReqId` and `refund = msg.value - fee`. Both safe by surrounding-check construction. Third in fulfill: `newRoundId = latestRoundId + 1` is unchecked; `uint80` wrap acknowledged in I-02. |
| 9 | Owner-authority surface clearly bounded | PASS | Only three owner-only setters; each bounded in scope (fee / maxAge / reporter set). Documented in matrix. |
| 10 | `@author Andrei Solovov <https://github.com/asolovov>` on every top-level contract | PASS | line 13. |
| 11 | Reentrancy guard on every value-receiving / external-call function | PARTIAL | `requestPrice` is `nonReentrant`. `fulfillPrice` is not — it does external `IReporterSet` calls but the set is owner-trusted; no value transfer. Acceptable per design. |
| 12 | Replay protection on every consumer-driven submission | PASS / FAIL | Consumer-driven (`reqId != 0`): PASS (`fulfilled[reqId]`). Heartbeat (`reqId == 0`): FAIL — see M-01. |
| 13 | EIP-712 domain separator includes chainId + verifyingContract | PASS | Both baked into `PriceLib.buildDigest`. |

## OracleRegistry (`src/core/OracleRegistry.sol`)

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Constructor disables initializers | N/A | Non-upgradeable. |
| 2 | All public/external functions have explicit visibility + NatSpec | PASS | Three external functions, all documented. |
| 3 | Custom errors used consistently; no bare `require(false)` | PASS | `ZeroAggregator`, `ZeroAssetId`. |
| 4 | No `tx.origin` usage | PASS | grep clean. |
| 5 | No unbounded loops over user-supplied arrays | PASS | No loops. |
| 6 | No `delegatecall` to user-supplied addresses | PASS | grep clean. |
| 7 | Events emitted on every state change | PASS | `AssetRegistered` / `AssetUpdated`. |
| 8 | Overflow / underflow | PASS | No arithmetic. |
| 9 | Owner-authority surface clearly bounded | PASS | One owner-only setter (`registerAsset`). |
| 10 | `@author` tag | PASS | line 10. |
| 11 | Reentrancy guards | N/A | No external calls / value transfers. |

## ReporterSet (`src/core/ReporterSet.sol`)

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Constructor disables initializers | N/A | Non-upgradeable. |
| 2 | All public/external functions have explicit visibility + NatSpec | PASS | Six external functions documented. |
| 3 | Custom errors used consistently; no bare `require(false)` | PASS | Five custom errors. |
| 4 | No `tx.origin` usage | PASS | grep clean. |
| 5 | No unbounded loops over user-supplied arrays | PASS | Constructor loops over `initialReporters` but only owner-supplied at deploy; not a runtime DoS vector. |
| 6 | No `delegatecall` | PASS | grep clean. |
| 7 | Events emitted on every state change | PASS | `ReporterAdded`, `ReporterRemoved`, `ThresholdChanged`. |
| 8 | Overflow / underflow | PASS | Three `unchecked` blocks (`removedIdx = indexPlusOne - 1` + two `diff` calcs in PriceLib — wait, PriceLib is separate). In ReporterSet itself: `removedIdx = indexPlusOne - 1`. Safe: guarded by `_isReporter` precheck that ensures `indexPlusOne >= 1`. |
| 9 | Owner-authority surface clearly bounded | PASS | Three owner-only mutators (add / remove / setThreshold). |
| 10 | `@author` tag | PASS | line 10. |
| 11 | Reentrancy guards | N/A | No external calls. |
| 12 | Empty-deploy footgun documented | PARTIAL | NatSpec mentions the path; L-02 flags the latent dormant-state surface. |

## PriceLib (`src/libs/PriceLib.sol`)

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Constructor disables initializers | N/A | Stateless library. |
| 2 | All internal functions have NatSpec | PASS | `buildDigest`, `verifySignatures`, `scaleTo` documented. Private helpers `_contains` lightly documented. |
| 3 | Custom errors used consistently | N/A | Library returns booleans / values rather than reverting. |
| 4 | No `tx.origin` | PASS | grep clean. |
| 5 | No unbounded loops over user-supplied arrays | PARTIAL | `verifySignatures` loops over `signatures` and `authorizedReporters`; self-griefing surface only — filed as I-04. |
| 6 | No `delegatecall` | PASS | grep clean. |
| 7 | Events | N/A | Pure library. |
| 8 | Overflow / underflow | FAIL | `int256(10 ** diff)` cast for `diff == 77` produces a negative value via two's-complement reinterpretation. Filed as M-02. |
| 9 | Owner-authority | N/A | No storage. |
| 10 | `@author` tag | PASS | line 8. |
| 11 | Reentrancy | N/A | Pure / view. |
| 12 | EIP-712 conformance | PASS | Domain typehash, struct typehash, `abi.encode` not `encodePacked`, MessageHashUtils. |

## PriceConsumer (`src/consumers/PriceConsumer.sol`)

| # | Check | Result | Note |
|---|-------|--------|------|
| 1 | Constructor disables initializers | N/A | Non-upgradeable. |
| 2 | All public/external functions have explicit visibility + NatSpec | PASS | `requestPrice`, `latestAnswer`, `receive` documented. |
| 3 | Custom errors used consistently | PASS | `RefundForwardFailed`. |
| 4 | No `tx.origin` | PASS | grep clean. |
| 5 | No unbounded loops | PASS | No loops. |
| 6 | No `delegatecall` | PASS | grep clean. |
| 7 | Events | N/A | Demo consumer; no state worth eventing. |
| 8 | Overflow / underflow | PASS | One subtraction: `address(this).balance - msg.value`. Safe because balance includes `msg.value` (just-arrived ETH). |
| 9 | Owner-authority | N/A | No owner. |
| 10 | `@author` tag | PASS | line 8. |
| 11 | Reentrancy guards | FAIL | Filed as L-03. The aggregator's guard protects aggregator state; the consumer itself has no guard but also no exploitable state. |

## Coverage cross-check

- `src/core/PriceAggregator.sol` — 100% line / 100% statement.
- `src/core/OracleRegistry.sol` — 100% / 100%.
- `src/core/ReporterSet.sol` — 100% / 100%.
- `src/libs/PriceLib.sol` — 100% / 100%.
- `src/consumers/PriceConsumer.sol` — 88.89% / 90.91% (line 48 `RefundForwardFailed` revert not exercised; per task brief, the demo consumer is exempt from the 100% requirement).

## Slither cross-check

`npm run slither` → 0 result(s) found. The six historical suppressions
(`slither-disable-next-line ...`) were re-walked individually; rationales hold
(see `findings.md` "Suppressions verification" section).

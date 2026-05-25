# Threat Model — internal-audit-v1

Scope: `src/core/{PriceAggregator,OracleRegistry,ReporterSet}.sol`,
`src/libs/PriceLib.sol`, `src/consumers/PriceConsumer.sol`. Test-only contracts
under `src/test/` are out of scope.

## 1. Actors

| Actor | Capability | Trust assumption |
|-------|-----------|------------------|
| Anonymous consumer (EOA) | Calls `requestPrice` (pays fee), reads round data via `IAggregatorV3`. | Untrusted. |
| Honest consumer contract | Same surface as anonymous, plus may relay refunds to its caller (per `PriceConsumer`). | Untrusted-but-cooperative for its own users. |
| Malicious consumer contract | Same surface, plus may attempt reentrancy on refund callback, can pre-fund itself with ETH. | Untrusted. |
| Authorized reporter (off-chain) | Signs price submissions over the EIP-712 digest. Does not transact on-chain in this design. | Mostly-trusted (M-of-N quorum tolerates `N − M` compromise). |
| Compromised single reporter | Same key material but adversarial. | Tolerated up to `N − M = 1` for default 2-of-3. |
| Compromised reporter quorum (≥ M) | Can sign arbitrary `(reqId, assetId, price, timestamp)` triples. | Outside the trust model — break of the M-of-N assumption. |
| `PriceAggregator` owner | Calls `setRequestFee`, `setMaxAge`, `setReporterSet`, `transferOwnership`, `renounceOwnership`. | Trusted. |
| `OracleRegistry` owner | Calls `registerAsset`, `transferOwnership`, `renounceOwnership`. | Trusted. |
| `ReporterSet` owner | Calls `addReporter`, `removeReporter`, `setThreshold`, `transferOwnership`, `renounceOwnership`. | Trusted. |
| Compromised contract owner (any of the three) | Adversarial owner key. | Outside trust model; severity called out in residual risks. |
| Chain block builder | Can re-order / drop / front-run user txs; can manipulate `block.timestamp` within ~15s window. | Untrusted; assumed economically rational. |

## 2. Attack surface by contract

### 2.1 `PriceAggregator`

| Entry point | Threat | Mitigation in code |
|-------------|--------|--------------------|
| `requestPrice` | Insufficient fee bypass | `if (msg.value < fee) revert InsufficientFee` |
| `requestPrice` | Refund-callback reentrancy | `nonReentrant` modifier; `++nextReqId` and event emitted before the external `call` |
| `requestPrice` | Refund to non-payable contract | `RefundFailed` revert on `(bool ok, ) = call{value: refund}("")` |
| `requestPrice` | Counter overflow (`nextReqId`) | `uint256` counter; practically unreachable (~2^256 calls). Filed as I-03. |
| `fulfillPrice` | Replay of consumer-driven `reqId` | `fulfilled[reqId] = true` set on success |
| `fulfillPrice` | Replay of heartbeat (`reqId == 0`) | None at the contract layer; relies on `maxAge`. **Filed as M-01.** |
| `fulfillPrice` | Forged signatures | M-of-N ECDSA verification over EIP-712 digest |
| `fulfillPrice` | Signatures bound to a different chain | `chainId` baked into digest |
| `fulfillPrice` | Signatures bound to a different aggregator | `address(this)` baked into digest |
| `fulfillPrice` | Cross-asset replay | `assetId` baked into digest |
| `fulfillPrice` | Stale submission | `maxAge` guard (config-disabled by default) |
| `fulfillPrice` | Reentrancy on `IReporterSet` calls | No mutex on `fulfillPrice` itself; relies on the reporter set being honest. A malicious set (owner-installed) could re-enter — see residual risks. |
| `fulfillPrice` | Gas grief via huge `signatures[]` | Self-griefing only (submitter pays); block gas limit hard caps. Filed as I-04. |
| `fulfillPrice` | Round counter overflow | `uint80` + unchecked add; practically unreachable. Filed as I-02. |
| `setRequestFee` / `setMaxAge` / `setReporterSet` | Unauthorized config change | `onlyOwner` |
| `setReporterSet` | Bricked reporter set via degenerate input | Only `address(0)` is rejected; further footguns filed as L-01. |
| `latestRoundData` / `getRoundData` | Missing-round read | `if (latest == 0) revert NoRoundData` / `if (r.updatedAt == 0) revert NoRoundData` |

### 2.2 `OracleRegistry`

| Entry point | Threat | Mitigation in code |
|-------------|--------|--------------------|
| `registerAsset` | Unauthorized registration | `onlyOwner` |
| `registerAsset` | Zero asset id / aggregator | `ZeroAssetId` / `ZeroAggregator` reverts |
| `registerAsset` | Silent re-pointing | Emits `AssetUpdated` to distinguish from `AssetRegistered`; insertion order preserved. Filed as I-05. |
| `getAggregator` / `listAssets` | None (view) | — |

### 2.3 `ReporterSet`

| Entry point | Threat | Mitigation in code |
|-------------|--------|--------------------|
| Constructor | Bypass via empty deploy with zero threshold | Allowed (`initialThreshold == 0 && initialReporters.length == 0`); leaves contract dormant until both reporters AND threshold are set. Filed as L-02. |
| `addReporter` | Unauthorized add | `onlyOwner` |
| `addReporter` | Zero / duplicate reporter | `ZeroReporter` / `ReporterAlreadyExists` reverts |
| `removeReporter` | Unauthorized remove | `onlyOwner` |
| `removeReporter` | Remove a non-member | `ReporterNotFound` revert |
| `removeReporter` | Drop count below threshold | `ThresholdExceedsReporterCount` revert |
| `removeReporter` | `_indexOf` invariant break | `index+1` encoding; swap-pop walks the standard pattern; reviewed lines 79-104. |
| `setThreshold` | Unauthorized | `onlyOwner` |
| `setThreshold` | Zero / above-count | `ZeroThreshold` / `ThresholdExceedsReporterCount` reverts |
| View functions | None | — |

### 2.4 `PriceLib`

| Surface | Threat | Mitigation |
|---------|--------|------------|
| `buildDigest` | EIP-712 collision / replay surface | `abi.encode` (not `encodePacked`); domain includes chainId + aggregator; struct hash includes `(reqId, assetId, price, timestamp)`. Reviewed; canonical. |
| `verifySignatures` | Double-counting via duplicate sigs | `_contains(counted, ...)` dedupe |
| `verifySignatures` | Counting unauthorized signers | `_contains(authorizedReporters, signer)` membership check |
| `verifySignatures` | ECDSA s-malleability | OZ `tryRecover` rejects high-`s` via `InvalidSignatureS`; loop body `continue`s on `RecoverError != NoError`. |
| `verifySignatures` | `address(0)` recovery counted | `signer == address(0)` short-circuits to `continue`. |
| `verifySignatures` | `threshold == 0` pass | Early-return false. |
| `verifySignatures` | `signatures.length < threshold` | Early-return false. |
| `scaleTo` | Sign-flip on `int256(10**77)` cast | None. **Filed as M-02.** |
| `scaleTo` | Overflow on `10**78+` | Solidity 0.8 checked arithmetic reverts. |

### 2.5 `PriceConsumer`

| Entry point | Threat | Mitigation |
|-------------|--------|------------|
| `requestPrice` | Reentrancy on refund forward | None on consumer side; relies on aggregator's `nonReentrant`. Filed as L-03. |
| `requestPrice` | Pre-funding accounting break (someone sends ETH to `receive()` before the call) | `balanceBefore = address(this).balance - msg.value` correctly cancels pre-funding by subtracting `msg.value` first; refund computation is `address(this).balance - balanceBefore` = `(B + msg.value − fee) − B = msg.value − fee`. Walked and verified sound. |
| `latestAnswer` | None (view) | — |
| `receive` | Mailbox for refunds; no logic | — |

## 3. Cross-cutting attack scenarios

### 3.1 Compromised single reporter (1-of-3)

- Threat: malicious reporter signs an off-target price.
- Mitigation: 2-of-3 threshold means one rogue sig is insufficient. `verifySignatures` returns false.
- Status: handled by design.

### 3.2 Compromised reporter quorum (2-of-3)

- Threat: two reporter keys leak; attacker signs arbitrary `(reqId, assetId, price, timestamp)` triples.
- Mitigation: none on-chain (this is the security boundary). Off-chain mitigation: rotate via `ReporterSet.removeReporter` + `setThreshold`, or `PriceAggregator.setReporterSet`. Owner must act.
- Residual risk: per spec §1, reporter keys live on disk on the same VPS. Single-host compromise → quorum compromise. Documented.

### 3.3 Compromised aggregator owner

- Threat: owner sets a malicious `IReporterSet` they control, or raises `requestFee` to lock users out, or sets `maxAge = 0` to brick fulfillment.
- Mitigation: `Ownable2Step` two-step transfer makes ownership *acquisition* by an attacker harder, but does not stop a compromised current owner from acting. The aggregator owner is fully trusted per the threat model.
- Residual risk: deployment should use a multisig or timelock for the owner role. Not enforced in code.

### 3.4 Chain reorg

- Threat: a `fulfillPrice` tx that landed in block N is reorged out at block N + 1.
- Mitigation: the indexer-service requires 5 confirmations before notifying consumers; this is off-chain. On-chain there is no re-entry against `fulfilled[reqId]` because the reorg also un-sets that mapping.
- Residual risk: a consumer that read `latestRoundData()` between the original mine and the reorg sees a value that no longer exists. Standard chain risk; no on-chain mitigation possible.

### 3.5 Front-running `fulfillPrice`

- Threat: an attacker observes a `fulfillPrice` tx in the mempool and submits the same calldata themselves, paying higher gas.
- Mitigation: harmless. Either tx records the same round.

### 3.6 Heartbeat replay (M-01)

- Threat: anyone replays an old `fulfillPrice` with `reqId = 0` from public history.
- Mitigation: `maxAge` if set finite. Default is `type(uint256).max` (disabled). **Open finding.**

### 3.7 `scaleTo` sign-flip (M-02 — remediated)

- Threat: a future caller passes `srcDecimals - dstDecimals = 77` (or vice versa) and silently receives the wrong sign.
- Mitigation: **remediated** — `SafeCast.toInt256` reverts on out-of-range values; deterministic at the `10^77` boundary.

### 3.8 Permanent-brick on colluding reporter quorum (R-01 — accepted)

- Threat: a 2-of-N colluding reporter quorum signs a heartbeat with `timestamp = type(uint256).max`, locking `latestStartedAt` at its ceiling so no future submission can pass the strict-monotonic gate. Aggregator becomes permanently unable to record a new round.
- Mitigation: **accepted residual risk for the demo.** Prerequisite is quorum compromise (already the highest acknowledged trust assumption). Recovery is cheap — redeploy aggregator and re-point via `OracleRegistry.registerAsset`. Production deploys with tighter liveness budgets should add a `timestamp <= block.timestamp + tolerance` cap.

### 3.9 Consumer requests unfulfillable after fresher heartbeat (R-02 — accepted)

- Threat: a consumer's `requestPrice` paid `requestFee` for `(reqId=R, observation-time=T)`. A heartbeat lands first with `timestamp = T+δ`, advancing `latestStartedAt` past `T`. The signatures over `(R, T)` can no longer satisfy the gate.
- Mitigation: **accepted operational invariant.** Off-chain pipeline (per spec §3.2) already publishes a canonical single-timeline observation stream, so it re-aggregates and re-signs with a fresh timestamp per submission. The on-chain gate enforces what the pipeline already guarantees.

## 4. Residual risks (from spec §1 simplifications)

| Risk | Spec ref | On-chain mitigation? |
|------|----------|----------------------|
| Reporter keys on disk on same VPS | §1 "Reporter keys on disk" | None (off-chain operational); on-chain rotation possible via owner |
| Demo-permissive freshness (`maxAge` disabled by default) | §1 "Demo-permissive freshness" | M-01 closed by monotonic-`startedAt` gate; `maxAge` remains demo-permissive |
| Permanent brick on quorum compromise (R-01) | accepted residual | Redeploy + `OracleRegistry` re-point |
| Strict-monotonic-`timestamp` invariant across paths (R-02) | accepted operational | Off-chain pipeline contract |
| Single VPS (no HA) | §1 "One VPS, one provider" | None — contract continues to serve last round if oracle goes dark |
| No slashing / dispute period | §1 "Out of scope" | None |
| Self-audit only | §1 | Mitigated by this audit + Slither baseline |
| Single-operator reporter set (all three keys on same host) | §1 | None |
| Owner is EOA in current deploy plan | (implied) | None — recommend multisig or timelock for production |

# Findings — internal-audit-v1

Each finding gets: id, title, severity, site (`file:line`), description,
evidence, recommendation, status. Severities follow standard scale:
**Critical / High / Medium / Low / Informational / False-positive.**

Status values: `open` (needs remediation), `accepted` (intentional, with
rationale), `false-positive` (re-triaged as not-a-bug after deeper analysis).

## Tally

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 0 |
| Medium   | 2 |
| Low      | 3 |
| Informational | 7 |
| False-positive (re-triaged) | 0 |

---

## M-01 — Heartbeat (`reqId=0`) submissions are replayable by any caller under the documented demo-default `maxAge`

- **Severity:** Medium
- **Site:** `src/core/PriceAggregator.sol:142-181` (`fulfillPrice`); design interaction with `maxAge = type(uint256).max` default at `src/core/PriceAggregator.sol:116`
- **Status:** open

### Description

`fulfillPrice` exempts `reqId == 0` from the per-reqId replay guard so the
heartbeat path can recur. The function body keeps the signatures, price, and
timestamp inputs in calldata only — they are never stored or hashed against any
nonce — so anyone can take the calldata of a successful heartbeat from public
chain history and replay it. The aggregator then writes a fresh round with the
old `answer` and `startedAt` but a new `updatedAt = block.timestamp` and a new
`latestRoundId`.

Mitigation exists: if `maxAge` is set to a finite value, the
`if (timestamp < nowTs && nowTs - timestamp > currentMaxAge)` guard rejects the
replay once the captured timestamp ages out. However, the constructor sets
`maxAge = type(uint256).max` (line 116) — the documented demo default — which
disables the guard entirely. Spec §1 documents the demo-permissive default as
"ages flow through to the dashboard but never gate," but does not document the
second-order consequence that heartbeats become permissionlessly replayable.

### Evidence

- PoC test `test/audit/HeartbeatReplay.audit.test.ts:14-46` — a stranger
  (`wallets[8]`) successfully replays an old heartbeat captured at
  `(price=100, timestamp=100)` after the legitimate oracle has moved the round
  to `(price=200, timestamp=200)`. After the replay,
  `latestRoundData()` returns `(answer=100, startedAt=100, updatedAt=now)`.
- PoC test `test/audit/HeartbeatReplay.audit.test.ts:48-79` — same scenario
  with `setMaxAge(1)` blocks the replay with `SubmissionTooOld`.

Run with: `npx hardhat test test/audit/HeartbeatReplay.audit.test.ts`. Output: 2 passing.

### Impact

A downstream consumer that calls `latestRoundData()` (i.e. any
`AggregatorV3Interface` consumer that only consumes `answer`) sees a stale price
that was at one point legitimately reported but is no longer current. Examples:

- A lending market that prices collateral using `answer` would accept a stale
  cheap-collateral price (or stale expensive-collateral price) if the attacker
  picks the heartbeat snapshot that benefits them.
- A dashboard surface that displays only the latest round would mislead users
  about the current state of the market.

The replay attacker cannot synthesise arbitrary prices — they are constrained to
the set of historical legitimately-signed heartbeats. But for liquid assets
with large historical price ranges (e.g. crypto majors in late-2024 vs. mid-2025)
the attacker has a wide window.

### Recommendation

Pick one (or layer several):

1. **Track a heartbeat-specific nonce.** Replace the `reqId == 0`-exempt rule
   with a monotonic `lastHeartbeatTimestamp` storage variable; require the
   submitted `timestamp` to be strictly greater than the stored value.
2. **Reject `startedAt < lastRound.startedAt`.** A new round whose
   reporter-attested timestamp regresses is almost certainly a replay or
   misbehaving oracle.
3. **Refuse to fulfil under `maxAge == type(uint256).max` in production.**
   Force the deployer to set a real freshness budget at deployment via a
   `requireMaxAgeSet` flag. (Demo deployments would still need it, just to a
   large value.)

Option 2 is the simplest and addresses the bulk of the attack with one extra
storage word.

---

## M-02 — `PriceLib.scaleTo` sign-flip on `int256(10**diff)` cast for `diff = 77`

- **Severity:** Medium
- **Site:** `src/libs/PriceLib.sol:132` and `src/libs/PriceLib.sol:139`
- **Status:** open

### Description

`scaleTo` builds its multiplier / divisor as
`int256 factor = int256(10 ** diff);` (and similarly for `divisor`). In
Solidity 0.8.24 the `uint -> int` cast reinterprets bits without any range
check — it is *not* a checked conversion. When `diff == 77`,
`uint256(10**77)` has bit 255 set (since `10**77 ≈ 1.0e77 > 2^255 ≈
5.79e76`), so `int256(uint256(10**77))` is a *negative* value
(`10**77 − 2**256 ≈ −1.58e76`).

The resulting product `src * factor` therefore has the wrong sign whenever the
factor is the negative reinterpretation. The scale-down branch behaves
symmetrically: integer division by the negative divisor truncates toward zero
but with a flipped sign once the magnitude crosses zero.

For `diff >= 78`, `10**diff` overflows `uint256` and the transaction reverts
under Solidity 0.8 checked arithmetic — so the bug is constrained to
**exactly `diff == 77`** in the scale-up branch and any `diffDown == 77` in the
scale-down branch.

### Evidence

PoC tests in `test/audit/PriceLibScaleTo.audit.test.ts` (all four pass):

1. `scaleTo(1, 0, 77)` returns `−1.58e76` (off by sign and magnitude).
2. `scaleTo(1, 0, 76)` returns the correct `10**76` (boundary).
3. `scaleTo(0, 77, 0)` returns `0` (correct by accident — divisor sign
   doesn't matter for zero numerator).
4. `scaleTo(5e76, 77, 0)` returns a *negative* result where the correct
   answer would be zero (truncation toward zero), demonstrating sign flip in
   the scale-down branch when `|src| > |divisor|`.

Run with: `npx hardhat test test/audit/PriceLibScaleTo.audit.test.ts`. Output: 4 passing.

### Impact (current codebase)

`PriceLib.scaleTo` is **not called anywhere in the core contracts** (verified
by `grep`). It is only exercised by:

- `src/test/PriceLibHarness.sol` (test-only).
- Off-chain services that statically link or re-implement the algorithm.

So the **on-chain exploitability is currently zero**: there is no entry point in
`PriceAggregator`, `OracleRegistry`, or `ReporterSet` that ends up calling
`scaleTo` with attacker-controlled `srcDecimals` / `dstDecimals`. The
oracle-service off-chain converts doubles to int256 in Go without invoking
`scaleTo`, per spec §3.2.

However, the library *is* part of the published API (it is a public symbol
under the `MIT` license that other consumers may compose with), and the
property suite at `test/property/PriceLib.property.test.ts` constrains
generation to `0..30` decimals which never hits the boundary. A future
re-use that does feed user-supplied decimals into `scaleTo` would inherit the
bug silently.

### Recommendation

Either:

1. **Add a guard.** Reject `dstDecimals - srcDecimals > 76` and
   `srcDecimals - dstDecimals > 76` at entry. `int256` cannot represent
   `10**77` so the refusal is mathematically grounded.
2. **Use `SafeCast.toInt256(uint256)`** from OpenZeppelin to convert the
   factor; the safe cast reverts on out-of-range values rather than
   silently sign-flipping.

Option 2 is the conventional defence and is one line.

### Severity rationale

Marked Medium (not Low) because: the bug produces a *silently incorrect signed
value* rather than a revert, which is exactly the class of correctness defect
that survives review and damages downstream integrators. Demoted from High
because the affected function is not reachable from any current entry point in
this codebase.

---

## L-01 — `PriceAggregator.setReporterSet` and `setMaxAge` accept obvious foot-guns

- **Severity:** Low
- **Site:** `src/core/PriceAggregator.sol:191-203`
- **Status:** open

### Description

`setReporterSet(newReporterSet)` validates only that the address is non-zero.
It does not verify:

- `newReporterSet.getThreshold() > 0` — the owner can install a reporter set
  with `_threshold == 0` (e.g. an empty-deploy-state `ReporterSet`), bricking
  all future `fulfillPrice` calls. (`verifySignatures` rejects on `threshold ==
  0`.) Recoverable by setting another reporter set, so this is footgun rather
  than bug.
- `newReporterSet.getReporters().length > 0` — similar.

`setMaxAge(newMaxAge)` accepts `0`, which would reject every submission
(timestamp must equal `block.timestamp` to within zero seconds). Again
recoverable. Owner trust mitigates impact.

### Recommendation

Add minimal sanity checks. Even just `require(newSet.getThreshold() > 0)` and
`require(newMaxAge >= 1 seconds)` would catch typos. Optional — the owner is
trusted per the threat model.

---

## L-02 — `ReporterSet` empty-deploy path leaves the contract dormant until both reporters AND threshold are configured

- **Severity:** Low
- **Site:** `src/core/ReporterSet.sol:51-71` (constructor) and
  `src/core/ReporterSet.sol:74-76` (`addReporter`)
- **Status:** open (informational; design choice with footgun risk)

### Description

The constructor permits `initialReporters.length == 0 && initialThreshold ==
0` to deploy an empty set the owner populates later. After deployment the
owner adds reporters via `addReporter`. `addReporter` does not auto-increment
`_threshold`, so the contract sits with `_threshold == 0` until the owner
remembers to call `setThreshold` separately. While in that state any
`PriceAggregator` referencing this set will reject every `fulfillPrice`
(because `verifySignatures` returns false on `threshold == 0`).

This isn't a security vulnerability — there's no path to an unsound
fulfillment — but it is a discoverable foot-gun in a production deploy
sequence. The deploy script in this repo doesn't currently use the empty path
(per `test/helpers/fixtures.ts`), but the path exists and is tested in
`test/unit/ReporterSet.test.ts:25-31`.

### Recommendation

Either (a) document the two-step bootstrap in NatSpec on the constructor more
explicitly, or (b) have `addReporter` set `_threshold = 1` on the very first
add when `_threshold == 0`. Option (b) is more user-friendly but slightly
changes ownership semantics — owner explicit choice may be preferred. Worth a
deploy-script lint instead.

---

## L-03 — `PriceConsumer.requestPrice` is not `nonReentrant`

- **Severity:** Low
- **Site:** `src/consumers/PriceConsumer.sol:38-50`
- **Status:** open (informational; demo consumer)

### Description

`PriceConsumer.requestPrice` performs an external call to `aggregator`
(`nonReentrant`-protected on its side) and then a refund call to `msg.sender`.
The function itself has no `nonReentrant` guard, and `lastReqId` is written
between the two external calls. A malicious `msg.sender` whose `receive()`
re-enters `PriceConsumer.requestPrice` would:

1. Get a new reqId from the aggregator (fine — every call is a real on-chain
   request the consumer paid for).
2. Cause the outer call's `lastReqId` write to overwrite the inner call's
   `lastReqId` — but the inner call already overwrote it before returning, so
   the final value reflects the *outer* (last) reqId. There is no inconsistency.

The flow doesn't have an exploitable invariant violation because the
aggregator itself enforces correct accounting. However, the consumer is held
out as a *reference* example in the README and `/docs`. A reader copying its
pattern into a contract that *does* have state to corrupt would inherit the
weakness.

### Recommendation

Add `ReentrancyGuard` to `PriceConsumer` and apply `nonReentrant` to
`requestPrice`. Cost is one storage slot; the educational value of a clean
reference outweighs it.

---

## I-01 — `PriceLib.buildDigest` recomputes the EIP-712 domain separator on every call

- **Severity:** Informational (gas observation)
- **Site:** `src/libs/PriceLib.sol:49-57`
- **Status:** accepted (`PriceLib` is a stateless library; caching would require
  state owned by the aggregator)

### Description

Each `fulfillPrice` call recomputes the domain separator (a 5-input
`keccak256(abi.encode(...))`). For a chain that doesn't fork
(`block.chainid` stable), this is wasted gas — OpenZeppelin's `EIP712` base
contract caches the separator at construction. Estimated ~2k gas per
fulfilment. Over a year of heartbeats, sub-significant.

### Recommendation

Optional: switch `PriceAggregator` to inherit OZ `EIP712` and use
`_hashTypedDataV4(structHash)`. Trade-off: that path stores the chain id at
construction and re-derives on fork, which is exactly the desired behaviour
but adds a small contract-size cost.

---

## I-02 — `latestRoundId` is `uint80` with unchecked `++` increment

- **Severity:** Informational
- **Site:** `src/core/PriceAggregator.sol:78,175`
- **Status:** accepted (impossible-in-practice overflow; matches Chainlink ABI
  convention of `uint80` round ids)

### Description

`latestRoundId` is `uint80` (Chainlink convention); `newRoundId =
latestRoundId + 1` is `unchecked`. At `2^80 = 1.21e24` rounds, the counter
wraps to `0`, which `latestRoundData()` then treats as "no round" and reverts
on read (`if (latest == 0) revert NoRoundData()`). The contract would become
permanently unusable past wrap.

`2^80` heartbeats at 1Hz would take ~38 trillion years. Marked Informational.

---

## I-03 — `nextReqId` is `uint256` with unchecked `++` increment

- **Severity:** Informational
- **Site:** `src/core/PriceAggregator.sol:81,124-126`
- **Status:** accepted

### Description

`nextReqId` wraps at `2^256`, which would assign `reqId = 0` next — colliding
with the heartbeat sentinel. Practically unreachable.

---

## I-04 — `verifySignatures` worst-case complexity is `O(sigs * (reporters + sigs))`

- **Severity:** Informational
- **Site:** `src/libs/PriceLib.sol:86-111`
- **Status:** accepted

### Description

The dedupe loop performs two linear searches per signature: one against
`authorizedReporters` (size N, typically `< 10`) and one against the running
`counted` list (size up to `signatures.length`). With reporter sets in the
single digits (current default `2-of-3`) the cost is dominated by ECDSA
recovery, which is ~3000 gas. Documented in NatSpec on the function.

A submitter who passes an oversized `signatures[]` only griefs themselves —
they pay the gas; no liveness impact on the aggregator. The block-gas-limit
ceiling on the call is the hard cap.

### Recommendation

None. The trade-off (no mapping allocation in calldata, simple linear
dedupe) is correct for the expected reporter set size.

---

## I-05 — `OracleRegistry.registerAsset` silently re-points an `assetId` to a new aggregator

- **Severity:** Informational
- **Site:** `src/core/OracleRegistry.sol:34-47`
- **Status:** accepted (intentional; see `AssetUpdated` event)

### Description

Re-pointing emits `AssetUpdated` (not `AssetRegistered`) so consumers can
distinguish the two paths. Insertion order in `_assetList` is preserved.
Intentional design.

A defensive variant would `revert` on re-pointing and require an explicit
`deregisterAsset` first — but the current design lets an operator upgrade an
aggregator (e.g. for a bug fix) without churning the public asset list.

---

## I-06 — `Ownable2Step.renounceOwnership` (inherited) is one-step and unguarded

- **Severity:** Informational
- **Site:** `Ownable.renounceOwnership` (inherited by `PriceAggregator`,
  `OracleRegistry`, `ReporterSet`)
- **Status:** accepted (OpenZeppelin default)

### Description

`Ownable2Step` is two-step on `transferOwnership` but inherits the one-step
`renounceOwnership` from `Ownable`. A typo / mis-script could permanently
ownerless any of the three contracts. Standard OZ behaviour; standard
deployment-time mitigation is to never call `renounceOwnership` in production
scripts.

---

## I-07 — Consider EIP-1153 transient-storage reentrancy guard on Base Sepolia (cancun-enabled)

- **Severity:** Informational (gas / forward-looking)
- **Site:** `src/core/PriceAggregator.sol:23` (`ReentrancyGuard`)
- **Status:** accepted (OZ recommendation per their NatSpec; no production
  block right now)

### Description

OZ v5.5 emits a NatSpec hint: *"If EIP-1153 (transient storage) is available
on the chain you're deploying at, consider using `ReentrancyGuardTransient`
instead."* Base Sepolia is cancun-enabled (per `hardhat.config.ts`'s EVM
version setting). Switching saves ~5k gas per `requestPrice` and removes one
storage slot. Cosmetic improvement, no security impact either way.

---

## Suppressions verification (task 03 deferred items)

Six `slither-disable-next-line` suppressions were carried into this audit from
task 03. Each was re-walked against the live source:

1. `PriceLib.verifySignatures` — `unused-return` on `ECDSA.tryRecover` third
   tuple member. **Agreed.** The third return is `bytes32` violating-data
   useful only for `InvalidSignatureS`; discarding is correct.
2. `PriceConsumer.latestAnswer` — `unused-return` on `latestRoundData`.
   **Agreed.** Helper exists to expose only `answer`.
3. `PriceAggregator.getRoundData` — `incorrect-equality` + `timestamp` on
   `r.updatedAt == 0`. **Agreed.** Existence check; the alternative (a
   separate `exists` mapping) is more gas and the same semantics.
4. `PriceAggregator.fulfillPrice` — `timestamp` on `maxAge` comparison.
   **Agreed.** `maxAge` is configurable and dwarfs miner-skew.
5. `PriceConsumer.requestPrice` — `reentrancy-benign` on `lastReqId = reqId`
   post-call. **Agreed.** Aggregator is `nonReentrant`; field is notification
   only. (Filed separately as L-03 for the consumer-side absence of guard,
   which is a different concern.)
6. `PriceConsumer.requestPrice` — `low-level-calls` on refund forward.
   **Agreed.** Forwarding ETH needs `call`; success flag is checked.

All six rationales hold under independent review.

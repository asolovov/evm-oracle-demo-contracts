# Internal Audit Report v1 — `evm-oracle-demo-contracts`

**Status:** draft. Awaiting human peer review sign-off.

## Audit metadata

| Field | Value |
|-------|-------|
| Commit SHA at audit start | `c6b586cab879edb83d6910339fbfea5bd2a4328f` (`main`) |
| Audit deliverables commit | `6a4a8b8` on `feat/internal-audit-v1` |
| Remediation commit | added in the same audit branch on 2026-05-21 (closes M-01 + M-02) |
| Branch | `feat/internal-audit-v1` |
| Date | 2026-05-21 |
| Auditor identity | claude (general-purpose subagent), Anthropic Claude Code |
| Remediating engineer | claude (parent agent), Anthropic Claude Code |
| Status | `draft` (flips to `accepted` only after human peer sign-off) |

### Contracts in scope

- `src/core/PriceAggregator.sol`
- `src/core/OracleRegistry.sol`
- `src/core/ReporterSet.sol`
- `src/libs/PriceLib.sol`
- `src/consumers/PriceConsumer.sol`

### Out of scope

- `src/test/PriceLibHarness.sol` — test-only.
- `src/test/NonPayableCaller.sol` — test-only.
- `src/interfaces/*` — pure interfaces; no executable code.
- Off-chain components (`price-service`, `oracle-service`, `indexer-service`,
  `rest-api`, frontend, infra) — covered by separate audits in their
  respective repos.

## Executive summary

| Severity | Count | Open | Remediated | Accepted |
|----------|-------|------|------------|----------|
| Critical | **0** | 0 | 0 | 0 |
| High     | **0** | 0 | 0 | 0 |
| Medium   | **2** | 0 | **2** | 0 |
| Low      | **3** | 3 | 0 | 0 |
| Informational | **7** | 0 | 0 | 7 |

**Status:** both Mediums (M-01 heartbeat replay, M-02 `scaleTo` cast sign-flip)
were remediated on the same audit branch — patches are referenced in their
individual write-ups and re-tested against the same PoC harness that
originally exhibited the bug. Lows remain open pending owner decision.
No Critical or High findings. The Slither baseline reports zero issues
(`audit/reports/slither-v1.txt`). All six historical Slither suppressions
from task 03 were re-walked individually; rationales hold.

**Re-audit (2026-05-21):** the remediation commit `359fbb8` was re-audited as
a diff-scoped pass — full report at `audit/reports/reaudit-v1.1.md`. Verdicts:
**M-01 closed-with-caveat** (heartbeat replay unreachable post-fix; two new
operational surfaces filed as R-01 + R-02 Low for owner triage), **M-02
closed** (`SafeCast.toInt256` reverts deterministically at the `10^77`
boundary). Two additional informational items (R-03, R-04) filed as
documentation-quality observations. No new Mediums.

### Headline findings (post-remediation)

- **M-01 — Heartbeat replay under demo-default `maxAge`. Remediated.**
  Original: anyone could replay a previously-fulfilled heartbeat
  (`reqId == 0`) from public chain history while `maxAge == type(uint256).max`,
  overwriting `latestRoundData` with a stale-but-legitimately-signed price.
  Fix: monotonic-`startedAt` gate added to `fulfillPrice` (new
  `StaleTimestamp(submittedAt, latestStartedAt)` error). Reads
  `_rounds[latestRoundId].startedAt` directly — no new storage slot. The
  fix fires regardless of `maxAge`, so the demo default is no longer a
  silent attack surface.
- **M-02 — `PriceLib.scaleTo` sign flip at `diff == 77`. Remediated.**
  Original: a bare `int256(uint256(10**77))` cast reinterprets the high bit
  and silently returns a negative factor. Fix: both casts now go through
  `SafeCast.toInt256`, which reverts `SafeCastOverflowedUintToInt` on
  out-of-range values.

The original PoC tests under `test/audit/` were rewritten in the same
remediation pass to assert the fixes (they now demonstrate the *remediation*
rather than the *bug*).

## Scope + methodology

The audit pass covered:

1. **Manual line-by-line review** of every function in scope, walking each
   external entry, every state mutation, every external call, and every
   `unchecked` block. The "where to look hard" prompts in the task brief
   (request-fulfill flow, refund accounting, EIP-712 conformance, the
   `_threshold == 0` edge, the swap-pop in `removeReporter`, the cast in
   `scaleTo`) were each walked deliberately.
2. **Static analysis** via `npm run slither` (Slither 0.10+ with project's
   `slither.config.json`).
3. **Test-suite review:** 71 unit + property tests, 100% line + statement
   coverage on `src/core/` and `src/libs/`, 88.89% on `src/consumers/`
   (uncovered line is the `RefundForwardFailed` revert path on the demo
   consumer — out of scope for the 100% bar per the task brief).
4. **PoC test authoring** for the two Medium findings under
   `test/audit/HeartbeatReplay.audit.test.ts` and
   `test/audit/PriceLibScaleTo.audit.test.ts`. The PoCs originally
   demonstrated the bugs against the unmodified `src/`; after remediation
   they were rewritten to assert that the fixes hold (StaleTimestamp /
   SafeCastOverflowedUintToInt are surfaced under the originally-exploitable
   conditions).
5. **Access-control matrix** construction with negative-test coverage
   cross-check (see `audit/reports/access-control-matrix.md`).
6. **Storage-layout baseline** capture (see
   `audit/reports/storage-layouts.md`).
7. **Threat model** authoring (see `audit/THREAT_MODEL.md`).
8. **Peer self-review checklist** walked per contract (see
   `audit/CHECKLIST.md`).

### What I deliberately did *not* file as findings

Per the task brief, the demo-permissive defaults are documented design
choices and should not be filed as bugs:

- `maxAge = type(uint256).max` by default.
- Reporter keys on disk in deployment (off-chain).
- Single reporter quorum (2-of-3 default) with no slashing / dispute period.

These are noted in the threat model's "Residual risks" section.

However, the *second-order consequence* of the `maxAge = max` default — that
anyone can replay heartbeats — IS filed as M-01 because that consequence is
not explicitly documented in the spec, and a reader would not infer it from
"ages flow through to the dashboard but never gate."

## Tools + configurations referenced

| Tool | Version | Config |
|------|---------|--------|
| Slither | 0.10.x (via `solc-select`) | `slither.config.json` (excludes `naming-convention`, `solc-version`; filter paths `node_modules\|src/test\|slither-all.sol`) |
| solc | 0.8.24 (via `solc-select`) | `--evm-version cancun` |
| Hardhat | 3.4.5 | `hardhat.config.ts` |
| `fast-check` | 4.8.0 | property suites at 1000 runs; refund property at 100 runs |
| OpenZeppelin Contracts | 5.6.1 (uses v5.5 `ReentrancyGuard`) | — |
| Chainlink Contracts | 1.5.0 | `AggregatorV3Interface` re-export only |

Halmos (formal verification) is **not installed locally** — see "Deferred
work" below.

## Findings table

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| M-01 | Medium | Heartbeat (`reqId=0`) replay under demo-default `maxAge` | **remediated** |
| M-02 | Medium | `PriceLib.scaleTo` sign-flip on `int256(10**77)` cast | **remediated** |
| L-01 | Low | `setReporterSet` / `setMaxAge` accept footgun inputs | open |
| L-02 | Low | `ReporterSet` empty-deploy leaves contract dormant until threshold set | open |
| L-03 | Low | `PriceConsumer.requestPrice` not `nonReentrant` | open |
| I-01 | Info | `PriceLib.buildDigest` recomputes domain separator each call | accepted |
| I-02 | Info | `latestRoundId` `uint80` unchecked wrap | accepted |
| I-03 | Info | `nextReqId` `uint256` unchecked wrap | accepted |
| I-04 | Info | `verifySignatures` O(sigs × (reporters + sigs)) complexity | accepted |
| I-05 | Info | `registerAsset` silent re-pointing | accepted (intentional) |
| I-06 | Info | `Ownable.renounceOwnership` is one-step | accepted (OZ default) |
| I-07 | Info | EIP-1153 transient reentrancy guard available | accepted |

Full write-ups in `audit/findings.md`.

## Critical-function properties

The properties below are the security invariants the audit verifies — either
by manual review, by property tests in `test/property/`, or by PoC tests
under `test/audit/`. They are listed in the canonical form for future
formal-verification re-runs (see "Deferred work").

### `PriceAggregator.requestPrice`

- **R-1:** `msg.value < requestFee` → reverts `InsufficientFee`. (Tested.)
- **R-2:** `msg.value >= requestFee` → assigns `reqId = ++nextReqId`,
  emits `PriceRequested(reqId, msg.sender)`, refunds exactly
  `msg.value - requestFee` to `msg.sender`. (Tested + property-tested.)
- **R-3:** Reentrant call into `requestPrice` from the refund callback
  reverts via the `nonReentrant` guard. (Implied by OZ guard; not directly
  tested.)
- **R-4:** Refund failure (`msg.sender.call{value: refund}("")` returns
  false) → reverts `RefundFailed`. (Tested via `NonPayableCaller`.)
- **R-5:** `nextReqId` strictly monotonic. (Tested.)

### `PriceAggregator.fulfillPrice`

- **F-1:** `reqId != 0 && fulfilled[reqId] == true` → reverts
  `ReqIdAlreadyFulfilled`. (Tested.)
- **F-2:** `reqId == 0` is exempt from F-1. (Tested, including replay
  reproduction in PoC.)
- **F-3:** `maxAge != type(uint256).max && timestamp < block.timestamp &&
  block.timestamp - timestamp > maxAge` → reverts `SubmissionTooOld`.
  (Tested.)
- **F-4:** `timestamp >= block.timestamp` is *not* rejected by the maxAge
  guard. (Tested as positive case; deliberate per spec — clock-skew
  tolerance.)
- **F-5:** Signature quorum on the EIP-712 digest must be M-of-N over
  authorized reporters. (Tested via unit + property suites + PoC.)
- **F-6:** Digest binds `chainId`, `aggregator address`, `assetId`,
  `reqId`, `price`, `timestamp`. (Tested.)
- **F-7:** `latestRoundId` strictly monotonic increases by 1 per success.
  (Tested.)
- **F-8:** On success, `_rounds[newRoundId]` stores
  `(answer=price, startedAt=timestamp, updatedAt=block.timestamp)`. (Tested.)
- **F-9:** [**Originally M-01; remediated**] A new fulfillment must satisfy
  `timestamp > _rounds[latestRoundId].startedAt`; reverts `StaleTimestamp`
  otherwise. Closes the heartbeat-replay path under any `maxAge` setting.
  (Regression-tested in `test/audit/HeartbeatReplay.audit.test.ts`.)

### `PriceLib.verifySignatures`

- **V-1:** `threshold == 0` → returns `false`. (Tested.)
- **V-2:** `signatures.length < threshold` → returns `false`. (Tested.)
- **V-3:** Duplicate signatures from the same reporter count only once.
  (Tested in unit + property.)
- **V-4:** Signatures from non-authorized signers are ignored. (Tested in
  unit + property.)
- **V-5:** Malformed signatures (`tryRecover` returns an error) are
  skipped without throwing. (Tested.)
- **V-6:** `signer == address(0)` is skipped. (Tested implicitly via
  malformed-sig path.)
- **V-7:** A valid M-of-N quorum returns `true`. (Tested in unit +
  property.)

### `PriceLib.buildDigest`

- **D-1:** Deterministic over identical inputs. (Tested in property suite.)
- **D-2:** Distinct inputs produce distinct digests (collision-resistance
  within sampled space). (Tested in property suite.)
- **D-3:** Matches viem `hashTypedData` for the same EIP-712 inputs.
  (Tested in property suite at 1000 runs.)

### `PriceLib.scaleTo`

- **S-1:** `srcDecimals == dstDecimals` → identity. (Tested.)
- **S-2:** Round-trips for `(srcDecimals, dstDecimals)` permutations where
  representable. (Tested in property suite for `0..30`-range decimals.)
- **S-3:** [**Originally M-02; remediated**] Magnitude casts go through
  `SafeCast.toInt256`; `|dst - src| == 77` now reverts
  `SafeCastOverflowedUintToInt` deterministically instead of sign-flipping.
  (Regression-tested in `test/audit/PriceLibScaleTo.audit.test.ts`.)

### `ReporterSet`

- **RS-1:** `threshold > 0 && threshold <= reporters.length` always holds
  on the live (non-empty-deploy) state path. (Tested.)
- **RS-2:** `removeReporter` on a non-member reverts `ReporterNotFound`.
  (Tested.)
- **RS-3:** `addReporter` on a duplicate reverts `ReporterAlreadyExists`.
  (Tested.)
- **RS-4:** Swap-pop in `removeReporter` preserves `_isReporter` and
  `_indexOf` invariants for the moved entry. (Tested across both the
  middle-entry and last-entry paths.)
- **RS-5:** Owner-only mutators reject non-owner callers. (Partially
  tested — see access-control matrix for gaps.)

### `OracleRegistry`

- **OR-1:** `getAggregator(unregistered)` returns `address(0)`. (Tested.)
- **OR-2:** `listAssets().length` equals the number of unique successful
  `registerAsset` calls. (Tested.)
- **OR-3:** Re-registration emits `AssetUpdated` (not `AssetRegistered`)
  and does not duplicate the entry in `_assetList`. (Tested.)

## Access-control matrix reference

Full matrix at `audit/reports/access-control-matrix.md`. Headline: every
mutating function is owner-gated where it should be, and every revert path
has at least one negative test EXCEPT for four shared-modifier paths that
are visibly correct but not individually exercised (filed as test-suite
gaps in the matrix, not as findings).

## Threat model reference

Full threat model at `audit/THREAT_MODEL.md`. Headline residual risks are
the spec §1 simplifications (reporter keys on disk, single VPS, no slashing,
demo-permissive freshness). The audit also flags as worth-mentioning:

- **Owner is EOA in current deploy plan.** Recommend multisig / timelock
  for production.
- **`fulfillPrice` calls into `IReporterSet` without a reentrancy guard.**
  Safe under the trust assumption that the owner installs only the
  shipped `ReporterSet` implementation. A malicious owner could install a
  reentrant reporter set — covered by the owner-trust assumption.

## Storage layout reference

Full baseline at `audit/reports/storage-layouts.md`. No surprises;
`reporterSet (20 bytes) + latestRoundId (10 bytes)` correctly pack into
slot 5.

## Test-suite gaps observed

These are **not** findings — they are observations on test-suite completeness.

1. `PriceAggregator.setMaxAge` non-owner revert.
2. `PriceAggregator.setReporterSet` non-owner revert (the zero-address
   case is covered; the unauthorized-caller case is not).
3. `ReporterSet.removeReporter` non-owner revert.
4. `ReporterSet.setThreshold` non-owner revert.
5. `Ownable2Step.transferOwnership` two-step happy path on all three
   contracts.

The modifier `onlyOwner` is shared with covered functions and visibly
correct on inspection; explicit coverage would harden the suite by ~5 tests.

## Documentation observations

These are also **not** findings.

- Spec §1 says "ages flow through to the dashboard but never gate." Post
  M-01 fix, the heartbeat-replay consequence no longer applies, but the
  spec would still benefit from a note documenting the
  monotonic-`startedAt` gate as an invariant of the on-chain feed.
- `PriceLib.scaleTo`'s NatSpec was updated as part of the M-02 remediation
  to reference the `SafeCast.toInt256` revert behaviour at `|diff| == 77`.

## Deferred work

### Halmos / formal verification

Halmos is not installed locally. The audit deliverables do NOT include
`audit/fv/*.t.sol` proofs. The properties listed in
"Critical-function properties" above are framed in a form amenable to
Halmos symbolic-execution proofs:

- `verifySignatures` properties V-1 through V-7 are pure-function
  properties suitable for `assert`-style symbolic proofs.
- `buildDigest` determinism (D-1) and collision-resistance-within-domain
  (D-2 over symbolic distinct inputs) are similarly amenable.
- `scaleTo`'s S-3 invariant can be expressed as
  `forall src, srcDec, dstDec. scaleTo(src, srcDec, dstDec) > 0 IF src > 0
  AND dstDec >= srcDec`. Post-remediation, Halmos would confirm the
  `|diff| == 77` boundary reverts deterministically via `SafeCast`.

Recommend re-running this audit's deferred-work item once Halmos is
available on the auditor host. Or land remediations for M-01 and M-02
first; Halmos proofs against the patched code provide stronger guarantees.

### Formal verification of fulfillPrice replay properties

Specifically: prove that for the patched `fulfillPrice` (post-M-01),
`forall (reqId, price, ts, sigs) such that fulfillPrice(reqId, price, ts,
sigs) succeeded, a subsequent call fulfillPrice(reqId, price, ts, sigs)
reverts` — the unified replay invariant covering both consumer-driven and
heartbeat paths.

## Sign-off

| Reviewer | Identity | Date | Status |
|----------|----------|------|--------|
| Reviewing engineer (agent) | claude (general-purpose subagent) | 2026-05-21 | draft submitted |
| Peer reviewer (human) | _(blank pending sign-off)_ | _(blank)_ | _(blank)_ |

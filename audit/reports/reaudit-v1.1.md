# Re-audit Report v1.1 — `evm-oracle-demo-contracts`

**Status:** draft. Awaiting human peer review sign-off.

## Re-audit metadata

| Field | Value |
|-------|-------|
| Original-audit baseline commit | `6a4a8b8` (`feat/internal-audit-v1`) — audit deliverables + PoCs |
| Remediation commit under review | `359fbb8` (`feat/internal-audit-v1`) — M-01 + M-02 fixes |
| Branch | `feat/internal-audit-v1` |
| Date | 2026-05-21 (same-day re-audit) |
| Auditor identity | claude (general-purpose subagent), Anthropic Claude Code |
| Status | `draft` (flips to `accepted` only after human peer sign-off) |

## Scope statement

This is a **remediation-diff re-audit**, not a full pass. The unchanged code
in `src/` was already cleared at `6a4a8b8` under
`audit/reports/internal-audit-v1.md`. This re-audit focuses on:

1. The literal source diff between `6a4a8b8` and `359fbb8`
   (`git diff 6a4a8b8..359fbb8 -- src/`).
2. Whether each fix actually closes the original finding under every
   concrete replay path the original PoC demonstrated, plus edge cases the
   PoC did not cover.
3. New attack surface introduced *by the fix itself*.
4. Test-suite adequacy for the new logic.
5. Documentation drift across `audit/findings.md`,
   `audit/reports/internal-audit-v1.md`, `CHANGELOG.md`, and NatSpec.

Out of scope: re-running the original audit; any code unchanged by `359fbb8`;
off-chain components.

### Files actually changed in `359fbb8` (src/ only)

- `src/core/PriceAggregator.sol` — +12 lines: `StaleTimestamp` error
  declaration + monotonic-`startedAt` gate in `fulfillPrice`.
- `src/libs/PriceLib.sol` — +3 lines net: `SafeCast` import + two
  `SafeCast.toInt256(...)` wraps replacing bare `int256(...)` casts.

Plus non-src/ updates to tests (`test/audit/*`), audit docs
(`audit/findings.md`, `audit/reports/internal-audit-v1.md`), `CHANGELOG.md`,
and the captured `audit/reports/coverage-v1.txt` / `slither-v1.txt`.

## Methodology

1. **Line-by-line diff walk.** Every `+` / `-` line in `git diff
   6a4a8b8..359fbb8 -- src/` was read in context against the surrounding
   unchanged code.
2. **Adversarial edge-case sweep.** For the M-01 gate: empty-state bootstrap,
   equal-timestamp re-submission, mixed heartbeat/consumer-driven ordering,
   front-running with later-timestamp captured payloads, malicious-reporter
   `timestamp = uint256.max - 1` brick attempt, chain re-org behaviour. For
   M-02: `SafeCast.toInt256` upper-bound boundary at `10^77`, the existing
   `10**diff` overflow path at `diff >= 78`, OZ v5 import path correctness,
   on-chain caller surface.
3. **Toolchain re-verification.** `npx hardhat test` (77 passing) and
   `npm run slither` (0 results) re-run against the live tree.
4. **Storage layout diff.** Verified manually against
   `audit/reports/storage-layouts.md` that the fix introduces no new state
   variables (`StaleTimestamp` is an error declaration; the SLOAD reads an
   existing slot via `_rounds[latestRoundId].startedAt`).
5. **Slither suppression re-walk.** The six suppressions carried into v1 were
   re-evaluated under the diff. No new suppressions were added.
6. **Test-suite adequacy review.** Mapped the new gate's branches and the
   `SafeCast` boundary against existing test coverage.

## Findings table

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| R-01 | Low | Monotonic-`startedAt` gate creates a brick path on malicious or buggy reporter quorum supplying `timestamp = uint256.max - 1` | open (informational; same trust-prerequisite as arbitrary-price manipulation) |
| R-02 | Low | Consumer-driven fulfillments with stale reporter-attested timestamps become permanently unfulfillable once a heartbeat advances `latestStartedAt` past them | open (operational / off-chain pipeline contract change) |
| R-03 | Informational | New gate fires before signature verification — same-timestamp resubmission produces a `StaleTimestamp` revert that does not identify the caller as authorized vs. not | accepted (lower attack surface; cheaper) |
| R-04 | Informational | Test suite does not explicitly assert the bootstrap branch (`latestRoundId == 0 → latestStartedAt == 0 → gate degenerates to `timestamp > 0`) | accepted (covered transitively by every other test; explicit test would harden) |

**Verdict on originals:**

- **M-01: closed-with-caveat.** The original heartbeat-replay path is now
  unreachable. R-01 and R-02 document new operational surfaces caused by the
  gate; neither rises to a security defect of the M class (R-01 has the same
  prerequisite as already-acknowledged reporter trust; R-02 is an operational
  contract change between the on-chain feed and the off-chain pipeline).
- **M-02: closed.** `SafeCast.toInt256` reverts deterministically at the
  boundary; the OZ v5 import path is correct; no on-chain callers exist (per
  the original audit, re-verified); the OZ symbol is canonical and well-known.

## Per-finding write-ups

---

### R-01 — Monotonic-`startedAt` gate makes a colluding reporter quorum able to permanently brick `fulfillPrice`

- **Severity:** Low
- **Site:** `src/core/PriceAggregator.sol:156-163` (the new gate)
- **Status:** open (informational; documented residual risk)

#### Description

The fix reads `_rounds[latestRoundId].startedAt` and rejects any submission
with `timestamp <= latestStartedAt`. Pre-fix, a colluding M-of-N reporter
quorum could vandalize the live price (a known consequence of the M-of-N
trust assumption) but every vandalized round could be overwritten by a
subsequent legitimate fulfillment.

Post-fix, the same colluding quorum can submit a heartbeat with
`timestamp = type(uint256).max - 1` (a valid quorum-signed message — the
gate runs *before* signature verification, but the malicious quorum can
supply valid signatures). After this submission lands,
`latestStartedAt == type(uint256).max - 1`, and only a submission with
`timestamp == type(uint256).max` can pass. If the attacker then submits a
second message with `timestamp == type(uint256).max`, `latestStartedAt`
becomes `type(uint256).max` — the strict-greater-than gate cannot be
satisfied by any subsequent `uint256` value. The aggregator is permanently
unable to record a new round.

There is no on-chain recovery: `latestRoundId`, `_rounds[*].startedAt`, and
the new gate's read of them have no owner-controlled setter.
`setReporterSet` only swaps the signature verifier — it does not reset the
round state. The only recourse is to redeploy the aggregator (and update
`OracleRegistry`).

#### Severity rationale

Marked **Low** rather than Medium because:

1. **Prerequisite is reporter-quorum compromise**, which is already
   acknowledged as the highest trust assumption in the threat model
   (`audit/THREAT_MODEL.md` "Residual risks"). A compromised quorum can
   already publish arbitrary garbage prices; this finding adds "and can
   make recovery impossible without redeploy" as a worse outcome.
2. **Pre-fix, the same quorum could vandalize live data with no replay
   resistance.** The fix trades a slow-burn vandalism surface for a
   discrete-but-permanent brick surface. For a demo with
   `maxAge = type(uint256).max`, this is plausibly a *worse* trade in
   liveness terms; for production with finite `maxAge`, it's roughly
   equivalent.
3. **Recovery via redeploy is cheap** (no migrated state across the
   aggregator boundary; consumers read by `assetId` through
   `OracleRegistry`, which the owner can re-point).

Not a Medium because the trust prerequisite is already accepted.
Informational candidacy considered but lifted to Low because the brick is
permanent (not just transient) and not noted anywhere in the spec or
threat model post-remediation.

#### Recommendation (optional, owner discretion)

Either:

1. **Cap `timestamp` at submission.** Reject `timestamp >
   block.timestamp + tolerance` where `tolerance` is a small skew budget
   (e.g. 600s). This bounds the worst-case `latestStartedAt` to
   `block.timestamp + tolerance`, restoring the property that future
   legitimate reporters can always supply a fresh-enough timestamp.
2. **Add an owner-only `resetLatestRound(uint256 newStartedAt)` escape
   hatch.** Marks a quorum compromise discoverable and recoverable
   without redeploy. Bigger blast-radius surface; owner-trust dependent.
3. **Document the residual risk explicitly** in
   `audit/THREAT_MODEL.md` under "Residual risks" and leave the code as-is.

Option 1 is the most defensive and aligns with the existing `maxAge` policy
(which already polices below-now skew); a symmetric above-now skew cap
mirrors that. The current code accepts arbitrary above-now timestamps,
which spec §F-4 documents as deliberate "clock-skew tolerance upward" — but
the upward tolerance is currently unbounded, and the new gate makes that
unboundedness a brick vector.

---

### R-02 — Consumer-driven fulfillments with older reporter-attested timestamps become permanently unfulfillable

- **Severity:** Low
- **Site:** `src/core/PriceAggregator.sol:156-163` (the new gate, all submission paths)
- **Status:** open (operational; contract change between aggregator and off-chain pipeline)

#### Description

The gate orders by reporter-attested `timestamp`, not by `reqId`. If the
off-chain pipeline:

1. Accepts consumer request `reqId = 42` at observation-time `T`.
2. Begins quorum signature collection (this can take seconds).
3. In the meantime, a heartbeat fires with a fresher observation time
   `T + δ` and is fulfilled, advancing `latestStartedAt` to `T + δ`.
4. The pipeline then submits the consumer-driven fulfillment for `reqId =
   42` with the original `timestamp = T`.

The submission for `reqId = 42` reverts `StaleTimestamp(T, T + δ)` even
though every signature is valid and the request was legitimately requested.
The consumer paid `requestFee` but the request can never be filled with the
original observation. The off-chain pipeline must either:

- Re-aggregate `reqId = 42` with a fresher `timestamp` and re-collect
  signatures (incurs a second round-trip per dropped request).
- Document and shed the dropped request (refund logic at the application
  layer; nothing on-chain refunds the fee since `requestFee` was already
  consumed).
- Submit consumer-driven fulfillments *before* any concurrent heartbeat (a
  total-ordering constraint on the pipeline that the on-chain code does
  not enforce).

Pre-fix, this could not happen: any submission with valid signatures landed,
regardless of timestamp ordering. The fix introduces a new total-ordering
invariant that the off-chain pipeline must respect.

#### Severity rationale

Marked **Low** because:

1. **No funds are stuck on-chain** in a way the protocol cannot resolve —
   `requestFee` was an irrevocable payment for the request channel, not an
   escrow. The pipeline can re-aggregate and submit fresh.
2. **The off-chain pipeline is already designed around timestamp ordering**
   per spec §3.2 (the price-service publishes a single canonical observation
   timeline). Heartbeats and consumer-driven requests share that timeline,
   so in practice both paths see the same monotonic timestamp.
3. **Pre-existing behaviour** (`reqId` replay guard, `maxAge` policy) made
   the off-chain pipeline already responsible for not submitting stale data.
   The new gate strengthens that contract rather than introducing it.

Informational candidacy considered but lifted to Low because the failure mode
is a permanent inability to fulfil a paid-for consumer request — that is
behavioural drift the integrators need to know about, not pure documentation.

#### Recommendation

Document the gate's ordering implication in the `fulfillPrice` NatSpec
(currently the gate is described in an inline comment but not surfaced to
the integrator). Suggest also documenting in spec §1 / spec §3.2 that the
off-chain pipeline must guarantee strict-monotonic `timestamp` across
heartbeat *and* consumer-driven submissions for a given aggregator.

---

### R-03 — `StaleTimestamp` revert leaks no caller-authorization information (informational)

- **Severity:** Informational
- **Site:** `src/core/PriceAggregator.sol:156-163`
- **Status:** accepted (correct ordering of checks)

#### Description

The gate fires *before* signature verification. A submission with an old
timestamp from an unauthorized caller reverts the same way as one from a
legitimate-but-stale source. This is the **correct** ordering: a stale
timestamp is cheaper to detect than a quorum check (SLOAD vs. several
ECDSA recoveries), and a stale submission is invalid regardless of who
submitted it. No information disclosure issue — the gate is symmetric.

Logged here only because the original M-01 PoC's revert message
specifically mentioned `wallets[8]` (a stranger); a reader of the patched
test might assume the gate is enforcing authorization. It is not. The gate
is a property of the *submission*, not the *submitter*.

#### Recommendation

None — the ordering is correct (cheap-checks-first). The audit narrative in
`audit/findings.md#M-01` already frames the gate as a property of the
submission timestamp, so no documentation change required.

---

### R-04 — Bootstrap branch (`latestRoundId == 0`) not directly exercised by a dedicated test (informational)

- **Severity:** Informational
- **Site:** `test/audit/HeartbeatReplay.audit.test.ts`, `test/unit/PriceAggregator.test.ts`
- **Status:** accepted (covered transitively; explicit test would harden)

#### Description

Every existing `fulfillPrice` test starts from `latestRoundId == 0` and
fulfils a first round. So the bootstrap branch
(`latestStartedAt == _rounds[0].startedAt == 0`, gate degenerates to
`timestamp > 0`) is exercised every time the suite runs. There is no
*dedicated* test that asserts the bootstrap-branch behaviour (e.g. one
that calls `fulfillPrice` with `timestamp = 0` on a fresh aggregator and
expects `StaleTimestamp(0, 0)`).

Such a test would be a single line and would document the
"`timestamp = 0` is implicitly rejected" floor behaviour the NatSpec
mentions but does not exercise.

#### Recommendation

Optional: add the boundary test. The current suite covers the bootstrap
branch behavior transitively in every passing case, so this is purely a
documentation-via-test refinement.

---

## New attack surface summary (no new findings beyond R-01..R-04)

The brief asked specifically about:

| Concern | Result |
|---------|--------|
| Gas griefing — new SLOAD in hot path | Acceptable. Cold→warm SLOAD on the first read in a transaction (~2,100 gas), warm thereafter (~100 gas). Same slot read elsewhere if `_rounds[latestRoundId]` is also written later in the same call. Negligible relative to the ECDSA recovery cost (~3000 gas × M signatures). |
| DoS — `timestamp = uint256.max - 1` brick | Real but with reporter-quorum prerequisite. Filed as **R-01** (Low). |
| Storage layout shift | None. `StaleTimestamp` is an error declaration (zero storage). The SLOAD reads `_rounds[latestRoundId].startedAt`, an existing slot. Confirmed against `audit/reports/storage-layouts.md`. |
| `SafeCast` import surface | `@openzeppelin/contracts/utils/math/SafeCast.sol` line 1146 — `toInt256(uint256)` is a pure internal function with one error (`SafeCastOverflowedUintToInt`). No transitive imports beyond what OZ already had. The error selector is the standard OZ one; consumers can ABI-decode without re-implementing it. |
| Slither suppression re-evaluation | All six pre-existing suppressions remain valid. The new gate does not touch any suppressed line. No new suppression was added. |
| Front-running attack | An attacker with access to any quorum-signed payload with a `timestamp > T` (the target's intended observation time) can race the legitimate submission. The attacker can only use *already-signed* payloads — they cannot synthesise signatures. This is captured by R-02 (consumer-driven fulfillments may be unfulfillable when an attacker pushes `latestStartedAt` past their `timestamp`). The attacker gains no economic upside from front-running with already-signed legitimate data; they only force a re-aggregation. |
| Chain re-org | The gate compares against on-chain state (`_rounds[*].startedAt`), which re-orgs along with everything else. A previously-accepted heartbeat that got re-org'd out simply isn't there in the new chain history; the gate state matches. Not a separate concern. |

## Test-suite adequacy

The relevant changes covered:

- **M-01 gate, strictly-newer pass:** `test/audit/HeartbeatReplay.audit.test.ts` (both tests; the first writes timestamps `100, 200`).
- **M-01 gate, equal-timestamp revert:** `test/audit/HeartbeatReplay.audit.test.ts` test 2 (timestamps `50, 50`).
- **M-01 gate, strictly-older revert:** `test/audit/HeartbeatReplay.audit.test.ts` test 1 (the second `fulfillPrice` call replays `timestamp=100` after `latestStartedAt=200`).
- **M-01 gate, bootstrap branch:** transitively in every test that calls `fulfillPrice` first; **no dedicated boundary test** (filed as R-04 informational).
- **M-02 boundary up:** `test/audit/PriceLibScaleTo.audit.test.ts` "diff = 76 still returns the correct positive factor" + "diff = 77 now reverts via SafeCast".
- **M-02 boundary down:** `test/audit/PriceLibScaleTo.audit.test.ts` "diffDown = 77 now reverts via SafeCast".
- **M-02 secondary overflow path:** `test/audit/PriceLibScaleTo.audit.test.ts` "scale-up still reverts when the product itself would overflow int256".

The rewritten audit PoCs are *meaningful regression tests* (not just
"expects to revert"): each asserts the specific custom error from the fix
path (`StaleTimestamp` / `SafeCastOverflowedUintToInt`) at the exact
boundary the original PoC demonstrated as exploitable. They would fail if
either fix were reverted.

The existing `fulfillPrice: reqId=0 (heartbeat) allows repeated submissions`
test at `test/unit/PriceAggregator.test.ts:167-184` uses strictly-monotonic
timestamps `1n, 2n` and continues to pass — but it does **not** verify the
gate. The audit suite carries that responsibility now. This is fine.

`test/property/PriceLib.property.test.ts` constrains `srcDecimals`,
`dstDecimals` to `0..30` and `0..18`, well below the 77 boundary — the
property suite does not exercise the SafeCast revert path. The audit suite
in `test/audit/PriceLibScaleTo.audit.test.ts` covers it deterministically.

## Documentation drift

- **`fulfillPrice` NatSpec.** The contract-level NatSpec at
  `src/core/PriceAggregator.sol:12-22` mentions `reqId == 0` heartbeat
  semantics but does **not** mention the monotonic-`startedAt` gate
  introduced by the M-01 fix. The gate is documented only in an inline
  comment at lines 156-159 inside the function body. A consumer reading the
  contract-level NatSpec would not learn that fulfillments must carry
  strictly-monotonic `timestamp` values. Suggest adding a `@dev` line to the
  contract or function NatSpec referencing the gate. (Captured in R-02
  recommendation.)
- **`PriceLib.scaleTo` NatSpec.** Updated correctly to reference the
  `SafeCast.toInt256` revert behaviour. Accurate.
- **`audit/findings.md` M-01 / M-02 sections.** Each has a clearly-marked
  "Remediation applied (2026-05-21)" sub-section that captures the fix and
  references the new error / OZ symbol. Accurate.
- **`audit/reports/internal-audit-v1.md` headline.** Updated to mark both
  Mediums as `remediated`, the executive summary table, the Findings table,
  the per-function properties (F-9 added for the new gate, S-3 updated for
  `SafeCast`). Accurate.
- **`audit/CHECKLIST.md`.** Row 12 of the `PriceAggregator` table still
  reads "PASS / FAIL ... Heartbeat (`reqId == 0`): FAIL — see M-01."
  **This row is now stale** — post-remediation, the heartbeat path *is*
  replay-protected via the monotonic-`startedAt` gate. The row should
  read "PASS" with a remediation reference. Captured in the re-audit
  appendix below; not filed as a finding (documentation drift, not a
  code defect).

## Re-audit verdict on original findings

| ID | Original severity | Original status | Re-audit verdict |
|----|-------------------|-----------------|------------------|
| M-01 | Medium | open | **closed-with-caveat** — the heartbeat-replay path is unreachable post-fix; new operational surfaces filed as R-01 (Low) and R-02 (Low) which the owner should triage but do not re-open M-01. |
| M-02 | Medium | open | **closed** — `SafeCast.toInt256` reverts deterministically at the boundary; OZ v5 import path correct; on-chain reachability unchanged (none). |

## Tools state at re-audit

- `npx hardhat test`: **77 passing**, 0 failing.
- `npm run slither`: **0 result(s) found** (23 contracts, 94 detectors).
- Coverage: 100% line + statement on `src/core/PriceAggregator.sol` and
  `src/libs/PriceLib.sol` (per `audit/reports/coverage-v1.txt`).

## Appendix — CHECKLIST.md row 12 drift

`audit/CHECKLIST.md` row 12 of the `PriceAggregator` table marks the
heartbeat replay protection as `PASS / FAIL`. Post-remediation it is
unambiguously PASS. This appendix records the drift for the next pass
to clean up. Not filed as a finding because the audit history is
intentionally preserved for traceability.

## Sign-off

| Reviewer | Identity | Date | Status |
|----------|----------|------|--------|
| Re-audit engineer (agent) | claude (general-purpose subagent) | 2026-05-21 | draft submitted |
| Peer reviewer (human) | _(blank pending sign-off)_ | _(blank)_ | _(blank)_ |

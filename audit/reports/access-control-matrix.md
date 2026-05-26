# Access-control matrix — internal-audit-v1

Rows: roles. Columns: every mutating function across `PriceAggregator`,
`OracleRegistry`, `ReporterSet`. Cells: `allowed` / `reverts(error-name)`.

Implicit context:
- "Owner" = the account stored at OZ `Ownable._owner` for the contract in
  question. Two-step transfer applies to `transferOwnership` only.
- "Reporter" = an address with `IReporterSet.isReporter == true`. Reporters
  have NO on-chain action surface — they only sign off-chain.
- "Anyone" = any EOA / contract that is neither owner nor (where listed)
  reporter. `msg.sender` falls in this row for any caller not matching a more
  specific row.

## PriceAggregator

| Role | `requestPrice` | `fulfillPrice` | `setRequestFee` | `setMaxAge` | `setReporterSet` | `transferOwnership` | `acceptOwnership` | `renounceOwnership` |
|------|----------------|----------------|-----------------|-------------|------------------|---------------------|-------------------|---------------------|
| Owner | allowed (pays fee like anyone) | allowed (no privilege needed; sigs are the gate) | allowed | allowed | allowed (`ZeroReporterSet` on zero address) | allowed | only if also `_pendingOwner` (n/a) | allowed |
| Pending owner | allowed | allowed | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | allowed | reverts(OwnableUnauthorizedAccount) |
| Reporter | allowed | allowed | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | n/a | reverts(OwnableUnauthorizedAccount) |
| Anyone | allowed (must send ≥ `requestFee`) | allowed (relies on M-of-N sig quorum) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | n/a | reverts(OwnableUnauthorizedAccount) |

Notes:
- `requestPrice` additionally reverts `InsufficientFee` on under-pay,
  `RefundFailed` if the caller cannot accept the ETH refund.
- `fulfillPrice` additionally reverts `ReqIdAlreadyFulfilled` on replay (for
  `reqId != 0`), `SubmissionTooOld` if `maxAge` is finite and breached, and
  `InsufficientSignatures` on quorum miss.

### Negative-test coverage notes

- `setRequestFee` non-owner → covered (`PriceAggregator.test.ts:318-329`).
- `setMaxAge` non-owner → **not directly covered** with a negative test.
  Coverage is implicit (the modifier is shared with the other setters which
  *are* tested), but explicit coverage would be one test. Filed as a
  "test-suite gap" observation in `reports/internal-audit-v1.md`.
- `setReporterSet` non-owner → **not directly covered**. Same observation.
- `setReporterSet` zero-address → covered
  (`PriceAggregator.test.ts:353-366`).
- `fulfillPrice` insufficient sigs → covered
  (`PriceAggregator.test.ts:186-200`).
- `fulfillPrice` non-reporter sigs → covered (`...:219-235`).
- `fulfillPrice` wrong asset → covered (`...:202-217`).
- `fulfillPrice` reqId-replay → covered (`...:150-165`).
- `fulfillPrice` `SubmissionTooOld` → covered (`...:237-252`).
- `requestPrice` insufficient fee → covered (`...:107-118`).
- `requestPrice` refund-failed → covered (`...:340-351`, via `NonPayableCaller`).

## OracleRegistry

| Role | `registerAsset` | `transferOwnership` | `acceptOwnership` | `renounceOwnership` |
|------|-----------------|---------------------|-------------------|---------------------|
| Owner | allowed | allowed | n/a (unless self-set as pending) | allowed |
| Pending owner | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | allowed | reverts(OwnableUnauthorizedAccount) |
| Anyone | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | n/a | reverts(OwnableUnauthorizedAccount) |

`registerAsset` additionally reverts `ZeroAssetId` on zero id and
`ZeroAggregator` on zero address.

### Negative-test coverage notes

- `registerAsset` non-owner → covered (`OracleRegistry.test.ts:86-98`).
- `registerAsset` zero asset id → covered (`...:64-73`).
- `registerAsset` zero aggregator → covered (`...:75-84`).

## ReporterSet

| Role | `addReporter` | `removeReporter` | `setThreshold` | `transferOwnership` | `acceptOwnership` | `renounceOwnership` |
|------|---------------|------------------|----------------|---------------------|-------------------|---------------------|
| Owner | allowed | allowed | allowed | allowed | n/a | allowed |
| Pending owner | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | allowed | reverts(OwnableUnauthorizedAccount) |
| Reporter | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | n/a | reverts(OwnableUnauthorizedAccount) |
| Anyone | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | reverts(OwnableUnauthorizedAccount) | n/a | reverts(OwnableUnauthorizedAccount) |

`addReporter` additionally reverts `ZeroReporter` / `ReporterAlreadyExists`.
`removeReporter` additionally reverts `ReporterNotFound` /
`ThresholdExceedsReporterCount`. `setThreshold` additionally reverts
`ZeroThreshold` / `ThresholdExceedsReporterCount`.

### Negative-test coverage notes

- `addReporter` non-owner → covered (`ReporterSet.test.ts:85-100`).
- `addReporter` zero-address → covered (`...:102-107`).
- `addReporter` duplicate → covered (`...:109-119`).
- `removeReporter` non-owner → **not directly covered**. Filed as test-suite
  gap (modifier shared with the *covered* `addReporter` non-owner; explicit
  coverage would be one additional test).
- `removeReporter` not-found → covered (`...:151-160`).
- `removeReporter` below-threshold → covered (`...:162-172`).
- `setThreshold` non-owner → **not directly covered**. Same observation.
- `setThreshold` zero → covered (`...:184-193`).
- `setThreshold` exceeds-count → covered (`...:195-208`).
- `transferOwnership` two-step happy path → **not directly covered for any of
  the three contracts**. (OZ `Ownable2Step` is already its own well-audited
  base; treating as out of scope. Worth a single end-to-end test for the
  rotation flow nonetheless.)

## Observed test-suite gaps (rolled up)

The matrix above flags four explicit gaps in negative-test coverage:

1. `PriceAggregator.setMaxAge` non-owner.
2. `PriceAggregator.setReporterSet` non-owner.
3. `ReporterSet.removeReporter` non-owner.
4. `ReporterSet.setThreshold` non-owner.

Plus the two-step `Ownable2Step` rotation is unexercised across all three
contracts. None of these are exploitable defects (the modifier is shared with
covered functions and visibly correct on inspection), but they would
strengthen the suite. Recommend adding when the human peer review pass runs.

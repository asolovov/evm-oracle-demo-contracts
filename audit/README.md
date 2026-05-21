# audit/

Internal audit deliverables for `evm-oracle-demo-contracts`. This tree is the
record of an independent security review conducted on the freshly merged core
contracts (commit at audit time noted in `reports/internal-audit-v1.md`).

The headline report lives at [`reports/internal-audit-v1.md`](reports/internal-audit-v1.md);
findings are tracked in [`findings.md`](findings.md); the threat model is in
[`THREAT_MODEL.md`](THREAT_MODEL.md); the peer-review checklist is in
[`CHECKLIST.md`](CHECKLIST.md).

## Re-running

```sh
# Static analysis
npm run slither | tee audit/reports/slither-v1.txt

# Tests + coverage
npx hardhat test                                 # 71 + audit-PoC tests
npx hardhat test mocha --coverage | tee audit/reports/coverage-v1.txt

# Storage layouts
/Users/asolovov/.solc-select/artifacts/solc-0.8.24/solc-0.8.24 \
    --storage-layout \
    @openzeppelin/=node_modules/@openzeppelin/ \
    @chainlink/=node_modules/@chainlink/ \
    --evm-version cancun \
    src/core/PriceAggregator.sol src/core/OracleRegistry.sol \
    src/core/ReporterSet.sol src/consumers/PriceConsumer.sol
```

## Tree

| Path | Purpose |
|------|---------|
| `findings.md` | Triaged findings (severity, site, evidence, status). |
| `THREAT_MODEL.md` | Actors, attack surface, mitigations, residual risks. |
| `CHECKLIST.md` | Peer self-review checklist walked per contract. |
| `reports/internal-audit-v1.md` | Headline report, draft status, awaiting peer sign-off. |
| `reports/access-control-matrix.md` | Role × mutating-function matrix with test coverage notes. |
| `reports/slither-v1.txt` | Raw `npm run slither` output. |
| `reports/coverage-v1.txt` | Raw `hardhat test --coverage` output. |
| `reports/storage-layouts.md` | Storage layouts of concrete contracts (baseline). |

## PoC tests

Findings supported by failing/demonstrating tests live under
`test/audit/*.audit.test.ts`. Those tests are NOT remediation tests — they
demonstrate the bug as it stands and may need to be inverted after a fix lands.

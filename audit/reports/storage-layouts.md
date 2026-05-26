# Storage layouts — internal-audit-v1

Baseline storage layouts of the concrete contracts. Captured via solc
`--storage-layout` for future diff-checking. Contracts are non-upgradeable in
v1, so the layout is informational rather than a compatibility constraint —
the file exists as cheap insurance if a v2 introduces upgradeability.

Generated with:

```sh
/Users/asolovov/.solc-select/artifacts/solc-0.8.24/solc-0.8.24 \
    --storage-layout \
    @openzeppelin/=node_modules/@openzeppelin/ \
    @chainlink/=node_modules/@chainlink/ \
    --evm-version cancun \
    src/core/PriceAggregator.sol src/core/OracleRegistry.sol \
    src/core/ReporterSet.sol src/consumers/PriceConsumer.sol
```

## PriceAggregator

| Slot | Offset | Bytes | Label | Type | Source |
|------|--------|-------|-------|------|--------|
| 0 | 0 | 20 | `_owner` | address | OZ `Ownable` |
| 1 | 0 | 20 | `_pendingOwner` | address | OZ `Ownable2Step` |
| 2 | 0 | 32 | `description` | string | line 65 |
| 3 | 0 | 32 | `requestFee` | uint256 | line 68 |
| 4 | 0 | 32 | `maxAge` | uint256 | line 72 |
| 5 | 0 | 20 | `reporterSet` | contract `IReporterSet` | line 75 |
| 5 | 20 | 10 | `latestRoundId` | uint80 | line 78 (packed with `reporterSet` — 30 bytes total in slot 5) |
| 6 | 0 | 32 | `nextReqId` | uint256 | line 81 |
| 7 | 0 | 32 | `fulfilled` (mapping head) | mapping(uint256 => bool) | line 85 |
| 8 | 0 | 32 | `_rounds` (mapping head) | mapping(uint80 => RoundData) | line 88 |

Notes:
- `reporterSet + latestRoundId` correctly pack into slot 5 (saving one slot
  versus naive ordering).
- Immutables (`assetId`, `decimals`, `version`) are bytecode-embedded — not in
  the storage table.
- `ReentrancyGuard` storage lives at the namespaced ERC-7201 slot
  `0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00` and
  does not appear in the `Contract Storage Layout` table.
- Slot 0 / 1 / 5 (the 20-byte address slots) waste 12 bytes each — not
  re-packable without ABI / inheritance changes.

## OracleRegistry

| Slot | Offset | Bytes | Label | Type |
|------|--------|-------|-------|------|
| 0 | 0 | 20 | `_owner` | address (OZ `Ownable`) |
| 1 | 0 | 20 | `_pendingOwner` | address (OZ `Ownable2Step`) |
| 2 | 0 | 32 | `_aggregator` (mapping head) | mapping(bytes32 => address) |
| 3 | 0 | 32 | `_assetList` (array head) | bytes32[] |

## ReporterSet

| Slot | Offset | Bytes | Label | Type |
|------|--------|-------|-------|------|
| 0 | 0 | 20 | `_owner` | address (OZ `Ownable`) |
| 1 | 0 | 20 | `_pendingOwner` | address (OZ `Ownable2Step`) |
| 2 | 0 | 32 | `_reporters` (array head) | address[] |
| 3 | 0 | 32 | `_isReporter` (mapping head) | mapping(address => bool) |
| 4 | 0 | 32 | `_indexOf` (mapping head) | mapping(address => uint256) |
| 5 | 0 | 32 | `_threshold` | uint256 |

## PriceConsumer

| Slot | Offset | Bytes | Label | Type |
|------|--------|-------|-------|------|
| 0 | 0 | 32 | `lastReqId` | uint256 |

`aggregator` is immutable — bytecode-embedded.

## Raw solc output

The full solc `--storage-layout` dump (with `types` blocks) is captured at
`/tmp/storage-layouts.txt` at audit time; regenerate via the command above
if needed for diff-checking.

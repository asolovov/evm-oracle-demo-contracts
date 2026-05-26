// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILighthouseAggregator} from "../interfaces/ILighthouseAggregator.sol";
import {IReporterSet} from "../interfaces/IReporterSet.sol";
import {PriceLib} from "../libs/PriceLib.sol";

/// @title  PriceAggregator
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice One instance per asset. Consumers pay a configurable fee to enqueue a price
///         request; the off-chain pipeline aggregates the price, has the M-of-N
///         reporters sign it, and submits the answer via `fulfillPrice`. Reads are
///         100% ABI-compatible with Chainlink's `AggregatorV3Interface`.
/// @dev    `reqId == 0` is reserved for heartbeat updates and is *not* subject to the
///         per-reqId replay guard — heartbeats are expected to recur. The EIP-712
///         digest (built in `PriceLib`) still includes the timestamp, so two
///         heartbeats with identical (price, timestamp) inputs would deduplicate
///         off-chain naturally.
contract PriceAggregator is ILighthouseAggregator, Ownable2Step, ReentrancyGuard {
    /// @notice Reverts when `msg.value` on `requestPrice` is below `requestFee`.
    error InsufficientFee(uint256 sent, uint256 required);

    /// @notice Reverts when the refund of the excess fee fails.
    error RefundFailed();

    /// @notice Reverts when a consumer-bound `reqId` has already been fulfilled.
    error ReqIdAlreadyFulfilled(uint256 reqId);

    /// @notice Reverts when the digest cannot collect `threshold` distinct authorized signers.
    error InsufficientSignatures();

    /// @notice Reverts in strict mode when the reporter-attested timestamp is older
    ///         than `maxAge`.
    error SubmissionTooOld(uint256 submittedAt, uint256 currentMaxAge);

    /// @notice Reverts when the submitted `timestamp` does not strictly exceed the latest
    ///         stored round's `startedAt`. Prevents replay of previously-signed payloads —
    ///         including heartbeat (`reqId == 0`) submissions — regardless of the `maxAge`
    ///         policy. See audit/findings.md#M-01.
    error StaleTimestamp(uint256 submittedAt, uint256 latestStartedAt);

    /// @notice Reverts on attempts to install the zero reporter set.
    error ZeroReporterSet();

    /// @notice Reverts on `latestRoundData` / `getRoundData` when no round exists.
    error NoRoundData();

    /// @dev Per-round snapshot. `startedAt` = reporter-attested observation time;
    ///      `updatedAt` = on-chain timestamp at which the fulfillment landed.
    struct RoundData {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    /// @notice Canonical asset id (e.g. keccak256("WETH/USD")).
    bytes32 public immutable override assetId;

    /// @notice Number of decimal places in the aggregated answer (Chainlink-compatible).
    /// @dev    Returned by `IAggregatorV3.decimals()`.
    uint8 public immutable override decimals;

    /// @notice Monotonically increasing version identifier (Chainlink-compatible).
    uint256 public immutable override version;

    /// @notice Human-readable description (e.g. "WETH/USD - Lighthouse demo").
    string public override description;

    /// @notice Native-token fee charged by `requestPrice`.
    uint256 public override requestFee;

    /// @notice Maximum acceptable `submittedAt`-to-block-time skew. `type(uint256).max`
    ///         disables age gating (demo default).
    uint256 public override maxAge;

    /// @notice Active reporter set used to validate `fulfillPrice` submissions.
    IReporterSet public override reporterSet;

    /// @notice Most recent round id (`0` means no data yet).
    uint80 public latestRoundId;

    /// @notice Auto-incrementing request counter. The next assigned `reqId` is `nextReqId + 1`.
    uint256 public nextReqId;

    /// @notice Replay-protection oracle for consumer-driven requests. `reqId == 0` is never set
    ///         (heartbeat sentinel).
    mapping(uint256 => bool) public fulfilled;

    /// @dev Round storage. Use `getRoundData` / `latestRoundData` to read.
    mapping(uint80 => RoundData) private _rounds;

    /// @notice Deploy an aggregator wired to a specific asset and reporter set.
    /// @param  initialOwner Owner that may tune fees, age policy, and reporter set.
    /// @param  reporterSet_ Initial reporter set (must be non-zero).
    /// @param  assetId_     Canonical asset identifier this aggregator publishes prices for.
    /// @param  decimals_    Decimal places of the aggregated answer (Chainlink convention is 8).
    /// @param  description_ Human-readable description of the feed.
    /// @param  version_     Version identifier surfaced to consumers via `version()`.
    /// @param  requestFee_  Initial per-request fee in wei.
    constructor(
        address initialOwner,
        IReporterSet reporterSet_,
        bytes32 assetId_,
        uint8 decimals_,
        string memory description_,
        uint256 version_,
        uint256 requestFee_
    ) Ownable(initialOwner) {
        if (address(reporterSet_) == address(0)) revert ZeroReporterSet();

        reporterSet = reporterSet_;
        assetId = assetId_;
        decimals = decimals_;
        description = description_;
        version = version_;
        requestFee = requestFee_;
        // Demo default: age gating disabled. Owner can tighten via `setMaxAge`.
        maxAge = type(uint256).max;
    }

    /// @inheritdoc ILighthouseAggregator
    function requestPrice() external payable override nonReentrant returns (uint256 reqId) {
        uint256 fee = requestFee;
        if (msg.value < fee) revert InsufficientFee(msg.value, fee);

        unchecked {
            reqId = ++nextReqId;
        }
        emit PriceRequested(reqId, msg.sender);

        uint256 refund;
        unchecked {
            refund = msg.value - fee;
        }
        if (refund > 0) {
            // External call after state mutation; guarded by `nonReentrant`.
            // slither-disable-next-line low-level-calls
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundFailed();
        }
    }

    /// @inheritdoc ILighthouseAggregator
    function fulfillPrice(
        uint256 reqId,
        int256 price,
        uint256 timestamp,
        bytes[] calldata signatures
    ) external override {
        if (reqId != 0 && fulfilled[reqId]) revert ReqIdAlreadyFulfilled(reqId);

        // Monotonic-timestamp gate: a new round must carry a strictly newer reporter-attested
        // observation time than the latest stored round. Closes the heartbeat-replay path
        // (audit/findings.md#M-01) independently of `maxAge`. On first fulfillment
        // `_rounds[0].startedAt == 0`, so the gate degenerates to `timestamp > 0` — sane.
        uint256 latestStartedAt = _rounds[latestRoundId].startedAt;
        if (timestamp <= latestStartedAt) {
            revert StaleTimestamp(timestamp, latestStartedAt);
        }

        uint256 currentMaxAge = maxAge;
        if (currentMaxAge != type(uint256).max) {
            uint256 nowTs = block.timestamp;
            /// @dev Slither flags any `block.timestamp` comparison as potentially miner-manipulable.
            ///      Here it is by design: `maxAge` is a configurable freshness policy, and the
            ///      tolerance band (`maxAge`) is always orders of magnitude larger than the
            ///      worst-case miner-skew (~15s) so the manipulation surface is zero.
            // slither-disable-next-line timestamp
            if (timestamp < nowTs && nowTs - timestamp > currentMaxAge) {
                revert SubmissionTooOld(timestamp, currentMaxAge);
            }
        }

        bytes32 digest = PriceLib.buildDigest(reqId, assetId, price, timestamp, block.chainid, address(this));
        IReporterSet rs = reporterSet;
        if (!PriceLib.verifySignatures(digest, signatures, rs.getReporters(), rs.getThreshold())) {
            revert InsufficientSignatures();
        }

        if (reqId != 0) {
            fulfilled[reqId] = true;
        }

        uint80 newRoundId;
        unchecked {
            newRoundId = latestRoundId + 1;
        }
        latestRoundId = newRoundId;
        _rounds[newRoundId] = RoundData({answer: price, startedAt: timestamp, updatedAt: block.timestamp});

        emit PriceFulfilled(reqId, price, timestamp);
    }

    /// @inheritdoc ILighthouseAggregator
    function setRequestFee(uint256 newFee) external override onlyOwner {
        uint256 old = requestFee;
        requestFee = newFee;
        emit RequestFeeChanged(old, newFee);
    }

    /// @inheritdoc ILighthouseAggregator
    function setMaxAge(uint256 newMaxAge) external override onlyOwner {
        uint256 old = maxAge;
        maxAge = newMaxAge;
        emit MaxAgeChanged(old, newMaxAge);
    }

    /// @inheritdoc ILighthouseAggregator
    function setReporterSet(IReporterSet newReporterSet) external override onlyOwner {
        if (address(newReporterSet) == address(0)) revert ZeroReporterSet();
        IReporterSet old = reporterSet;
        reporterSet = newReporterSet;
        emit ReporterSetChanged(address(old), address(newReporterSet));
    }

    /// @notice Read historical round data. Reverts if `roundId` has not been recorded.
    /// @param  roundId The round to read.
    /// @return roundId_        Same as input.
    /// @return answer          Recorded price.
    /// @return startedAt       Reporter-attested observation time.
    /// @return updatedAt       On-chain timestamp at fulfillment.
    /// @return answeredInRound Same as `roundId_` (single-round answers; no late
    ///                         clearing rounds exist in this design).
    function getRoundData(
        uint80 roundId
    )
        external
        view
        override
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        RoundData memory r = _rounds[roundId];
        /// @dev `updatedAt == 0` is the existence check — `fulfillPrice` always writes a non-zero
        ///      `block.timestamp` (the chain genesis cannot have block 0 reached at runtime), so
        ///      a zero `updatedAt` unambiguously means "round never recorded". Treated as
        ///      timestamp/strict-equality by Slither; intentional.
        // slither-disable-next-line incorrect-equality,timestamp
        if (r.updatedAt == 0) revert NoRoundData();
        return (roundId, r.answer, r.startedAt, r.updatedAt, roundId);
    }

    /// @notice Read the most recent round. Reverts if no round has been recorded.
    /// @return roundId         Most recent round id.
    /// @return answer          Most recent recorded price.
    /// @return startedAt       Reporter-attested observation time for `answer`.
    /// @return updatedAt       On-chain timestamp at which the answer was recorded.
    /// @return answeredInRound Same as `roundId`.
    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        uint80 latest = latestRoundId;
        if (latest == 0) revert NoRoundData();
        RoundData memory r = _rounds[latest];
        return (latest, r.answer, r.startedAt, r.updatedAt, latest);
    }
}

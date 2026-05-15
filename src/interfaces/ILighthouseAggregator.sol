// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "./IAggregatorV3.sol";
import {IReporterSet} from "./IReporterSet.sol";

/// @title  ILighthouseAggregator
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Pull-style oracle aggregator. Extends Chainlink's read interface with a
///         request/fulfill cycle: consumers call `requestPrice` and pay the configured fee;
///         the off-chain pipeline aggregates from multiple sources, has M-of-N reporters
///         sign the result, and submits the answer via `fulfillPrice`.
/// @dev    See `PriceLib.buildDigest` for the EIP-712 payload that reporters sign.
interface ILighthouseAggregator is IAggregatorV3 {
    /// @notice Emitted when a consumer requests an updated price.
    /// @param reqId     Monotonic request id assigned by the aggregator.
    /// @param requester Address that paid the fee and initiated the request.
    event PriceRequested(uint256 indexed reqId, address indexed requester);

    /// @notice Emitted when `fulfillPrice` accepts a reporter-signed submission.
    /// @param reqId     Request id being fulfilled (0 for heartbeat updates).
    /// @param price     Aggregated price written into the round.
    /// @param timestamp Reporter-attested timestamp for the price.
    event PriceFulfilled(uint256 indexed reqId, int256 price, uint256 timestamp);

    /// @notice Emitted when the request fee changes.
    /// @param oldFee Previous fee in wei.
    /// @param newFee New fee in wei.
    event RequestFeeChanged(uint256 oldFee, uint256 newFee);

    /// @notice Emitted when the maximum acceptable submission age changes.
    /// @param oldMaxAge Previous max-age value (seconds).
    /// @param newMaxAge New max-age value (seconds). `type(uint256).max` disables gating.
    event MaxAgeChanged(uint256 oldMaxAge, uint256 newMaxAge);

    /// @notice Emitted when the reporter set contract is swapped.
    /// @param oldReporterSet Previous `IReporterSet` address.
    /// @param newReporterSet New `IReporterSet` address.
    event ReporterSetChanged(address indexed oldReporterSet, address indexed newReporterSet);

    /// @notice Request an updated price. Caller must send at least `requestFee()` wei.
    /// @dev    Excess fee is refunded to `msg.sender` (reentrancy-guarded in the implementation).
    /// @return reqId Monotonically increasing identifier for the request.
    function requestPrice() external payable returns (uint256 reqId);

    /// @notice Submit a reporter-signed price for `reqId`. Reverts on insufficient quorum or replay.
    /// @param reqId      Request id being fulfilled. Use 0 for heartbeat updates.
    /// @param price      Aggregated price (scaled to `decimals()`).
    /// @param timestamp  Reporter-attested observation time for the price.
    /// @param signatures Array of 65-byte ECDSA signatures from authorized reporters. Order-independent.
    function fulfillPrice(uint256 reqId, int256 price, uint256 timestamp, bytes[] calldata signatures) external;

    /// @notice Asset identifier this aggregator publishes prices for (keccak256 of canonical symbol).
    function assetId() external view returns (bytes32);

    /// @notice Native-token fee charged by `requestPrice`.
    function requestFee() external view returns (uint256);

    /// @notice Maximum acceptable `submittedAt`-to-block-time skew. `type(uint256).max` in demo mode.
    function maxAge() external view returns (uint256);

    /// @notice Address of the active `IReporterSet`.
    function reporterSet() external view returns (IReporterSet);

    /// @notice Update the per-request fee. Owner-only.
    /// @param newFee New fee in wei.
    function setRequestFee(uint256 newFee) external;

    /// @notice Update the maximum acceptable submission age. Owner-only.
    /// @dev    Setting to `type(uint256).max` disables age gating (demo default).
    /// @param newMaxAge New max-age value (seconds).
    function setMaxAge(uint256 newMaxAge) external;

    /// @notice Swap the reporter set contract. Owner-only.
    /// @param newReporterSet New `IReporterSet` address.
    function setReporterSet(IReporterSet newReporterSet) external;
}

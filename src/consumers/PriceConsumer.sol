// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ILighthouseAggregator} from "../interfaces/ILighthouseAggregator.sol";

/// @title  PriceConsumer
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Minimal end-to-end example. Reads the latest answer via the Chainlink-compatible
///         interface and forwards user-initiated `requestPrice` calls, recording the
///         assigned `reqId` for the dashboard to surface.
/// @dev    Intentionally thin — production consumers would do their own access control,
///         input validation, and post-fulfillment processing.
contract PriceConsumer {
    /// @notice Reverts when the request-fee refund forwarded by the aggregator cannot
    ///         be relayed back to `msg.sender`.
    error RefundForwardFailed();

    /// @notice Aggregator this consumer reads from.
    ILighthouseAggregator public immutable aggregator;

    /// @notice The most recent `reqId` returned by `aggregator.requestPrice`.
    uint256 public lastReqId;

    /// @notice Wire the consumer to a specific aggregator.
    /// @param aggregator_ Aggregator the consumer should read from and request prices against.
    constructor(ILighthouseAggregator aggregator_) {
        aggregator = aggregator_;
    }

    /// @notice Forward a price request to `aggregator`, paying its current fee from `msg.value`.
    /// @dev    Any refund returned by the aggregator is relayed back to the original caller.
    ///         The post-call `lastReqId = reqId` write is intentionally after the external
    ///         call (the aggregator is `nonReentrant`; the field is a notification surface
    ///         never read inside the call), so the slither `reentrancy-benign` suppression
    ///         lives next to the assignment below.
    /// @return reqId The assigned request id (also stored in `lastReqId`).
    function requestPrice() external payable returns (uint256 reqId) {
        uint256 balanceBefore = address(this).balance - msg.value;
        reqId = aggregator.requestPrice{value: msg.value}();
        // slither-disable-next-line reentrancy-benign
        lastReqId = reqId;

        uint256 refund = address(this).balance - balanceBefore;
        if (refund > 0) {
            // slither-disable-next-line low-level-calls
            (bool ok, ) = msg.sender.call{value: refund}("");
            if (!ok) revert RefundForwardFailed();
        }
    }

    /// @notice Read the most recent reported answer through the Chainlink interface.
    /// @dev    Intentionally discards `roundId`, `startedAt`, `updatedAt`, `answeredInRound`
    ///         — this consumer cares only about the answer. The slither `unused-return`
    ///         suppression lives next to the call below.
    /// @return answer Most recent price (scaled to `aggregator.decimals()`).
    function latestAnswer() external view returns (int256 answer) {
        // slither-disable-next-line unused-return
        (, answer, , , ) = IAggregatorV3(address(aggregator)).latestRoundData();
    }

    /// @notice Allow the contract to accept ETH refunds from the aggregator.
    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ILighthouseAggregator} from "../interfaces/ILighthouseAggregator.sol";

/// @title  PriceConsumer
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Minimal example consumer used for end-to-end tests and the dashboard demo.
///         Reads the latest answer via the Chainlink-compatible interface and forwards
///         user-initiated `requestPrice` calls, recording the assigned `reqId`.
/// @dev    Stub — full implementation lands in task 03.
contract PriceConsumer {
    /// @notice Aggregator this consumer reads from.
    ILighthouseAggregator public immutable aggregator;

    /// @notice The most recent `reqId` returned by `aggregator.requestPrice`.
    uint256 public lastReqId;

    /// @notice Wire the consumer to a specific aggregator.
    /// @param aggregator_ Aggregator the consumer should read from and request prices against.
    constructor(ILighthouseAggregator aggregator_) {
        aggregator = aggregator_;
    }

    /// @notice Read the most recent reported answer through Chainlink's interface.
    /// @return answer Most recent price (scaled to `aggregator.decimals()`).
    function latestAnswer() external view returns (int256 answer) {
        (, answer, , , ) = IAggregatorV3(address(aggregator)).latestRoundData();
    }
}

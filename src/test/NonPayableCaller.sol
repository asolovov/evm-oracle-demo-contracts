// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ILighthouseAggregator} from "../interfaces/ILighthouseAggregator.sol";

/// @title  NonPayableCaller
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Test-only helper. Calls `aggregator.requestPrice` payable but does
///         not implement `receive()`, so any refund the aggregator attempts to
///         send back fails — which is exactly the path tested for
///         `PriceAggregator.RefundFailed`.
contract NonPayableCaller {
    /// @notice Reverts when the aggregator's refund attempt fails, surfacing the
    ///         original revert reason.
    error CallFailed();

    /// @notice Forward an over-funded request to the aggregator; the refund attempt
    ///         must fail because this contract has no `receive()` / payable fallback.
    function callRequestPrice(ILighthouseAggregator aggregator) external payable returns (uint256 reqId) {
        return aggregator.requestPrice{value: msg.value}();
    }
}

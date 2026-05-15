// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @title  IAggregatorV3
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Re-export of Chainlink's `AggregatorV3Interface` under the project's `I`-prefixed
///         naming. Consumers should depend on this symbol so the upstream import path can
///         be swapped without touching call sites.
/// @dev    Pure re-export. No additional members.
interface IAggregatorV3 is AggregatorV3Interface {}

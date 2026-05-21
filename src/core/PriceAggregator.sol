// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILighthouseAggregator} from "../interfaces/ILighthouseAggregator.sol";

/// @title  PriceAggregator
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice One instance per asset. Accepts `requestPrice` calls from consumers and exposes
///         reporter-signed fulfillments through Chainlink-compatible round data.
/// @dev    Stub — full implementation lands in task 03.
abstract contract PriceAggregator is ILighthouseAggregator, Ownable2Step, ReentrancyGuard {
    /// @notice Bootstrap a new aggregator with `initialOwner` as the admin.
    /// @param initialOwner Address that owns the contract after deployment.
    constructor(address initialOwner) Ownable(initialOwner) {}
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IOracleRegistry} from "../interfaces/IOracleRegistry.sol";

/// @title  OracleRegistry
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Canonical `assetId` → `ILighthouseAggregator` directory.
/// @dev    Stub — full implementation lands in task 03.
abstract contract OracleRegistry is IOracleRegistry, Ownable2Step {
    /// @notice Bootstrap the registry with `initialOwner` as the admin.
    /// @param initialOwner Address that owns the contract after deployment.
    constructor(address initialOwner) Ownable(initialOwner) {}
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IReporterSet} from "../interfaces/IReporterSet.sol";

/// @title  ReporterSet
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice M-of-N authorized reporter registry. Owner-managed via `Ownable2Step`.
/// @dev    Stub — full implementation lands in task 03.
abstract contract ReporterSet is IReporterSet, Ownable2Step {
    /// @notice Bootstrap the reporter set with `initialOwner` as the admin.
    /// @param initialOwner Address that owns the contract after deployment.
    constructor(address initialOwner) Ownable(initialOwner) {}
}

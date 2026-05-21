// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IOracleRegistry} from "../interfaces/IOracleRegistry.sol";

/// @title  OracleRegistry
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Canonical `assetId` → `ILighthouseAggregator` directory. The off-chain
///         pipeline (price-service, indexer-service) discovers aggregators through
///         this contract so a single registry replaces every per-asset hard-coded address.
/// @dev    Insertion order is preserved in `_assetList`; pointing an `assetId` at a new
///         aggregator emits `AssetUpdated` without reordering the list.
contract OracleRegistry is IOracleRegistry, Ownable2Step {
    /// @notice Reverts on attempts to register `address(0)` as an aggregator.
    error ZeroAggregator();

    /// @notice Reverts on attempts to register `bytes32(0)` as an asset id.
    error ZeroAssetId();

    /// @dev `assetId` → aggregator address. `address(0)` means unregistered.
    mapping(bytes32 => address) private _aggregator;

    /// @dev Canonical insertion order of registered assets.
    bytes32[] private _assetList;

    /// @notice Bootstrap the registry.
    /// @param initialOwner Owner that may register / update aggregator pointers.
    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @inheritdoc IOracleRegistry
    function registerAsset(bytes32 assetId, address aggregator) external onlyOwner {
        if (assetId == bytes32(0)) revert ZeroAssetId();
        if (aggregator == address(0)) revert ZeroAggregator();

        address previous = _aggregator[assetId];
        _aggregator[assetId] = aggregator;

        if (previous == address(0)) {
            _assetList.push(assetId);
            emit AssetRegistered(assetId, aggregator);
        } else {
            emit AssetUpdated(assetId, previous, aggregator);
        }
    }

    /// @inheritdoc IOracleRegistry
    function getAggregator(bytes32 assetId) external view returns (address) {
        return _aggregator[assetId];
    }

    /// @inheritdoc IOracleRegistry
    function listAssets() external view returns (bytes32[] memory) {
        return _assetList;
    }
}

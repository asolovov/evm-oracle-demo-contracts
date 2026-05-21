// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  IOracleRegistry
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Directory mapping canonical `assetId` values (e.g. `keccak256("WETH/USD")`) to the
///         deployed `ILighthouseAggregator` contract for that asset.
interface IOracleRegistry {
    /// @notice Emitted the first time an `assetId` is registered.
    /// @param assetId    Canonical asset identifier.
    /// @param aggregator Address of the aggregator handling this asset.
    event AssetRegistered(bytes32 indexed assetId, address indexed aggregator);

    /// @notice Emitted when an already-registered `assetId` is repointed to a new aggregator.
    /// @param assetId       Canonical asset identifier.
    /// @param oldAggregator Previous aggregator address.
    /// @param newAggregator New aggregator address.
    event AssetUpdated(bytes32 indexed assetId, address indexed oldAggregator, address indexed newAggregator);

    /// @notice Register or update the aggregator for `assetId`. Owner-only.
    /// @param assetId    Canonical asset identifier.
    /// @param aggregator Aggregator address (must be non-zero).
    function registerAsset(bytes32 assetId, address aggregator) external;

    /// @notice Look up the aggregator for `assetId`.
    /// @param assetId Canonical asset identifier.
    /// @return Aggregator address, or `address(0)` if unregistered.
    function getAggregator(bytes32 assetId) external view returns (address);

    /// @notice List every registered asset.
    /// @return Array of `assetId` values in registration order.
    function listAssets() external view returns (bytes32[] memory);
}

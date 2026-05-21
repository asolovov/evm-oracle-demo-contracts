// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  IReporterSet
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice M-of-N reporter registry. Holds the authorized signer set and the verification
///         threshold used by `PriceAggregator` when validating `fulfillPrice` submissions.
interface IReporterSet {
    /// @notice Emitted when a reporter is added to the authorized set.
    /// @param reporter The address granted reporter rights.
    event ReporterAdded(address indexed reporter);

    /// @notice Emitted when a reporter is removed from the authorized set.
    /// @param reporter The address whose reporter rights were revoked.
    event ReporterRemoved(address indexed reporter);

    /// @notice Emitted when the verification threshold changes.
    /// @param oldThreshold Previous threshold value.
    /// @param newThreshold New threshold value (must satisfy `0 < t <= reporters.length`).
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    /// @notice Authorize `reporter` to co-sign price fulfillments. Owner-only.
    /// @param reporter Address to add.
    function addReporter(address reporter) external;

    /// @notice Revoke `reporter`'s authorization. Owner-only.
    /// @param reporter Address to remove.
    function removeReporter(address reporter) external;

    /// @notice Set the M-of-N verification threshold. Owner-only.
    /// @param newThreshold Number of valid signatures required (`0 < t <= reporters.length`).
    function setThreshold(uint256 newThreshold) external;

    /// @notice The current authorized reporter set.
    /// @return Array of authorized reporter addresses.
    function getReporters() external view returns (address[] memory);

    /// @notice The current verification threshold.
    /// @return Number of distinct authorized signatures required to fulfill a price.
    function getThreshold() external view returns (uint256);

    /// @notice Whether `account` is an authorized reporter.
    /// @param account Address to check.
    /// @return `true` if authorized.
    function isReporter(address account) external view returns (bool);
}

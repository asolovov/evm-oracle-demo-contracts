// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IReporterSet} from "../interfaces/IReporterSet.sol";

/// @title  ReporterSet
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice M-of-N authorized reporter registry. Owner-managed via `Ownable2Step`.
/// @dev    State is intentionally small — the array is the canonical order in which
///         reporters were added; the mapping is the membership oracle and is what
///         every external check should consult.
contract ReporterSet is IReporterSet, Ownable2Step {
    /// @notice Reverts when an action would leave the set in a state where
    ///         `threshold > reporters.length`.
    error ThresholdExceedsReporterCount(uint256 threshold, uint256 reporterCount);

    /// @notice Reverts when `setThreshold` is called with `0`.
    error ZeroThreshold();

    /// @notice Reverts on attempts to add the zero address as a reporter.
    error ZeroReporter();

    /// @notice Reverts on attempts to add an already-authorized address.
    error ReporterAlreadyExists(address reporter);

    /// @notice Reverts on attempts to remove an address that is not in the set.
    error ReporterNotFound(address reporter);

    /// @dev Canonical insertion order. Membership is sourced from `_isReporter`.
    address[] private _reporters;

    /// @dev O(1) membership oracle.
    mapping(address => bool) private _isReporter;

    /// @dev Index of each reporter in `_reporters` (`index + 1`, so 0 means absent).
    mapping(address => uint256) private _indexOf;

    /// @dev Current verification threshold (M in M-of-N).
    uint256 private _threshold;

    /// @notice Bootstrap the reporter set.
    /// @dev    Pass `initialReporters.length == 0 && initialThreshold == 0` to deploy an
    ///         empty contract that the owner will populate via `addReporter` later.
    ///         Otherwise both arrays must satisfy `0 < threshold <= initialReporters.length`.
    /// @param  initialOwner       Owner that may add/remove reporters and change the threshold.
    /// @param  initialReporters   Reporter addresses to add at construction time.
    /// @param  initialThreshold   Initial verification threshold.
    constructor(
        address initialOwner,
        address[] memory initialReporters,
        uint256 initialThreshold
    ) Ownable(initialOwner) {
        for (uint256 i = 0; i < initialReporters.length; ++i) {
            _addReporter(initialReporters[i]);
        }

        if (initialThreshold == 0 && initialReporters.length == 0) {
            return;
        }

        if (initialThreshold == 0) revert ZeroThreshold();
        if (initialThreshold > initialReporters.length) {
            revert ThresholdExceedsReporterCount(initialThreshold, initialReporters.length);
        }

        _threshold = initialThreshold;
        emit ThresholdChanged(0, initialThreshold);
    }

    /// @inheritdoc IReporterSet
    function addReporter(address reporter) external onlyOwner {
        _addReporter(reporter);
    }

    /// @inheritdoc IReporterSet
    function removeReporter(address reporter) external onlyOwner {
        if (!_isReporter[reporter]) revert ReporterNotFound(reporter);

        uint256 indexPlusOne = _indexOf[reporter];
        uint256 lastIdx = _reporters.length - 1;
        uint256 removedIdx;
        unchecked {
            removedIdx = indexPlusOne - 1;
        }

        if (removedIdx != lastIdx) {
            address moved = _reporters[lastIdx];
            _reporters[removedIdx] = moved;
            _indexOf[moved] = removedIdx + 1;
        }
        _reporters.pop();

        delete _indexOf[reporter];
        delete _isReporter[reporter];

        if (_threshold > _reporters.length) {
            revert ThresholdExceedsReporterCount(_threshold, _reporters.length);
        }

        emit ReporterRemoved(reporter);
    }

    /// @inheritdoc IReporterSet
    function setThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0) revert ZeroThreshold();
        if (newThreshold > _reporters.length) {
            revert ThresholdExceedsReporterCount(newThreshold, _reporters.length);
        }
        uint256 old = _threshold;
        _threshold = newThreshold;
        emit ThresholdChanged(old, newThreshold);
    }

    /// @inheritdoc IReporterSet
    function getReporters() external view returns (address[] memory) {
        return _reporters;
    }

    /// @inheritdoc IReporterSet
    function getThreshold() external view returns (uint256) {
        return _threshold;
    }

    /// @inheritdoc IReporterSet
    function isReporter(address account) external view returns (bool) {
        return _isReporter[account];
    }

    /// @dev Append `reporter` to the set. Reverts on zero address or duplicate. Emits `ReporterAdded`.
    function _addReporter(address reporter) private {
        if (reporter == address(0)) revert ZeroReporter();
        if (_isReporter[reporter]) revert ReporterAlreadyExists(reporter);

        _reporters.push(reporter);
        _isReporter[reporter] = true;
        _indexOf[reporter] = _reporters.length;

        emit ReporterAdded(reporter);
    }
}

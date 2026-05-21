// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PriceLib} from "../libs/PriceLib.sol";

/// @title  PriceLibHarness
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Test-only contract exposing `PriceLib`'s internal helpers as `external`
///         entry points so the JS / TS test suite (especially `fast-check` property
///         runs) can drive them directly. Never deployed outside `test/`.
/// @dev    Excluded from Slither / Solhint scopes via `.solhintignore` and `slither.config.json`.
contract PriceLibHarness {
    /// @notice Compute the EIP-712 digest reporters sign for a price submission.
    /// @return digest 32-byte EIP-712 digest.
    function buildDigest(
        uint256 reqId,
        bytes32 assetId,
        int256 price,
        uint256 timestamp,
        uint256 chainId,
        address aggregator
    ) external pure returns (bytes32 digest) {
        return PriceLib.buildDigest(reqId, assetId, price, timestamp, chainId, aggregator);
    }

    /// @notice Verify that `signatures` meets the `threshold` against `authorizedReporters`.
    /// @return ok `true` iff the quorum is met.
    function verifySignatures(
        bytes32 digest,
        bytes[] calldata signatures,
        address[] memory authorizedReporters,
        uint256 threshold
    ) external pure returns (bool ok) {
        return PriceLib.verifySignatures(digest, signatures, authorizedReporters, threshold);
    }

    /// @notice Rescale `src` from `srcDecimals` to `dstDecimals`.
    function scaleTo(int256 src, uint8 srcDecimals, uint8 dstDecimals) external pure returns (int256 out) {
        return PriceLib.scaleTo(src, srcDecimals, dstDecimals);
    }
}

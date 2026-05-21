// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  PriceLib
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Stateless helpers for the Lighthouse oracle: signature verification, EIP-712
///         digest construction, and decimals scaling. Implementation lands in task 03.
/// @dev    Pure / view library. No storage. Callers wrap the EIP-712 digest in
///         `abi.encode` (not `encodePacked`) to keep dynamic types collision-free.
library PriceLib {
    /// @notice EIP-712 domain name used for reporter signatures.
    string internal constant DOMAIN_NAME = "LIGHTHOUSE_V1";

    /// @notice Verify that `signatures` contains at least `threshold` distinct authorized signers.
    /// @dev    Implementation in task 03. Recovers each signature against `digest`, dedupes the
    ///         recovered addresses, counts those present in `authorizedReporters`.
    /// @param digest               EIP-712 digest produced by `buildDigest`.
    /// @param signatures           Array of 65-byte ECDSA signatures.
    /// @param authorizedReporters  Snapshot of the authorized reporter set.
    /// @param threshold            Minimum number of distinct authorized signers required.
    /// @return ok                  `true` iff the quorum is met.
    function verifySignatures(
        bytes32 digest,
        bytes[] calldata signatures,
        address[] memory authorizedReporters,
        uint256 threshold
    ) internal pure returns (bool ok) {
        // task 03
        digest;
        signatures;
        authorizedReporters;
        threshold;
        return false;
    }

    /// @notice Build the EIP-712 digest reporters sign for a price submission.
    /// @dev    Implementation in task 03. Uses `abi.encode` (not `encodePacked`).
    /// @param reqId      Request id being fulfilled (0 for heartbeat).
    /// @param assetId    Canonical asset identifier.
    /// @param price      Aggregated price (scaled to aggregator decimals).
    /// @param timestamp  Reporter-attested observation time.
    /// @param chainId    Target chain id (replay protection across chains).
    /// @param aggregator Address of the aggregator contract that will receive the submission.
    /// @return digest    32-byte EIP-712 digest.
    function buildDigest(
        uint256 reqId,
        bytes32 assetId,
        int256 price,
        uint256 timestamp,
        uint256 chainId,
        address aggregator
    ) internal pure returns (bytes32 digest) {
        // task 03
        reqId;
        assetId;
        price;
        timestamp;
        chainId;
        aggregator;
        return bytes32(0);
    }

    /// @notice Rescale `src` from `srcDecimals` to `dstDecimals` without losing precision when possible.
    /// @dev    Implementation in task 03.
    /// @param src          Source value.
    /// @param srcDecimals  Decimals the source value is expressed in.
    /// @param dstDecimals  Decimals the result should be expressed in.
    /// @return out         Rescaled value.
    function scaleTo(int256 src, uint8 srcDecimals, uint8 dstDecimals) internal pure returns (int256 out) {
        // task 03
        src;
        srcDecimals;
        dstDecimals;
        return 0;
    }
}

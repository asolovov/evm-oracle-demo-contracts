// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title  PriceLib
/// @author Andrei Solovov <https://github.com/asolovov>
/// @notice Stateless helpers for the Lighthouse oracle: EIP-712 digest construction,
///         M-of-N signature verification, and integer decimals scaling.
/// @dev    Pure / view library. No storage. Struct + domain hashes use `abi.encode`
///         (never `encodePacked`) to keep dynamic-type collision-free.
library PriceLib {
    /// @notice EIP-712 domain name used for reporter signatures.
    string internal constant DOMAIN_NAME = "LIGHTHOUSE_V1";

    /// @notice EIP-712 domain version.
    string internal constant DOMAIN_VERSION = "1";

    /// @dev keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    /// @dev keccak256("Price(uint256 reqId,bytes32 assetId,int256 price,uint256 timestamp)")
    bytes32 internal constant PRICE_TYPEHASH = keccak256(
        "Price(uint256 reqId,bytes32 assetId,int256 price,uint256 timestamp)"
    );

    /// @notice Build the EIP-712 digest reporters sign for a price submission.
    /// @dev    Uses `abi.encode` for both the domain separator and the struct hash; the
    ///         final `\x19\x01`-prefixed concatenation only packs fixed-size 32-byte
    ///         values, so collisions are not a concern there.
    /// @param  reqId      Request id being fulfilled. `0` indicates a heartbeat update.
    /// @param  assetId    Canonical asset identifier (e.g. keccak256("WETH/USD")).
    /// @param  price      Aggregated price (scaled to the aggregator's decimals).
    /// @param  timestamp  Reporter-attested observation time.
    /// @param  chainId    Target chain id (replay protection across chains).
    /// @param  aggregator Address of the aggregator contract that will receive the submission.
    /// @return digest     32-byte EIP-712 digest.
    function buildDigest(
        uint256 reqId,
        bytes32 assetId,
        int256 price,
        uint256 timestamp,
        uint256 chainId,
        address aggregator
    ) internal pure returns (bytes32 digest) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                chainId,
                aggregator
            )
        );
        bytes32 structHash = keccak256(abi.encode(PRICE_TYPEHASH, reqId, assetId, price, timestamp));
        digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
    }

    /// @notice Verify that at least `threshold` distinct authorized reporters signed `digest`.
    /// @dev    For each signature: recover address, skip on recovery error, skip if not in
    ///         `authorizedReporters`, skip if already counted (dedupe). Short-circuits once
    ///         `validCount >= threshold`. Worst-case complexity O(sigs * (reporters + sigs)) —
    ///         intentional given typical reporter sets are < 10.
    /// @param  digest               EIP-712 digest produced by `buildDigest`.
    /// @param  signatures           Array of 65-byte ECDSA signatures. Order-independent.
    /// @param  authorizedReporters  Snapshot of the authorized reporter set.
    /// @param  threshold            Minimum number of distinct authorized signers required.
    /// @return ok                   `true` iff the quorum is met.
    function verifySignatures(
        bytes32 digest,
        bytes[] calldata signatures,
        address[] memory authorizedReporters,
        uint256 threshold
    ) internal pure returns (bool ok) {
        if (threshold == 0 || signatures.length < threshold) {
            return false;
        }

        address[] memory counted = new address[](signatures.length);
        uint256 countedLen = 0;
        uint256 validCount = 0;

        for (uint256 i = 0; i < signatures.length; ++i) {
            /// @dev `tryRecover` returns a third `bytes32` tuple member with the violating
            ///      signature data for `InvalidSignatureS` cases; not useful here.
            // slither-disable-next-line unused-return
            (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signatures[i]);
            if (err != ECDSA.RecoverError.NoError || signer == address(0)) {
                continue;
            }

            if (!_contains(authorizedReporters, signer)) {
                continue;
            }

            if (_contains(counted, countedLen, signer)) {
                continue;
            }

            counted[countedLen] = signer;
            unchecked {
                ++countedLen;
                ++validCount;
            }
            if (validCount >= threshold) {
                return true;
            }
        }

        return false;
    }

    /// @notice Rescale `src` from `srcDecimals` to `dstDecimals`.
    /// @dev    Scaling up multiplies by `10 ** (dst - src)`; scaling down divides. The
    ///         `10 ** diff` magnitude is converted via `SafeCast.toInt256`, which reverts
    ///         when the value exceeds `int256.max` — closes the silent sign-flip at
    ///         `diff == 77` flagged in audit/findings.md#M-02. The multiplication still
    ///         reverts on the standard 0.8 overflow path; division truncates toward zero
    ///         (Solidity's native int division).
    /// @param  src          Source value.
    /// @param  srcDecimals  Decimals the source value is expressed in.
    /// @param  dstDecimals  Decimals the result should be expressed in.
    /// @return out          Rescaled value.
    function scaleTo(int256 src, uint8 srcDecimals, uint8 dstDecimals) internal pure returns (int256 out) {
        if (srcDecimals == dstDecimals) {
            return src;
        }
        if (srcDecimals < dstDecimals) {
            uint256 diff;
            unchecked {
                diff = uint256(dstDecimals - srcDecimals);
            }
            int256 factor = SafeCast.toInt256(10 ** diff);
            return src * factor;
        }
        uint256 diffDown;
        unchecked {
            diffDown = uint256(srcDecimals - dstDecimals);
        }
        int256 divisor = SafeCast.toInt256(10 ** diffDown);
        return src / divisor;
    }

    /// @dev Linear search over the full `arr`.
    function _contains(address[] memory arr, address target) private pure returns (bool) {
        for (uint256 i = 0; i < arr.length; ++i) {
            if (arr[i] == target) return true;
        }
        return false;
    }

    /// @dev Linear search over the first `len` entries of `arr`.
    function _contains(address[] memory arr, uint256 len, address target) private pure returns (bool) {
        for (uint256 i = 0; i < len; ++i) {
            if (arr[i] == target) return true;
        }
        return false;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IVincentAnchorRegistry} from "./IVincentAnchorRegistry.sol";

/// @title VincentAnchorRegistry
/// @author Kargain
/// @notice Immutable, ownerless, permissionless, append-only per-publisher epoch notary.
/// @dev This contract records off-chain content hashes (merkleRoot, jsonlSha256, manifestHash)
///      and timestamps them on-chain. It does NOT and CANNOT verify Arweave content, leaf
///      inclusion, or manifest signatures — clients verify all off-chain artifacts against the
///      anchored hashes. Each publisher maintains an independent epoch chain linked by parentRoot.
///      Genesis epochs require parentRoot == 0; subsequent epochs must reference the prior
///      epoch's merkleRoot. There is no owner, admin, upgrade path, or payable entry point.
contract VincentAnchorRegistry is IVincentAnchorRegistry {
    mapping(address => Epoch[]) private _epochs;

    /// @inheritdoc IVincentAnchorRegistry
    function publishEpoch(
        bytes32 merkleRoot,
        bytes32 jsonlSha256,
        bytes32 manifestHash,
        bytes32 parentRoot,
        string calldata manifestUri
    ) external override {
        uint256 n = _epochs[msg.sender].length;

        if (n == 0) {
            require(parentRoot == bytes32(0), "genesis parentRoot must be zero");
        } else {
            require(parentRoot == _epochs[msg.sender][n - 1].merkleRoot, "parentRoot mismatch");
        }

        require(merkleRoot != bytes32(0), "merkleRoot must be non-zero");
        require(jsonlSha256 != bytes32(0), "jsonlSha256 must be non-zero");
        require(manifestHash != bytes32(0), "manifestHash must be non-zero");

        uint256 uriLen = bytes(manifestUri).length;
        require(uriLen > 0 && uriLen <= 256, "invalid manifestUri length");

        _epochs[msg.sender].push(
            Epoch({
                merkleRoot: merkleRoot,
                jsonlSha256: jsonlSha256,
                manifestHash: manifestHash,
                parentRoot: parentRoot,
                timestamp: uint64(block.timestamp),
                manifestUri: manifestUri
            })
        );

        emit EpochPublished(
            msg.sender,
            n,
            merkleRoot,
            jsonlSha256,
            manifestHash,
            parentRoot,
            manifestUri
        );
    }

    /// @inheritdoc IVincentAnchorRegistry
    function epochCount(address publisher) external view override returns (uint256 count) {
        return _epochs[publisher].length;
    }

    /// @inheritdoc IVincentAnchorRegistry
    function getEpoch(address publisher, uint256 index) external view override returns (Epoch memory epoch) {
        require(index < _epochs[publisher].length, "no such epoch");
        return _epochs[publisher][index];
    }

    /// @inheritdoc IVincentAnchorRegistry
    function latestEpoch(address publisher) external view override returns (Epoch memory epoch) {
        Epoch[] storage chain = _epochs[publisher];
        require(chain.length > 0, "no epochs");
        return chain[chain.length - 1];
    }
}

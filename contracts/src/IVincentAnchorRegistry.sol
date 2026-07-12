// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IVincentAnchorRegistry
/// @notice Interface for the Vincent on-chain epoch anchor registry.
/// @dev Integrators may depend on this interface without importing the full implementation.
interface IVincentAnchorRegistry {
    /// @notice A single published epoch for a publisher.
    /// @param merkleRoot Merkle root of the epoch dataset leaves (32 bytes).
    /// @param jsonlSha256 SHA-256 digest of the canonical JSONL dataset.
    /// @param manifestHash SHA-256 digest of the signed manifest document.
    /// @param parentRoot Merkle root of the prior epoch (zero for genesis).
    /// @param timestamp Block timestamp when the epoch was published.
    /// @param manifestUri Off-chain URI pointing to the manifest (e.g. ar://…).
    struct Epoch {
        bytes32 merkleRoot;
        bytes32 jsonlSha256;
        bytes32 manifestHash;
        bytes32 parentRoot;
        uint64 timestamp;
        string manifestUri;
    }

    /// @notice Emitted when a publisher appends a new epoch.
    /// @param publisher The address that called publishEpoch.
    /// @param epoch Zero-based index of the new epoch for this publisher.
    /// @param merkleRoot Merkle root bound by this epoch.
    /// @param jsonlSha256 SHA-256 of the canonical JSONL dataset.
    /// @param manifestHash SHA-256 of the signed manifest.
    /// @param parentRoot Prior epoch merkle root (zero for genesis).
    /// @param manifestUri Off-chain URI for the manifest.
    event EpochPublished(
        address indexed publisher,
        uint256 indexed epoch,
        bytes32 merkleRoot,
        bytes32 jsonlSha256,
        bytes32 manifestHash,
        bytes32 parentRoot,
        string manifestUri
    );

    /// @notice Append a new epoch to the caller's chain.
    /// @param merkleRoot Merkle root of the epoch dataset (must be non-zero).
    /// @param jsonlSha256 SHA-256 of the canonical JSONL (must be non-zero).
    /// @param manifestHash SHA-256 of the signed manifest (must be non-zero).
    /// @param parentRoot Merkle root of the prior epoch (zero for genesis).
    /// @param manifestUri Off-chain manifest URI (1–256 characters).
    function publishEpoch(
        bytes32 merkleRoot,
        bytes32 jsonlSha256,
        bytes32 manifestHash,
        bytes32 parentRoot,
        string calldata manifestUri
    ) external;

    /// @notice Number of epochs published by an address.
    /// @param publisher The publisher address.
    /// @return count Epoch count.
    function epochCount(address publisher) external view returns (uint256 count);

    /// @notice Return a specific epoch by index.
    /// @param publisher The publisher address.
    /// @param index Zero-based epoch index.
    /// @return epoch The stored epoch.
    function getEpoch(address publisher, uint256 index) external view returns (Epoch memory epoch);

    /// @notice Return the most recent epoch for a publisher.
    /// @param publisher The publisher address.
    /// @return epoch The latest epoch.
    function latestEpoch(address publisher) external view returns (Epoch memory epoch);
}

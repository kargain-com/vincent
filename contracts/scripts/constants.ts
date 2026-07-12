import { keccak256, toBytes } from "viem";

/** Nick/Arachnid deterministic deployment proxy (same address on every EVM chain). */
export const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;

/** Fixed salt for VincentAnchorRegistry — immutable once deployed. */
export const DEPLOY_SALT = keccak256(toBytes("kargain.vincent.VincentAnchorRegistry/v1"));

export const CONTRACT_NAME = "VincentAnchorRegistry" as const;

export const EXPLORER_BASE_SEPOLIA = "https://sepolia.basescan.org" as const;

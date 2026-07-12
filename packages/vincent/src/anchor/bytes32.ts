/** Zero bytes32 for genesis parentRoot on-chain. */
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as const;

/** Convert on-chain bytes32 to protocol sha256 content id. */
export function bytes32ToContentId(value: `0x${string}`): string {
  return `sha256:${value.slice(2).toLowerCase()}`;
}

/** Map on-chain parentRoot; zero bytes32 becomes null (genesis). */
export function bytes32ParentRoot(value: `0x${string}`): string | null {
  return value === ZERO_BYTES32 ? null : bytes32ToContentId(value);
}

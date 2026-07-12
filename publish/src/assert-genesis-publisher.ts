export interface EpochCountReader {
  readEpochCount(publisher: `0x${string}`): Promise<bigint>;
}

/** Fail fast before uploads when this wallet already anchored a genesis epoch on-chain. */
export async function assertGenesisPublisherAvailable(
  reader: EpochCountReader,
  publisher: string,
): Promise<void> {
  const count = await reader.readEpochCount(publisher as `0x${string}`);
  if (count > 0n) {
    throw new Error(
      `Publisher ${publisher} already has ${count.toString()} on-chain epoch(s). ` +
        'Genesis publish supports one epoch per wallet. Use a fresh wallet or implement epoch N+1 publish.',
    );
  }
}

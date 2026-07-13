import type { WaitForLatestEpochOptions } from '../src/adapters/base-sepolia-publisher.js';
import { ZERO_BYTES32 } from '../src/adapters/sha256-bytes32.js';
import { TEST_PUBLISHER } from '../src/constants.js';
import type { PublishEpochArgs } from '../src/adapters/types.js';
import type { EpochCountReader } from '../src/assert-genesis-publisher.js';

interface StoredEpoch {
  merkleRoot: `0x${string}`;
  jsonlSha256: `0x${string}`;
  manifestHash: `0x${string}`;
  parentRoot: `0x${string}`;
  manifestUri: string;
}

export interface MockOnChainEpoch extends StoredEpoch {
  timestamp: bigint;
}

export interface MockChainPublisher extends EpochCountReader {
  readonly calls: PublishEpochArgs[];
  readonly publisher: `0x${string}`;
  publishEpoch(args: PublishEpochArgs): Promise<`0x${string}`>;
  readLatestEpoch(publisher?: `0x${string}`): MockOnChainEpoch;
  waitForLatestEpoch(
    publisher: `0x${string}`,
    options?: WaitForLatestEpochOptions,
  ): Promise<MockOnChainEpoch>;
}

function assertNonZeroBytes32(value: `0x${string}`, label: string): void {
  if (value === ZERO_BYTES32) {
    throw new Error(`${label} must be non-zero`);
  }
}

function assertManifestUri(manifestUri: string): void {
  if (manifestUri.length === 0 || manifestUri.length > 256) {
    throw new Error('invalid manifestUri length');
  }
}

/** In-memory VincentAnchorRegistry rules for offline tests. */
export function createMockChainPublisher(options?: {
  publisher?: `0x${string}`;
}): MockChainPublisher {
  const publisher = options?.publisher ?? (TEST_PUBLISHER);
  const calls: PublishEpochArgs[] = [];
  const epochs: StoredEpoch[] = [];
  let counter = 0;

  return {
    calls,
    publisher,

    async readEpochCount(address: `0x${string}`): Promise<bigint> {
      if (address.toLowerCase() !== publisher.toLowerCase()) {
        return 0n;
      }
      return BigInt(epochs.length);
    },

    readLatestEpoch(address?: `0x${string}`): MockOnChainEpoch {
      if (
        address !== undefined &&
        address.toLowerCase() !== publisher.toLowerCase()
      ) {
        throw new Error('no epochs');
      }
      if (epochs.length === 0) {
        throw new Error('no epochs');
      }
      return { ...epochs[epochs.length - 1], timestamp: 1n };
    },

    async waitForLatestEpoch(
      address: `0x${string}`,
      options?: WaitForLatestEpochOptions,
    ): Promise<MockOnChainEpoch> {
      if (address.toLowerCase() !== publisher.toLowerCase() || epochs.length === 0) {
        throw new Error('no epochs');
      }
      const minEpochCount = options?.minEpochCount ?? 1n;
      if (BigInt(epochs.length) < minEpochCount) {
        throw new Error(`epoch count ${String(epochs.length)} < ${String(minEpochCount)}`);
      }
      const latest = this.readLatestEpoch(address);
      if (
        options?.expectedManifestUri !== undefined &&
        latest.manifestUri !== options.expectedManifestUri
      ) {
        throw new Error(
          `latest manifestUri ${latest.manifestUri} !== ${options.expectedManifestUri}`,
        );
      }
      return latest;
    },

    async publishEpoch(args: PublishEpochArgs): Promise<`0x${string}`> {
      const n = epochs.length;

      if (n === 0) {
        if (args.parentRoot !== ZERO_BYTES32) {
          throw new Error('genesis parentRoot must be zero');
        }
      } else if (args.parentRoot !== epochs[n - 1].merkleRoot) {
        throw new Error('parentRoot mismatch');
      }

      assertNonZeroBytes32(args.merkleRoot, 'merkleRoot');
      assertNonZeroBytes32(args.jsonlSha256, 'jsonlSha256');
      assertNonZeroBytes32(args.manifestHash, 'manifestHash');
      assertManifestUri(args.manifestUri);

      calls.push({ ...args });
      epochs.push({
        merkleRoot: args.merkleRoot,
        jsonlSha256: args.jsonlSha256,
        manifestHash: args.manifestHash,
        parentRoot: args.parentRoot,
        manifestUri: args.manifestUri,
      });
      counter += 1;
      return `0x${String(counter).padStart(64, '0')}`;
    },
  };
}

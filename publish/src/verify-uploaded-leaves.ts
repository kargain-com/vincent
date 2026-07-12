import type { EpochBuild } from '@kargain/vincent-compiler';
import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { verifyLeaf } from '@kargain/vincent/decoder';

export interface VerifyUploadedLeavesOptions {
  epoch: EpochBuild;
  publisher: string;
  epochNumber: number;
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl?: typeof fetch;
  /** Per-leaf time to wait for GraphQL indexing before aborting anchor. */
  timeoutMs?: number;
  /** Delay between leaf discovery attempts. */
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onLeafVerified?: (completed: number, total: number) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForLeaf(
  getLeaf: ReturnType<typeof createArweaveGetLeaf>,
  leafKey: string,
  merkleRoot: string,
  deadline: number,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  while (Date.now() < deadline) {
    try {
      const fetched = await getLeaf(leafKey);
      const verified = verifyLeaf(fetched.leaf, fetched.proof, merkleRoot);
      if (verified.ok) {
        return;
      }
      throw new Error(`Merkle proof invalid for LeafKey ${leafKey}: ${verified.reason}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('missing leaf for LeafKey')) {
        throw error instanceof Error ? error : new Error(message);
      }
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `LeafKey ${leafKey} not indexed via GraphQL before anchor deadline; ` +
      'check IRYS_GRAPHQL_URL (expected https://uploader.irys.xyz/graphql)',
  );
}

/**
 * Poll GraphQL until every uploaded leaf is discoverable and Merkle-valid,
 * aborting the publish before on-chain anchor when indexing fails.
 */
export async function verifyUploadedLeaves(
  options: VerifyUploadedLeavesOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const getLeaf = createArweaveGetLeaf({
    gatewayUrl: options.gatewayUrl,
    graphqlUrl: options.graphqlUrl,
    publisher: options.publisher.toLowerCase(),
    epoch: options.epochNumber,
    fetchImpl: options.fetchImpl,
  });

  const leafKeys = [...options.epoch.leaves.keys()].sort((a, b) => a.localeCompare(b));

  for (let index = 0; index < leafKeys.length; index++) {
    const leafKey = leafKeys[index]!;
    const deadline = Date.now() + timeoutMs;
    await waitForLeaf(
      getLeaf,
      leafKey,
      options.epoch.merkleRoot,
      deadline,
      pollIntervalMs,
      sleep,
    );
    options.onLeafVerified?.(index + 1, leafKeys.length);
  }
}

import type { MockGatewayItem } from './mock-gateway.js';
import { createMockGateway } from './mock-gateway.js';
import type { MockUploaderRecord } from './mock-uploader.js';
import { uploaderStoreToGatewayItems } from './mock-uploader.js';

export const MOCK_IRYS_GATEWAY_URL = 'https://mock.gateway.irys.test';
export const MOCK_IRYS_GRAPHQL_URL = 'https://mock.arweave.devnet.irys.test/graphql';

/** Bridge mock uploader records into a split gateway + GraphQL Irys environment. */
export function createMockIrysGateway(
  records: readonly MockUploaderRecord[],
  publisher: string,
  epoch: number,
): {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl: typeof fetch;
} {
  const leafItems = uploaderStoreToGatewayItems(records, publisher, epoch);
  const staticBodies: Record<string, string> = {};
  const staticBinaryBodies: Record<string, Uint8Array> = {};
  const artifactItems = [];
  for (const record of records) {
    const typeTag = record.tags.find((tag) => tag.name === 'Type');
    if (typeTag?.value === 'jsonl') {
      staticBinaryBodies[record.id] = record.data;
    } else {
      staticBodies[record.id] = new TextDecoder().decode(record.data);
    }
    if (typeTag !== undefined) {
      artifactItems.push({
        owner: publisher,
        epoch,
        artifactType: typeTag.value,
        txId: record.id,
        height: record.height,
      });
    }
  }

  return createMockGateway(leafItems, {
    gatewayUrl: MOCK_IRYS_GATEWAY_URL,
    graphqlUrl: MOCK_IRYS_GRAPHQL_URL,
    staticBodies,
    staticBinaryBodies,
    artifactItems,
  });
}

export type { MockGatewayItem };

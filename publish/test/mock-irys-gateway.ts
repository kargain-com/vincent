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
  for (const record of records) {
    staticBodies[record.id] = new TextDecoder().decode(record.data);
  }

  return createMockGateway(leafItems, {
    gatewayUrl: MOCK_IRYS_GATEWAY_URL,
    graphqlUrl: MOCK_IRYS_GRAPHQL_URL,
    staticBodies,
  });
}

export type { MockGatewayItem };

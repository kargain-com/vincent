import type { MockUploader } from './mock-uploader.js';
import {
  createMockIrysGateway,
  MOCK_IRYS_GATEWAY_URL,
  MOCK_IRYS_GRAPHQL_URL,
} from './mock-irys-gateway.js';

/** fetchImpl that reads the latest mock uploader records on each GraphQL request. */
export function createLiveMockIrysFetchImpl(
  uploader: MockUploader,
  publisher: string,
  epoch: number,
): {
  gatewayUrl: string;
  graphqlUrl: string;
  fetchImpl: typeof fetch;
} {
  const fetchImpl: typeof fetch = (input, init) => {
    const live = createMockIrysGateway(uploader.records, publisher, epoch);
    return live.fetchImpl(input, init);
  };

  return {
    gatewayUrl: MOCK_IRYS_GATEWAY_URL,
    graphqlUrl: MOCK_IRYS_GRAPHQL_URL,
    fetchImpl,
  };
}

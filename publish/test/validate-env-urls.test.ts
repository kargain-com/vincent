import { describe, expect, it } from 'vitest';

import { assertBaseSepoliaRpcUrl, assertIrysGraphqlUrl } from '../src/validate-env-urls.js';

describe('validate env urls', () => {
  it('accepts Base Sepolia JSON-RPC endpoints', () => {
    expect(() =>
      assertBaseSepoliaRpcUrl('https://sepolia.base.org', 'BASE_SEPOLIA_RPC_URL'),
    ).not.toThrow();
  });

  it('rejects Irys gateway URLs where JSON-RPC is required', () => {
    expect(() =>
      assertBaseSepoliaRpcUrl('https://testnet-gateway.irys.xyz/', 'BASE_SEPOLIA_RPC_URL'),
    ).toThrow(/must be a JSON-RPC endpoint/);

    expect(() =>
      assertBaseSepoliaRpcUrl('https://gateway.irys.xyz', 'BASE_SEPOLIA_RPC_URL'),
    ).toThrow(/must be a JSON-RPC endpoint/);
  });

  it('rejects deprecated Irys GraphQL hosts', () => {
    expect(() =>
      assertIrysGraphqlUrl(
        'https://arweave.devnet.irys.xyz/graphql',
        'IRYS_GRAPHQL_URL',
      ),
    ).toThrow(/does not index Irys devnet uploads/);

    expect(() =>
      assertIrysGraphqlUrl('https://uploader.irys.xyz/graphql', 'IRYS_GRAPHQL_URL'),
    ).not.toThrow();
  });
});

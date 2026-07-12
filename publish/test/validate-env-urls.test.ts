import { describe, expect, it } from 'vitest';

import {
  assertBaseSepoliaRpcUrl,
  assertEthereumSepoliaRpcUrl,
  assertIrysGraphqlUrl,
} from '../src/validate-env-urls.js';

describe('validate env URLs', () => {
  it('accepts JSON-RPC endpoints', () => {
    expect(() =>
      assertEthereumSepoliaRpcUrl(
        'https://ethereum-sepolia-rpc.publicnode.com',
        'IRYS_SEPOLIA_RPC_URL',
      ),
    ).not.toThrow();
    expect(() =>
      assertBaseSepoliaRpcUrl('https://sepolia.base.org', 'BASE_SEPOLIA_RPC_URL'),
    ).not.toThrow();
  });

  it('rejects Irys gateway URLs used as RPC', () => {
    expect(() =>
      assertEthereumSepoliaRpcUrl('https://testnet-gateway.irys.xyz/', 'IRYS_SEPOLIA_RPC_URL'),
    ).toThrow(/must be a JSON-RPC endpoint, not an Irys gateway URL/);

    expect(() =>
      assertEthereumSepoliaRpcUrl('https://gateway.irys.xyz', 'IRYS_SEPOLIA_RPC_URL'),
    ).toThrow(/IRYS_GATEWAY_URL and IRYS_GRAPHQL_URL/);
  });

  it('rejects deprecated rpc.sepolia.org endpoints', () => {
    expect(() =>
      assertEthereumSepoliaRpcUrl('https://rpc.sepolia.org', 'IRYS_SEPOLIA_RPC_URL'),
    ).toThrow(/no longer serves JSON-RPC/);
  });

  it('rejects arweave devnet GraphQL URLs for Irys uploads', () => {
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

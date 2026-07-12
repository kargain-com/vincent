import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createArweaveGetLeaf } from '@kargain/vincent/arweave';

import { assertIrysGraphqlUrl } from '../src/validate-env-urls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/irys-graphql/responses.json'), 'utf8'),
) as {
  sortHeightDesc400: unknown;
  leaf1faHit: unknown;
};

const PUBLISHER = '0xcf1eb0e7ed453ed266bf90e7c09e0e4769580b77';
const LEAF_TX = '7gFD4x9JLS7ZU2LKvPSXTdCpAKrSy2n3Eu2SYhCmLJW2';

describe('Irys GraphQL contract fixtures', () => {
  it('rejects arweave devnet GraphQL URLs', () => {
    expect(() =>
      assertIrysGraphqlUrl('https://arweave.devnet.irys.xyz/graphql', 'IRYS_GRAPHQL_URL'),
    ).toThrow(/does not index Irys devnet uploads/);
  });

  it('resolves leaf 1FA using order: DESC against recorded uploader.irys response', async () => {
    const gatewayUrl = 'https://gateway.irys.test';
    const graphqlUrl = 'https://uploader.irys.test/graphql';
    const queries: string[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === graphqlUrl && init?.method === 'POST') {
        const body = typeof init.body === 'string' ? init.body : '';
        const query = (JSON.parse(body) as { query: string }).query;
        queries.push(query);
        if (query.includes('sort: HEIGHT_DESC')) {
          return Promise.resolve(
            new Response(JSON.stringify(FIXTURES.sortHeightDesc400), { status: 400 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(FIXTURES.leaf1faHit), { status: 200 }),
        );
      }
      if (url === `${gatewayUrl}/${LEAF_TX}`) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              leaf: '{"wmi":"1FA","bindings":[],"schemas":{}}',
              proof: [{ hash: 'sha256:abc', side: 'right' }],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    };

    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      graphqlUrl,
      publisher: PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    await expect(getLeaf('1FA')).resolves.toMatchObject({
      leaf: '{"wmi":"1FA","bindings":[],"schemas":{}}',
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('order: DESC');
  });
});

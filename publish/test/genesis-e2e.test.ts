import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import { compile, verifyEpoch } from '@kargain/vincent-compiler';
import { describe, expect, it } from 'vitest';

import { buildManifest, signManifest, TEST_PRIVATE_KEY, TEST_PUBLISHER } from '../src/index.js';
import {
  loadGenesisMiniClaims,
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
} from './helpers.js';
import { createMockGateway } from './mock-gateway.js';

describe('genesis offline end-to-end', () => {
  it('verifyEpoch passes and decoder decodes via mock tag getLeaf', async () => {
    const claims = loadGenesisMiniClaims();
    const built = compile(claims, {});
    if (!built.ok) {
      throw new Error(built.error.message);
    }

    const manifest = signManifest(
      buildManifest({
        epoch: 1,
        parentRoot: null,
        merkleRoot: built.value.merkleRoot,
        jsonlSha256: built.value.jsonlSha256,
        uris: ['ar://genesis-mini'],
        compiler: { name: 'vincent-compiler', version: '1.0.0' },
        reviewPolicy: {
          minAccepts: 1,
          reviewers: [TEST_PUBLISHER],
        },
      }),
      TEST_PRIVATE_KEY,
    );

    expect(verifyEpoch(manifest, claims)).toEqual({ ok: true });

    const gatewayItems = [...built.value.leaves.entries()].map(([leafKey, entry], index) => ({
      owner: TEST_PUBLISHER,
      epoch: 1,
      leafKey,
      txId: `tx-${leafKey}`,
      height: index + 1,
      data: { leaf: entry.leaf, proof: entry.proof },
    }));

    const { gatewayUrl, fetchImpl } = createMockGateway(gatewayItems);
    const getLeaf = createArweaveGetLeaf({
      gatewayUrl,
      publisher: TEST_PUBLISHER,
      epoch: 1,
      fetchImpl,
    });

    const decoder = createDecoder({
      merkleRoot: manifest.dataset.merkleRoot,
      getLeaf,
    });

    const result2011 = await decoder.decode(VIN_2011);
    const result2014 = await decoder.decode(VIN_2014);

    expect(result2011.year.value).toBe(2011);
    expect(result2014.year.value).toBe(2014);
    expect(result2011.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
    expect(result2014.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');

    const body = await decoder.decode(VIN_BODY);
    expect(body.attributes.find((attr) => attr.attribute === 'bodyType')).toEqual(
      expect.objectContaining({ attribute: 'bodyType', value: 'Sedan', ambiguous: false }),
    );

    const fuel = await decoder.decode(VIN_FUEL);
    expect(fuel.attributes.find((attr) => attr.attribute === 'fuelType')).toEqual(
      expect.objectContaining({ attribute: 'fuelType', value: 'Gasoline', ambiguous: false }),
    );

    const plant = await decoder.decode(VIN_PLANT);
    expect(plant.attributes.find((attr) => attr.attribute === 'plant')).toEqual(
      expect.objectContaining({ attribute: 'plant', value: 'Chicago', ambiguous: false }),
    );

    expect(JSON.stringify(result2011.attributes)).not.toContain('Fusion-OLD');
  });
});

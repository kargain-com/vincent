import { claimHash, signManifest } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';
import { verifyEpoch } from '../src/verify-epoch.js';
import { loadGenesisMiniClaims, TEST_PRIVATE_KEY } from './helpers.js';

async function buildSignedManifest() {
  const claims = loadGenesisMiniClaims();
  const built = await compile(claims, {});
  if (!built.ok) {
    throw new Error(built.error.message);
  }

  const claimHashes = claims.map((c) => claimHash(c)).sort();
  const manifest = signManifest(
    {
      schemaVersion: '1.0',
      epoch: 1,
      reviewPolicy: {
        minAccepts: 1,
        reviewers: ['0xa0e58EC0f3dF4f127e9203A7fd6a494c483719B3'],
      },
      claims: claimHashes,
      compiler: { name: 'vincent-compiler', version: '1.0.0' },
      dataset: {
        jsonlSha256: built.value.jsonlSha256,
        sqliteSha256: built.value.sqliteSha256,
        uris: ['ar://genesis-mini'],
      },
    },
    TEST_PRIVATE_KEY,
  );

  return { manifest, claims, built };
}

describe('verifyEpoch', () => {
  it('passes when manifest signature and jsonlSha256 match a rebuild', async () => {
    const { manifest, claims } = await buildSignedManifest();
    const result = await verifyEpoch(manifest, claims);
    expect(result).toEqual({ ok: true });
  });

  it('fails when jsonlSha256 does not match a valid rebuild', async () => {
    const { manifest, claims } = await buildSignedManifest();
    const tampered = signManifest(
      {
        schemaVersion: '1.0',
        epoch: manifest.epoch,
        reviewPolicy: manifest.reviewPolicy,
        claims: manifest.claims,
        compiler: manifest.compiler,
        dataset: {
          ...manifest.dataset,
          jsonlSha256:
            'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        },
      },
      TEST_PRIVATE_KEY,
    );

    const result = await verifyEpoch(tampered, claims);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('jsonlSha256 mismatch');
  });

  it('fails when a claim body is tampered', async () => {
    const { manifest, claims } = await buildSignedManifest();
    const tamperedClaims = structuredClone(claims);
    tamperedClaims[0] = {
      ...tamperedClaims[0],
      value: { ...tamperedClaims[0].value, region: 'XX' },
    };

    const result = await verifyEpoch(manifest, tamperedClaims);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('missing claim for manifest hash');
  });

  it('fails when manifest signature is invalid', async () => {
    const { manifest, claims } = await buildSignedManifest();
    const tampered = {
      ...manifest,
      publisher: '0xAb00000000000000000000000000000000000001',
    };

    const result = await verifyEpoch(tampered, claims);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toBe('invalid-checksum');
  });

  it('fails when a manifest-listed claim is missing from input', async () => {
    const { manifest, claims } = await buildSignedManifest();
    const result = await verifyEpoch(manifest, claims.slice(1));

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.reason).toContain('missing claim for manifest hash');
  });
});

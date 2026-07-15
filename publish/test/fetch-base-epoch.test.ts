import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildManifest } from '../src/build-manifest.js';
import { fetchBaseEpoch, parseBaseClaims } from '../src/fetch-base-epoch.js';
import { manifestHash, signManifest } from '../src/sign-manifest.js';
import {
  BASE_PUBLISHER,
  BASE_PUBLISHER_KEY,
  buildBaseEpochFixture,
  COMMUNITY_PUBLISHER,
  MOCK_GATEWAY_URL,
  utf8,
} from './community-fixtures.js';

describe('fetchBaseEpoch', () => {
  it('fetches and verifies an anchored base epoch (gzipped dataset)', async () => {
    const fixture = buildBaseEpochFixture();

    const base = await fetchBaseEpoch({
      reader: fixture.reader,
      gatewayUrl: MOCK_GATEWAY_URL,
      publisher: BASE_PUBLISHER,
      index: 0,
      fetchImpl: fixture.fetchImpl,
    });

    expect(base.manifest.epoch).toBe(1);
    expect(base.manifest.parent).toBeNull();
    // The emitted snapshot resolves supersessions, so compare against JSONL lines.
    expect(base.claims).toHaveLength(fixture.jsonl.trimEnd().split('\n').length);
    expect(base.jsonl).toBe(fixture.jsonl);
  });

  it('accepts a plain (non-gzipped) dataset artifact', async () => {
    const fixture = buildBaseEpochFixture({ gzipJsonl: false });

    const base = await fetchBaseEpoch({
      reader: fixture.reader,
      gatewayUrl: MOCK_GATEWAY_URL,
      publisher: BASE_PUBLISHER,
      index: 0,
      fetchImpl: fixture.fetchImpl,
    });

    expect(base.jsonl).toBe(fixture.jsonl);
  });

  it('fails closed when the fetched dataset does not match jsonlSha256', async () => {
    const fixture = buildBaseEpochFixture();
    fixture.files.set('base-jsonl', utf8('{"tampered":true}\n'));

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/dataset jsonlSha256 mismatch/);
  });

  it('fails closed when the manifest hash does not match on-chain manifestHash', async () => {
    const fixture = buildBaseEpochFixture();
    fixture.anchor.manifestHash = `sha256:${'0'.repeat(63)}1`;

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/manifest hash mismatch/);
  });

  it('fails closed on a tampered manifest signature', async () => {
    const fixture = buildBaseEpochFixture();
    const manifest = JSON.parse(
      new TextDecoder().decode(fixture.files.get('base-manifest')),
    ) as Record<string, unknown> & { signature: string };
    const flipped = manifest.signature.endsWith('1') ? '2' : '1';
    manifest.signature = manifest.signature.slice(0, -1) + flipped;
    fixture.files.set('base-manifest', utf8(JSON.stringify(manifest)));
    // Keep the hash gate satisfied so the signature check is what fails.
    fixture.anchor.manifestHash = manifestHash(
      manifest as unknown as Parameters<typeof manifestHash>[0],
    );

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/manifest signature invalid/);
  });

  it('fails closed when the manifest publisher does not match the requested publisher', async () => {
    const fixture = buildBaseEpochFixture();

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: COMMUNITY_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/does not match requested publisher/);
  });

  it('fails closed when the manifest epoch does not match the on-chain index', async () => {
    const fixture = buildBaseEpochFixture();
    fixture.anchor.epoch = 1;

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 1,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/does not match on-chain index/);
  });

  it('fails closed when a dataset line is not a valid claim', async () => {
    const badJsonl = '{"schemaVersion":"1.0","type":"wmi","key":{"wmi":"1FA"}}\n';
    const signed = signManifest(
      buildManifest({
        epoch: 1,
        parentRoot: null,
        merkleRoot: `sha256:${'a'.repeat(64)}`,
        jsonlSha256: `sha256:${createHash('sha256').update(badJsonl).digest('hex')}`,
        uris: ['ar://base-jsonl'],
        compiler: { name: 'vincent-compiler', version: '0.0.1' },
      }),
      BASE_PUBLISHER_KEY,
    );
    const fixture = buildBaseEpochFixture();
    fixture.files.set('base-manifest', utf8(JSON.stringify(signed)));
    fixture.files.set('base-jsonl', utf8(badJsonl));
    fixture.anchor.manifestHash = manifestHash(signed);
    fixture.anchor.merkleRoot = signed.dataset.merkleRoot;
    fixture.anchor.jsonlSha256 = signed.dataset.jsonlSha256;

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/not a valid claim/);
  });

  it('fails closed when no dataset URI is reachable', async () => {
    const fixture = buildBaseEpochFixture();
    fixture.files.delete('base-jsonl');

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: 0,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/no dataset URI reachable/);
  });

  it('rejects a negative on-chain index', async () => {
    const fixture = buildBaseEpochFixture();

    await expect(
      fetchBaseEpoch({
        reader: fixture.reader,
        gatewayUrl: MOCK_GATEWAY_URL,
        publisher: BASE_PUBLISHER,
        index: -1,
        fetchImpl: fixture.fetchImpl,
      }),
    ).rejects.toThrow(/index must be a non-negative integer/);
  });
});

describe('parseBaseClaims', () => {
  it('rejects non-JSON lines with a line number', () => {
    expect(() => parseBaseClaims('not json\n')).toThrow(/line 1 is not valid JSON/);
  });

  it('parses an empty dataset to zero claims', () => {
    expect(parseBaseClaims('')).toEqual([]);
  });
});

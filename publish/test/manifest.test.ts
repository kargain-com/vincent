import { describe, expect, it } from 'vitest';

import { parseManifest, recoverPersonalSignAddress, signingPayload } from '@kargain/vincent/protocol';

import fixtureGolden from '../fixtures/golden.json';
import fixtureManifest from '../fixtures/manifest.json';
import {
  buildManifest,
  manifestHash,
  signManifest,
  TEST_PRIVATE_KEY,
  TEST_PUBLISHER,
  verifySignedManifest,
  ZERO_MERKLE_ROOT,
} from '../src/index.js';

const GENESIS_INPUT = {
  epoch: 1,
  parentRoot: null as string | null,
  merkleRoot: 'sha256:76f6692120d6f8316af6109aee98f8c4782ef6111f2d16959745459df0604f3c',
  jsonlSha256: 'sha256:a0f110eb9b4f2cbd318e5ab909ca1a692bf465c2d73ee516ee36d7bebc6a0eea',
  uris: ['ar://genesis-mini'],
  compiler: { name: 'vincent-compiler', version: '1.0.0' },
  reviewPolicy: {
    minAccepts: 1,
    reviewers: [TEST_PUBLISHER],
  },
};

describe('buildManifest → signManifest → verifySignedManifest', () => {
  it('roundtrips with committed test key', () => {
    const unsigned = buildManifest(GENESIS_INPUT);
    const signed = signManifest(unsigned, TEST_PRIVATE_KEY);
    expect(verifySignedManifest(signed)).toEqual({ ok: true, publisher: TEST_PUBLISHER });
  });

  it('matches committed golden fixture', () => {
    expect(verifySignedManifest(fixtureManifest)).toEqual({ ok: true, publisher: TEST_PUBLISHER });
    expect(manifestHash(fixtureManifest)).toBe(fixtureGolden.manifestHash);
  });

  it('rejects tampered signature', () => {
    const signed = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    const tampered = { ...signed, signature: `0x${'11'.repeat(65)}` };
    const result = verifySignedManifest(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-signature');
    }
  });

  it('rejects tampered jsonlSha256', () => {
    const signed = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    const tampered = {
      ...signed,
      dataset: {
        ...signed.dataset,
        jsonlSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
      },
    };
    const result = verifySignedManifest(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('address-mismatch');
    }
  });

  it('produces stable manifestHash across two runs', () => {
    const first = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    const second = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    expect(manifestHash(first)).toBe(manifestHash(second));
  });

  it('sets publisher to EIP-55 of test key', () => {
    const signed = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    expect(signed.publisher).toBe(TEST_PUBLISHER);
    const recovered = recoverPersonalSignAddress(signingPayload(signed), signed.signature);
    expect(recovered).toBe(TEST_PUBLISHER);
  });

  it('accepts genesis parentRoot null or zero', () => {
    const fromNull = buildManifest({ ...GENESIS_INPUT, parentRoot: null });
    expect(fromNull.parent).toBeNull();

    const fromZero = buildManifest({ ...GENESIS_INPUT, parentRoot: ZERO_MERKLE_ROOT });
    expect(fromZero.parent).toBeNull();

    expect(() =>
      buildManifest({
        ...GENESIS_INPUT,
        parentRoot: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      }),
    ).toThrow(/genesis epoch requires parentRoot/);
  });

  it('omits claims and parseManifest accepts the signed manifest', () => {
    const signed = signManifest(buildManifest(GENESIS_INPUT), TEST_PRIVATE_KEY);
    expect('claims' in signed).toBe(false);
    expect(parseManifest(signed).ok).toBe(true);
  });
});

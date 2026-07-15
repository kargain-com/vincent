import { verifyEpoch } from '@kargain/vincent-compiler';
import { claimHash } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { ZERO_BYTES32, sha256ContentIdToBytes32 } from '../src/adapters/sha256-bytes32.js';
import {
  assembleCommunityEpoch,
  parseCommunityClaims,
  publishCommunityEpoch,
  REVIEW_ARCHIVE_KIND,
} from '../src/community-epoch.js';
import { parseReviewArchive } from '../src/parse-review-archive.js';
import { loadCheckpoint } from '../src/publish-checkpoint.js';
import {
  ATTESTER_1,
  ATTESTER_2,
  ATTESTER_KEY_1,
  ATTESTER_KEY_2,
  archiveBytes,
  buildArchive,
  buildBaseEpochFixture,
  COMMUNITY_CLAIMS,
  COMMUNITY_PUBLISHER,
  COMMUNITY_PUBLISHER_KEY,
  communityClaimsJsonl,
} from './community-fixtures.js';
import { loadGenesisMiniClaims, testCheckpointPath } from './helpers.js';
import { createMockChainPublisher } from './mock-chain-publisher.js';
import { createMockUploader } from './mock-uploader.js';

function archiveSummary(claims = COMMUNITY_CLAIMS, keys = [ATTESTER_KEY_1]) {
  return parseReviewArchive(buildArchive(claims, keys));
}

describe('parseCommunityClaims', () => {
  it('fails closed on a non-JSON line', () => {
    expect(() => parseCommunityClaims('not json\n')).toThrow(/line 1 is not valid JSON/);
  });

  it('fails closed on an invalid claim', () => {
    expect(() => parseCommunityClaims('{"schemaVersion":"1.0","type":"wmi"}\n')).toThrow(
      /line 1 is not a valid claim/,
    );
  });

  it('fails closed on an empty file', () => {
    expect(() => parseCommunityClaims('\n')).toThrow(/contains no claims/);
  });
});

describe('assembleCommunityEpoch', () => {
  it('fails when a community claim has no valid endorsement in the archive', () => {
    const archive = archiveSummary([COMMUNITY_CLAIMS[0]]);

    expect(() =>
      assembleCommunityEpoch({
        baseClaims: loadGenesisMiniClaims(),
        communityClaimsJsonl: communityClaimsJsonl(COMMUNITY_CLAIMS),
        archive,
      }),
    ).toThrow(/has no valid endorse attestation/);
  });

  it('merges base and community claims into a deterministic full snapshot', () => {
    const baseClaims = loadGenesisMiniClaims();
    const input = {
      baseClaims,
      communityClaimsJsonl: communityClaimsJsonl(),
      archive: archiveSummary(),
    };

    const first = assembleCommunityEpoch(input);
    const second = assembleCommunityEpoch(input);

    expect(first.baseClaimCount).toBe(baseClaims.length);
    expect(first.communityClaimCount).toBe(COMMUNITY_CLAIMS.length);
    expect(first.mergedClaimCount).toBe(baseClaims.length + COMMUNITY_CLAIMS.length);
    // Same inputs => byte-identical snapshot (jsonlSha256 and merkleRoot).
    expect(second.epoch.jsonlSha256).toBe(first.epoch.jsonlSha256);
    expect(second.epoch.merkleRoot).toBe(first.epoch.merkleRoot);
  });

  it('dedupes community claims already present in the base snapshot', () => {
    const baseClaims = loadGenesisMiniClaims();
    const overlapping = [...COMMUNITY_CLAIMS, baseClaims[0]];
    const assembled = assembleCommunityEpoch({
      baseClaims,
      communityClaimsJsonl: communityClaimsJsonl(overlapping),
      archive: archiveSummary(overlapping),
    });

    expect(assembled.mergedClaimCount).toBe(baseClaims.length + COMMUNITY_CLAIMS.length);
  });

  it('declares minAccepts 1 with the archive endorsers as reviewers', () => {
    const assembled = assembleCommunityEpoch({
      baseClaims: loadGenesisMiniClaims(),
      communityClaimsJsonl: communityClaimsJsonl(),
      archive: archiveSummary(COMMUNITY_CLAIMS, [ATTESTER_KEY_2, ATTESTER_KEY_1]),
    });

    expect(assembled.reviewPolicy.minAccepts).toBe(1);
    expect(assembled.reviewPolicy.reviewers).toEqual([ATTESTER_1, ATTESTER_2].sort());
  });
});

describe('publishCommunityEpoch', () => {
  function publishDeps(overrides?: {
    chainPublisher?: ReturnType<typeof createMockChainPublisher>;
    uploader?: ReturnType<typeof createMockUploader>;
    checkpointPath?: string;
  }) {
    return {
      baseClaims: loadGenesisMiniClaims(),
      communityClaimsJsonl: communityClaimsJsonl(),
      archiveBytes: archiveBytes(buildArchive()),
      signerKeyHex: COMMUNITY_PUBLISHER_KEY,
      uploader: overrides?.uploader ?? createMockUploader(),
      chainPublisher:
        overrides?.chainPublisher ??
        createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER }),
      checkpointPath: overrides?.checkpointPath ?? testCheckpointPath(),
    };
  }

  it('publishes an own-chain genesis with parent null and the community review policy', async () => {
    const uploader = createMockUploader();
    const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });
    const checkpointPath = testCheckpointPath();

    const result = await publishCommunityEpoch(
      publishDeps({ uploader, chainPublisher, checkpointPath }),
    );

    expect(result.status).toBe('published');
    if (result.status !== 'published') throw new Error('unreachable');

    expect(result.report.manifest.epoch).toBe(1);
    expect(result.report.manifest.parent).toBeNull();
    expect(result.report.manifest.publisher).toBe(COMMUNITY_PUBLISHER);
    expect(result.report.manifest.reviewPolicy).toEqual({
      minAccepts: 1,
      reviewers: [ATTESTER_1],
    });
    expect(chainPublisher.calls[0]?.parentRoot).toBe(ZERO_BYTES32);

    // The published snapshot is verifiable with the npm compiler.
    const mergedClaims = [...loadGenesisMiniClaims(), ...COMMUNITY_CLAIMS];
    expect(verifyEpoch(result.report.manifest, mergedClaims)).toEqual({ ok: true });
  });

  it('uploads the attestation archive byte-for-byte as a Kind=review-archive item', async () => {
    const uploader = createMockUploader();
    const bytes = archiveBytes(buildArchive());
    const checkpointPath = testCheckpointPath();

    const result = await publishCommunityEpoch({
      ...publishDeps({ uploader, checkpointPath }),
      archiveBytes: bytes,
    });
    if (result.status !== 'published') throw new Error('expected published');

    const record = uploader.records.find((entry) =>
      entry.tags.some((tag) => tag.name === 'Kind' && tag.value === REVIEW_ARCHIVE_KIND),
    );
    expect(record).toBeDefined();
    expect(record?.tags).toEqual(
      expect.arrayContaining([
        { name: 'App', value: 'vincent' },
        { name: 'Epoch', value: '1' },
        { name: 'Kind', value: REVIEW_ARCHIVE_KIND },
      ]),
    );
    expect(record?.data).toEqual(bytes);
    expect(result.reviewArchiveUri).toBe(record?.uri);
    expect(loadCheckpoint(checkpointPath)?.reviewArchiveUri).toBe(record?.uri);
  });

  it('publishes an incremental epoch with the prior own-chain merkleRoot as parent', async () => {
    const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });

    const first = await publishCommunityEpoch({
      ...publishDeps({ chainPublisher }),
      communityClaimsJsonl: communityClaimsJsonl([COMMUNITY_CLAIMS[0]]),
      archiveBytes: archiveBytes(buildArchive([COMMUNITY_CLAIMS[0]])),
    });
    if (first.status !== 'published') throw new Error('expected published');

    const second = await publishCommunityEpoch(publishDeps({ chainPublisher }));
    if (second.status !== 'published') throw new Error('expected published');

    expect(second.report.manifest.epoch).toBe(2);
    expect(second.report.manifest.parent).toBe(first.report.manifest.dataset.merkleRoot);
    expect(chainPublisher.calls[1]?.parentRoot).toBe(
      sha256ContentIdToBytes32(first.report.manifest.dataset.merkleRoot),
    );
  });

  it('fails closed when the archive misses an endorsement for an accepted claim', async () => {
    await expect(
      publishCommunityEpoch({
        ...publishDeps(),
        archiveBytes: archiveBytes(buildArchive([COMMUNITY_CLAIMS[0]])),
      }),
    ).rejects.toThrow(/has no valid endorse attestation/);
  });

  it('fails closed when the archive file is not valid JSON', async () => {
    await expect(
      publishCommunityEpoch({
        ...publishDeps(),
        archiveBytes: new TextEncoder().encode('{broken'),
      }),
    ).rejects.toThrow(/file is not valid JSON/);
  });

  describe('jitter window (§4.8)', () => {
    const T0 = new Date('2026-07-15T00:00:00.000Z');
    const EXPECTED_NOT_BEFORE = '2026-07-17T00:00:00.000Z'; // T0 + 0.5 * 4 days

    it('persists a crypto-random window and refuses to upload before it', async () => {
      const uploader = createMockUploader();
      const checkpointPath = testCheckpointPath();

      const result = await publishCommunityEpoch({
        ...publishDeps({ uploader, checkpointPath }),
        jitter: { jitterDays: 4, now: () => T0, random: () => 0.5 },
      });

      expect(result.status).toBe('window-pending');
      if (result.status !== 'window-pending') throw new Error('unreachable');
      expect(result.publishNotBefore).toBe(EXPECTED_NOT_BEFORE);
      expect(uploader.records).toHaveLength(0);
      expect(loadCheckpoint(checkpointPath)?.publishNotBefore).toBe(EXPECTED_NOT_BEFORE);
    });

    it('never re-rolls the window on re-run, even without --jitter-days', async () => {
      const checkpointPath = testCheckpointPath();
      const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });

      await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: { jitterDays: 4, now: () => T0, random: () => 0.5 },
      });

      // Re-run before the window without the jitter flag: still gated by the checkpoint.
      const rerun = await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: {
          now: () => new Date('2026-07-16T00:00:00.000Z'),
          random: () => {
            throw new Error('window must not be re-rolled');
          },
        },
      });

      expect(rerun.status).toBe('window-pending');
      if (rerun.status !== 'window-pending') throw new Error('unreachable');
      expect(rerun.publishNotBefore).toBe(EXPECTED_NOT_BEFORE);
    });

    it('publishes once the window has opened', async () => {
      const checkpointPath = testCheckpointPath();
      const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });

      await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: { jitterDays: 4, now: () => T0, random: () => 0.5 },
      });

      const result = await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: { now: () => new Date('2026-07-17T00:00:00.001Z') },
      });

      expect(result.status).toBe('published');
      expect(chainPublisher.calls).toHaveLength(1);
    });

    it('force bypasses the window (testnet-only escape hatch)', async () => {
      const checkpointPath = testCheckpointPath();
      const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });

      await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: { jitterDays: 4, now: () => T0, random: () => 0.5 },
      });

      const result = await publishCommunityEpoch({
        ...publishDeps({ chainPublisher, checkpointPath }),
        jitter: { now: () => T0, force: true },
      });

      expect(result.status).toBe('published');
    });

    it('rejects a negative jitterDays', async () => {
      await expect(
        publishCommunityEpoch({
          ...publishDeps(),
          jitter: { jitterDays: -1 },
        }),
      ).rejects.toThrow(/jitterDays must be a non-negative number/);
    });
  });

  it('reuses a checkpointed archive URI instead of re-uploading', async () => {
    const checkpointPath = testCheckpointPath();
    const chainPublisher = createMockChainPublisher({ publisher: COMMUNITY_PUBLISHER });
    const firstUploader = createMockUploader();

    // Upload everything but do not anchor, so the fingerprint stays on epoch 1.
    const first = await publishCommunityEpoch({
      ...publishDeps({ chainPublisher, checkpointPath, uploader: firstUploader }),
      phases: { anchor: false },
    });
    if (first.status !== 'published') throw new Error('expected published');
    expect(first.reviewArchiveUri).toBeDefined();

    const secondUploader = createMockUploader();
    const second = await publishCommunityEpoch({
      ...publishDeps({ chainPublisher, checkpointPath, uploader: secondUploader }),
    });
    if (second.status !== 'published') throw new Error('expected published');

    expect(second.reviewArchiveUri).toBe(first.reviewArchiveUri);
    const archiveUploads = secondUploader.records.filter((entry) =>
      entry.tags.some((tag) => tag.name === 'Kind' && tag.value === REVIEW_ARCHIVE_KIND),
    );
    expect(archiveUploads).toHaveLength(0);
  });

  it('hard-gates on endorsements keyed by exact claim hash', () => {
    // Guard against drift between the archive keys and claimHash of parsed claims.
    const archive = archiveSummary();
    for (const claim of COMMUNITY_CLAIMS) {
      expect(archive.endorsersByClaim.has(claimHash(claim))).toBe(true);
    }
  });
});

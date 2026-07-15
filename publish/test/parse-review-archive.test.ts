import { attest, canonicalize, claimHash, sha256Hex } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { parseReviewArchive } from '../src/parse-review-archive.js';
import {
  ATTESTER_1,
  ATTESTER_2,
  ATTESTER_KEY_1,
  ATTESTER_KEY_2,
  buildArchive,
  COMMUNITY_CLAIMS,
  makeReject,
  utf8,
} from './community-fixtures.js';

const CLAIM = COMMUNITY_CLAIMS[0];
const CLAIM_HASH = claimHash(CLAIM);
const OTHER_HASH = claimHash(COMMUNITY_CLAIMS[1]);

describe('parseReviewArchive', () => {
  it('summarizes valid endorsements per claim and across the archive', () => {
    const archive = buildArchive(COMMUNITY_CLAIMS, [ATTESTER_KEY_2, ATTESTER_KEY_1]);
    const summary = parseReviewArchive(archive);

    expect(summary.claimCount).toBe(2);
    expect(summary.endorseCount).toBe(4);
    expect(summary.rejectCount).toBe(0);
    expect(summary.endorsersByClaim.get(CLAIM_HASH)).toEqual([ATTESTER_2, ATTESTER_1]);
    expect(summary.endorsers).toEqual([ATTESTER_1, ATTESTER_2].sort());
  });

  it('deduplicates repeated endorsements from the same attester', () => {
    const review = attest(CLAIM_HASH, ATTESTER_KEY_1);
    const archive = {
      [CLAIM_HASH]: { reviews: [{ review }, { review }] },
    };
    const summary = parseReviewArchive(archive);

    expect(summary.endorseCount).toBe(2);
    expect(summary.endorsersByClaim.get(CLAIM_HASH)).toEqual([ATTESTER_1]);
  });

  it('tolerates unknown extra fields on entries, review items, and review docs', () => {
    const review = {
      ...attest(CLAIM_HASH, ATTESTER_KEY_1),
      futureField: 'ignored',
    };
    const archive = {
      [CLAIM_HASH]: {
        reviews: [{ review, eventId: 'ab'.repeat(32), relaySeenAt: 123, extra: {} }],
        proposal: { eventId: 'cd'.repeat(32), futureFlag: true },
        producerVersion: '9.9.9',
      },
    };

    const summary = parseReviewArchive(archive);
    expect(summary.endorsersByClaim.get(CLAIM_HASH)).toEqual([ATTESTER_1]);
  });

  it('fails when an endorse claim does not match the archive key', () => {
    const archive = {
      [OTHER_HASH]: { reviews: [{ review: attest(CLAIM_HASH, ATTESTER_KEY_1) }] },
    };
    expect(() => parseReviewArchive(archive)).toThrow(/does not match archive key/);
  });

  it('fails on a tampered endorse signature', () => {
    const review = attest(CLAIM_HASH, ATTESTER_KEY_1);
    const flipped = review.signature.endsWith('1') ? '2' : '1';
    const tampered = { ...review, signature: review.signature.slice(0, -1) + flipped };
    const archive = { [CLAIM_HASH]: { reviews: [{ review: tampered }] } };

    expect(() => parseReviewArchive(archive)).toThrow(/Invalid review archive: endorse/);
  });

  it('counts valid rejects without adding reviewers', () => {
    const archive = {
      [CLAIM_HASH]: {
        reviews: [
          { review: attest(CLAIM_HASH, ATTESTER_KEY_1) },
          { review: makeReject(CLAIM_HASH, ATTESTER_KEY_2) },
        ],
      },
    };
    const summary = parseReviewArchive(archive);

    expect(summary.rejectCount).toBe(1);
    expect(summary.endorsers).toEqual([ATTESTER_1]);
  });

  it('fails on a reject whose signature does not recover to the attester', () => {
    const reject = makeReject(CLAIM_HASH, ATTESTER_KEY_2) as { signature: string };
    const flipped = reject.signature.endsWith('1') ? '2' : '1';
    reject.signature = reject.signature.slice(0, -1) + flipped;
    const archive = { [CLAIM_HASH]: { reviews: [{ review: reject }] } };

    expect(() => parseReviewArchive(archive)).toThrow(/reject for sha256:/);
  });

  it('fails on a reject whose claim does not match the archive key', () => {
    const archive = {
      [OTHER_HASH]: { reviews: [{ review: makeReject(CLAIM_HASH, ATTESTER_KEY_2) }] },
    };
    expect(() => parseReviewArchive(archive)).toThrow(/reject claim does not match/);
  });

  it('fails on an unknown review kind', () => {
    const archive = {
      [CLAIM_HASH]: {
        reviews: [{ review: { ...attest(CLAIM_HASH, ATTESTER_KEY_1), kind: 'maybe' } }],
      },
    };
    expect(() => parseReviewArchive(archive)).toThrow(/must be "endorse" or "reject"/);
  });

  it('validates that proposal content hashes to the archive key', () => {
    const content = canonicalize(CLAIM);
    expect(`sha256:${sha256Hex(utf8(content))}`).toBe(CLAIM_HASH);

    const valid = {
      [CLAIM_HASH]: {
        reviews: [{ review: attest(CLAIM_HASH, ATTESTER_KEY_1) }],
        proposal: { content, eventId: 'ab'.repeat(32) },
      },
    };
    expect(parseReviewArchive(valid).claimCount).toBe(1);

    const tampered = {
      [CLAIM_HASH]: {
        reviews: [{ review: attest(CLAIM_HASH, ATTESTER_KEY_1) }],
        proposal: { content: `${content} ` },
      },
    };
    expect(() => parseReviewArchive(tampered)).toThrow(/proposal content .* hashes to/);
  });

  it('fails on structural violations of the frozen wire', () => {
    expect(() => parseReviewArchive([])).toThrow(/root must be a JSON object/);
    expect(() => parseReviewArchive({ 'not-a-hash': { reviews: [] } })).toThrow(
      /is not a sha256/,
    );
    expect(() => parseReviewArchive({ [CLAIM_HASH]: 'nope' })).toThrow(/must be an object/);
    expect(() => parseReviewArchive({ [CLAIM_HASH]: {} })).toThrow(/reviews array/);
    expect(() => parseReviewArchive({ [CLAIM_HASH]: { reviews: ['nope'] } })).toThrow(
      /review document/,
    );
    expect(() =>
      parseReviewArchive({ [CLAIM_HASH]: { reviews: [], proposal: 'nope' } }),
    ).toThrow(/proposal for .* must be an object/);
    expect(() =>
      parseReviewArchive({ [CLAIM_HASH]: { reviews: [], proposal: { content: 5 } } }),
    ).toThrow(/proposal content .* must be a string/);
  });
});

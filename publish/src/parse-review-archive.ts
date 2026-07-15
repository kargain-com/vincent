import {
  canonicalize,
  isValidChecksumAddress,
  parseAttestation,
  recoverPersonalSignAddress,
  sha256Hex,
  verifyAttestation,
} from '@kargain/vincent/protocol';

const SHA256_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]{130}$/;

/**
 * Validated view over a Kargain attestation archive (`attestation-archive.json`).
 *
 * The archive wire format is frozen on the Kargain side:
 *   { "<claimHash>": { reviews: [{ review, ...transport }], proposal? }, ... }
 *
 * Unknown extra fields are tolerated (the producer evolves independently); the
 * archive file itself is uploaded byte-for-byte, never re-serialized.
 */
export interface ReviewArchiveSummary {
  claimCount: number;
  endorseCount: number;
  rejectCount: number;
  /** claimHash -> unique valid endorse attesters (EIP-55). */
  endorsersByClaim: Map<string, string[]>;
  /** Unique valid endorse attesters across the archive (lexicographically sorted). */
  endorsers: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): Error {
  return new Error(`Invalid review archive: ${message}`);
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Project the protocol attestation fields, tolerating unknown extras. */
function projectReview(review: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: review.schemaVersion,
    claim: review.claim,
    attester: review.attester,
    kind: review.kind,
    signature: review.signature,
  };
}

function validateEndorse(review: Record<string, unknown>, claimHash: string): string {
  const parsed = parseAttestation(projectReview(review));
  if (!parsed.ok) {
    throw invalid(`endorse for ${claimHash}: ${parsed.error.message}`);
  }
  if (parsed.value.claim !== claimHash) {
    throw invalid(
      `endorse claim ${parsed.value.claim} does not match archive key ${claimHash}`,
    );
  }
  const verified = verifyAttestation(parsed.value);
  if (!verified.ok) {
    throw invalid(`endorse for ${claimHash}: ${verified.reason}`);
  }
  return parsed.value.attester;
}

/**
 * `kind: "reject"` is not a protocol attestation (§4.9 only defines `endorse`),
 * but the archive validates it with the same discipline: JCS payload excluding
 * `signature`, EIP-191 recovery, recovered address must equal the stated
 * attester. Rejects are informational context only.
 */
function validateReject(review: Record<string, unknown>, claimHash: string): void {
  if (review.schemaVersion !== '1.0') {
    throw invalid(`reject for ${claimHash}: schemaVersion must be "1.0"`);
  }
  if (review.claim !== claimHash) {
    throw invalid(`reject claim does not match archive key ${claimHash}`);
  }
  const attester = review.attester;
  if (typeof attester !== 'string' || !isValidChecksumAddress(attester)) {
    throw invalid(`reject for ${claimHash}: attester must be an EIP-55 address`);
  }
  const signature = review.signature;
  if (typeof signature !== 'string' || !SIGNATURE_RE.test(signature)) {
    throw invalid(`reject for ${claimHash}: signature must be 65 bytes of hex`);
  }

  const payload = canonicalize({
    schemaVersion: '1.0',
    claim: claimHash,
    attester,
    kind: 'reject',
  });
  let recovered: string;
  try {
    recovered = recoverPersonalSignAddress(payload, signature);
  } catch {
    throw invalid(`reject for ${claimHash}: signature is invalid`);
  }
  if (recovered !== attester) {
    throw invalid(`reject for ${claimHash}: recovered address does not match attester`);
  }
}

function validateProposal(proposal: unknown, claimHash: string): void {
  if (!isPlainObject(proposal)) {
    throw invalid(`proposal for ${claimHash} must be an object`);
  }
  if (proposal.content === undefined) {
    return;
  }
  if (typeof proposal.content !== 'string') {
    throw invalid(`proposal content for ${claimHash} must be a string`);
  }
  const hash = `sha256:${sha256Hex(utf8Bytes(proposal.content))}`;
  if (hash !== claimHash) {
    throw invalid(
      `proposal content for ${claimHash} hashes to ${hash} instead of the archive key`,
    );
  }
}

/** Parse and validate an attestation archive document (fail-closed, throws). */
export function parseReviewArchive(json: unknown): ReviewArchiveSummary {
  if (!isPlainObject(json)) {
    throw invalid('root must be a JSON object keyed by claimHash');
  }

  const endorsersByClaim = new Map<string, string[]>();
  const allEndorsers = new Set<string>();
  let endorseCount = 0;
  let rejectCount = 0;

  for (const [claimHash, entry] of Object.entries(json)) {
    if (!SHA256_HASH_RE.test(claimHash)) {
      throw invalid(`key ${claimHash} is not a sha256:<64 hex> claim hash`);
    }
    if (!isPlainObject(entry)) {
      throw invalid(`entry for ${claimHash} must be an object`);
    }
    if (!Array.isArray(entry.reviews)) {
      throw invalid(`entry for ${claimHash} must have a reviews array`);
    }

    const claimEndorsers: string[] = [];

    for (const item of entry.reviews as unknown[]) {
      if (!isPlainObject(item) || !isPlainObject(item.review)) {
        throw invalid(`review entry for ${claimHash} must be an object with a review document`);
      }
      const review = item.review;

      if (review.kind === 'endorse') {
        const attester = validateEndorse(review, claimHash);
        endorseCount += 1;
        if (!claimEndorsers.includes(attester)) {
          claimEndorsers.push(attester);
        }
        allEndorsers.add(attester);
      } else if (review.kind === 'reject') {
        validateReject(review, claimHash);
        rejectCount += 1;
      } else {
        throw invalid(`review kind for ${claimHash} must be "endorse" or "reject"`);
      }
    }

    if (entry.proposal !== undefined) {
      validateProposal(entry.proposal, claimHash);
    }

    endorsersByClaim.set(claimHash, claimEndorsers);
  }

  return {
    claimCount: endorsersByClaim.size,
    endorseCount,
    rejectCount,
    endorsersByClaim,
    endorsers: [...allEndorsers].sort(),
  };
}

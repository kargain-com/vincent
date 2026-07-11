import {
  ATTESTATION_REQUIRED_KEYS,
  ATTESTATION_TOP_LEVEL_KEYS,
} from './constants.js';
import {
  checkRequiredKeys,
  checkTopLevelKeys,
  fail,
  isPlainObject,
  parseAddress,
  parseAttestationKind,
  parseSha256Hash,
  parseSignature,
} from './parse-utils.js';
import type { Attestation, ParseResult } from './types.js';

/** Parse and validate an attestation document (fail-closed, no exceptions). */
export function parseAttestation(json: unknown): ParseResult<Attestation> {
  if (!isPlainObject(json)) {
    return fail('invalid-type', 'Attestation must be a JSON object');
  }

  const topKeys = checkTopLevelKeys(json, ATTESTATION_TOP_LEVEL_KEYS);
  if (!topKeys.ok) {
    return topKeys;
  }

  const required = checkRequiredKeys(json, ATTESTATION_REQUIRED_KEYS);
  if (!required.ok) {
    return required;
  }

  if (json.schemaVersion !== '1.0') {
    return fail('unsupported-schema-version', 'Attestation schemaVersion must be "1.0"');
  }

  const claim = parseSha256Hash(json.claim, 'claim');
  if (!claim.ok) {
    return claim;
  }

  const attester = parseAddress(json.attester, 'attester');
  if (!attester.ok) {
    return attester;
  }

  const kind = parseAttestationKind(json.kind);
  if (!kind.ok) {
    return kind;
  }

  const signature = parseSignature(json.signature);
  if (!signature.ok) {
    return signature;
  }

  return {
    ok: true,
    value: {
      schemaVersion: '1.0',
      claim: claim.value,
      attester: attester.value,
      kind: kind.value,
      signature: signature.value,
    },
  };
}

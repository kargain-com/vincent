export { canonicalize, CanonicalizeError } from './canonicalize.js';
export {
  ATTESTATION_KINDS,
  ATTESTATION_REQUIRED_KEYS,
  ATTESTATION_TOP_LEVEL_KEYS,
  CLAIM_REQUIRED_KEYS,
  CLAIM_TOP_LEVEL_KEYS,
  CLAIM_TYPES,
  CLAIM_TYPES_V10,
  CLAIM_TYPES_V11,
  CYCLE_RULES,
  MANIFEST_REQUIRED_KEYS,
  MANIFEST_TOP_LEVEL_KEYS,
  PROVENANCE_VALUES,
  VEHICLE_ATTRIBUTES,
} from './constants.js';
export {
  addressFromPrivateKey,
  keccak256Hex,
  recoverPersonalSignAddress,
  sha256Hex,
  signPersonalMessage,
  toChecksumAddress,
} from './crypto.js';
export { isValidChecksumAddress } from './eip55.js';
export { attestationHash, claimHash, manifestHash, signingPayload } from './hash.js';
export { parseAttestation } from './parse-attestation.js';
export { parseMatchExpression, parseMatchSegment } from './parse-match.js';
export { parseClaim } from './parse-claim.js';
export { parseManifest } from './parse-manifest.js';
export { attest, signManifest } from './sign.js';
export type {
  Attestation,
  AttestationKind,
  AttestationVerifyResult,
  Claim,
  ClaimBaseV10,
  ClaimBaseV11,
  ClaimSchemaVersion,
  ClaimType,
  CompilerInfo,
  CycleRule,
  DatasetInfo,
  Manifest,
  MatchClassToken,
  MatchExpression,
  MatchLiteralToken,
  MatchToken,
  MatchWildcardToken,
  ParseError,
  ParseResult,
  Provenance,
  ReviewPolicy,
  UnsignedAttestation,
  UnsignedManifest,
  VehicleAttribute,
  VerifyResult,
  VdsBindingClaim,
  VdsBindingClaimKey,
  VdsPatternClaim,
  VdsPatternClaimKey,
  VdsPatternClaimValue,
  VdsPatternMatchKey,
  VdsSchemaClaim,
  VdsSchemaClaimKey,
  WmiClaim,
  WmiClaimKey,
  WmiClaimValue,
  YearHintClaim,
  YearHintClaimKey,
  YearHintClaimValue,
} from './types.js';
export { verifyAttestation, verifyManifest } from './verify.js';

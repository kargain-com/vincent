export { canonicalize, CanonicalizeError } from './canonicalize.js';
export {
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
export { claimHash, manifestHash, signingPayload } from './hash.js';
export { parseMatchExpression, parseMatchSegment } from './parse-match.js';
export { parseClaim } from './parse-claim.js';
export { parseManifest } from './parse-manifest.js';
export { signClaim, signManifest } from './sign.js';
export type {
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
  UnsignedClaim,
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
export { verifyClaim, verifyManifest } from './verify.js';

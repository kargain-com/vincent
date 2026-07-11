export { createDecoder } from './create-decoder.js';
export type { CreateDecoderOptions } from './create-decoder.js';
export { matchExpression, matchParsedExpression } from './match.js';
export { originFromWmiTable } from './origin.js';
export { parseLeaf, parseLeafBytes, parseWireLeaf, isPartitionManifest } from './parse-leaf.js';
export { resolveWmiKey } from './resolve.js';
export { verifyLeaf } from './verify-leaf.js';
export type {
  AttributeCandidate,
  DecodeOptions,
  DecodeResult,
  DecodedAttribute,
  DecodedWmi,
  Decoder,
  OriginResult,
  VinError,
  VinWarning,
} from './types.js';
export type {
  DecodeLeaf,
  GetLeaf,
  LeafBinding,
  LeafPattern,
  LeafSchema,
  MerkleProof,
  PartitionEntry,
  PartitionManifest,
  WireLeaf,
} from './leaf-types.js';

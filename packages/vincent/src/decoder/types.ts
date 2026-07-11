import type { VinError, VinWarning } from '../validation.js';

import type { OriginResult } from './origin.js';

/** Options passed to {@link Decoder.decode}. */
export interface DecodeOptions {
  /** Explicit model year; overrides decodeModelYear heuristics. */
  year?: number;
}

/** A candidate value when an attribute is ambiguous or year-dependent. */
export interface AttributeCandidate {
  value: string;
  schema: string;
}

/** One decoded vehicle attribute from vds-pattern claims. */
export interface DecodedAttribute {
  attribute: string;
  value: string | null;
  ambiguous: boolean;
  yearDependent?: boolean;
  candidates?: AttributeCandidate[];
  schema: string | null;
}

/** WMI metadata resolved from the bundled ./wmi table + vinRegion. */
export interface DecodedWmi {
  wmi: string;
  manufacturer: string;
  country: string | null;
  vehicleType: string | null;
  region: string;
}

/** Full decode result for a VIN against a compiled epoch dataset. */
export interface DecodeResult {
  vin: string;
  valid: boolean;
  year: {
    value: number | null;
    ambiguous: boolean;
    candidates: number[];
  };
  wmi: DecodedWmi | null;
  attributes: DecodedAttribute[];
  errors: VinError[];
  warnings: VinWarning[];
}

/** Decoder instance opened by {@link createDecoder}. */
export interface Decoder {
  origin(vin: string): Promise<OriginResult>;
  decode(vin: string, options?: DecodeOptions): Promise<DecodeResult>;
}

export type { OriginResult } from './origin.js';
export type { GetLeaf, MerkleProof } from './leaf-types.js';

export type { VinError, VinWarning };

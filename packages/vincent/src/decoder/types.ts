import type { VinError, VinWarning } from '../validation.js';

/** Options passed to {@link Decoder.decode}. */
export interface DecodeOptions {
  /** Explicit model year; overrides decodeModelYear heuristics. */
  year?: number;
}

/** A candidate value when an attribute is ambiguous or year-dependent. */
export interface AttributeCandidate {
  value: string;
  schema: string;
  sourceClaimHash: string;
}

/** One decoded vehicle attribute from vds-pattern claims. */
export interface DecodedAttribute {
  attribute: string;
  value: string | null;
  ambiguous: boolean;
  yearDependent?: boolean;
  candidates?: AttributeCandidate[];
  schema: string | null;
  sourceClaimHash: string | null;
}

/** WMI metadata resolved from the epoch dataset. */
export interface DecodedWmi {
  wmi: string;
  manufacturer: string;
  country: string;
  region: string;
  sourceClaimHash: string;
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

/** Sync decoder instance opened by {@link createDecoder}. */
export interface Decoder {
  decode(vin: string, options?: DecodeOptions): DecodeResult;
}

export type { VinError, VinWarning };

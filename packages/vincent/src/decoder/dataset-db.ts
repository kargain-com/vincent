/** Read-only row shapes from the compiler SQLite cache. */
export interface WmiRow {
  wmi: string;
  manufacturer: string;
  country: string;
  region: string;
  claimHash: string;
}

export interface BindingRow {
  claimHash: string;
  wmi: string;
  yearFrom: number;
  yearTo: number | null;
  schemaHash: string;
}

export interface PatternRow {
  claimHash: string;
  schemaHash: string;
  matchVds: string;
  matchVis: string | null;
  attribute: string;
  code: string;
}

/** Minimal read interface used by decode resolution (mockable in tests). */
export interface DatasetDb {
  getWmi(wmi: string): WmiRow | null;
  getBindings(wmi: string, year: number): BindingRow[];
  getPatterns(schemaHash: string): PatternRow[];
}

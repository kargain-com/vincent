/**
 * SQLite WASM glue — the only module that imports @sqlite.org/sqlite-wasm.
 * Excluded from coverage thresholds; logic is covered via DatasetDb mocks.
 */
import type {
  BindingRow,
  DatasetDb,
  PatternRow,
  WmiRow,
} from './dataset-db.js';

type Sqlite3Module = Awaited<
  ReturnType<typeof import('@sqlite.org/sqlite-wasm').default>
>;

type SqliteDatabase = InstanceType<Sqlite3Module['oo1']['DB']>;

let sqlitePromise: Promise<Sqlite3Module> | undefined;

async function getSqlite(): Promise<Sqlite3Module> {
  if (sqlitePromise === undefined) {
    sqlitePromise = import('@sqlite.org/sqlite-wasm').then((mod) => mod.default());
  }
  return sqlitePromise;
}

function mapWmiRow(row: Record<string, unknown>): WmiRow {
  return {
    wmi: String(row.wmi),
    manufacturer: String(row.manufacturer),
    country: String(row.country),
    region: String(row.region),
    claimHash: String(row.claim_hash),
  };
}

function mapBindingRow(row: Record<string, unknown>): BindingRow {
  return {
    claimHash: String(row.claim_hash),
    wmi: String(row.wmi),
    yearFrom: Number(row.year_from),
    yearTo: row.year_to === null ? null : Number(row.year_to),
    schemaHash: String(row.schema_hash),
  };
}

function mapPatternRow(row: Record<string, unknown>): PatternRow {
  const matchVis = row.match_vis;
  return {
    claimHash: String(row.claim_hash),
    schemaHash: String(row.schema_hash),
    matchVds: String(row.match_vds),
    matchVis: typeof matchVis === 'string' ? matchVis : null,
    attribute: String(row.attribute),
    code: String(row.code),
  };
}

class SqliteDatasetDb implements DatasetDb {
  constructor(private readonly db: SqliteDatabase) {}

  getWmi(wmi: string): WmiRow | null {
    const rows = this.db.selectObjects('SELECT * FROM wmi WHERE wmi = ?', [wmi]) as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) {
      return null;
    }
    return mapWmiRow(rows[0]);
  }

  getBindings(wmi: string, year: number): BindingRow[] {
    const rows = this.db.selectObjects(
      'SELECT claim_hash, wmi, year_from, year_to, schema_hash FROM vds_binding WHERE wmi = ? AND year_from <= ? AND (year_to IS NULL OR year_to >= ?)',
      [wmi, year, year],
    ) as Record<string, unknown>[];
    return rows.map(mapBindingRow);
  }

  getPatterns(schemaHash: string): PatternRow[] {
    const rows = this.db.selectObjects(
      'SELECT claim_hash, schema_hash, match_vds, match_vis, attribute, code FROM vds_pattern WHERE schema_hash = ?',
      [schemaHash],
    ) as Record<string, unknown>[];
    return rows.map(mapPatternRow);
  }

  close(): void {
    this.db.close();
  }
}

/** Open a compiler-produced SQLite cache from bytes. */
export async function openDatasetDb(dataset: Uint8Array): Promise<DatasetDb & { close(): void }> {
  const sqlite3 = await getSqlite();
  const db = new sqlite3.oo1.DB(':memory:', 'cw');
  const dbPointer = db.pointer;
  if (dbPointer === undefined) {
    db.close();
    throw new Error('Failed to open in-memory epoch database');
  }
  const pointer = sqlite3.wasm.allocFromTypedArray(dataset);
  const flags =
    sqlite3.capi.SQLITE_DESERIALIZE_READONLY | sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE;
  const rc = sqlite3.capi.sqlite3_deserialize(
    dbPointer,
    'main',
    pointer,
    dataset.byteLength,
    dataset.byteLength,
    flags,
  );
  if (rc !== sqlite3.capi.SQLITE_OK) {
    db.close();
    throw new Error(`Failed to deserialize epoch dataset (sqlite rc ${rc})`);
  }
  return new SqliteDatasetDb(db);
}

/** Reset cached WASM module (tests only). */
export function resetSqliteForTests(): void {
  sqlitePromise = undefined;
}

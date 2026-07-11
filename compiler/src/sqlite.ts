import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { claimHash } from '@kargain/vincent/protocol';
import type { Claim } from '@kargain/vincent/protocol';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

import { contentSha256 } from './hash-content.js';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');

let sqlPromise: Promise<SqlJsStatic> | undefined;

function getSql(): Promise<SqlJsStatic> {
  if (sqlPromise === undefined) {
    sqlPromise = initSqlJs({ wasmBinary: readFileSync(wasmPath) });
  }
  return sqlPromise;
}

const SCHEMA_DDL = `
CREATE TABLE wmi (
  wmi TEXT PRIMARY KEY NOT NULL,
  manufacturer TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  claim_hash TEXT NOT NULL
);

CREATE TABLE vds_schema (
  claim_hash TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE vds_binding (
  claim_hash TEXT PRIMARY KEY NOT NULL,
  wmi TEXT NOT NULL,
  year_from INTEGER NOT NULL,
  year_to INTEGER,
  schema_hash TEXT NOT NULL
);

CREATE INDEX idx_vds_binding_wmi ON vds_binding(wmi);

CREATE TABLE vds_pattern (
  claim_hash TEXT PRIMARY KEY NOT NULL,
  schema_hash TEXT NOT NULL,
  match_vds TEXT NOT NULL,
  match_vis TEXT,
  attribute TEXT NOT NULL,
  code TEXT NOT NULL
);

CREATE INDEX idx_vds_pattern_schema ON vds_pattern(schema_hash);

CREATE TABLE year_hint (
  wmi TEXT PRIMARY KEY NOT NULL,
  cycle_rule TEXT NOT NULL,
  claim_hash TEXT NOT NULL
);

CREATE TABLE _meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

function insertClaim(db: Database, claim: Claim): void {
  const hash = claimHash(claim);

  switch (claim.type) {
    case 'wmi':
      db.run(
        'INSERT INTO wmi (wmi, manufacturer, country, region, claim_hash) VALUES (?, ?, ?, ?, ?)',
        [claim.key.wmi, claim.value.manufacturer, claim.value.country, claim.value.region, hash],
      );
      break;
    case 'vds-schema':
      db.run('INSERT INTO vds_schema (claim_hash, name) VALUES (?, ?)', [hash, claim.key.name]);
      break;
    case 'vds-binding':
      db.run(
        'INSERT INTO vds_binding (claim_hash, wmi, year_from, year_to, schema_hash) VALUES (?, ?, ?, ?, ?)',
        [hash, claim.key.wmi, claim.key.yearFrom, claim.key.yearTo, claim.key.schema],
      );
      break;
    case 'vds-pattern':
      db.run(
        'INSERT INTO vds_pattern (claim_hash, schema_hash, match_vds, match_vis, attribute, code) VALUES (?, ?, ?, ?, ?, ?)',
        [
          hash,
          claim.key.schema,
          claim.key.match.vds,
          claim.key.match.vis ?? null,
          claim.value.attribute,
          claim.value.code,
        ],
      );
      break;
    case 'year-hint':
      db.run('INSERT INTO year_hint (wmi, cycle_rule, claim_hash) VALUES (?, ?, ?)', [
        claim.key.wmi,
        claim.value.cycleRule,
        hash,
      ]);
      break;
  }
}

/** Build derived SQLite cache from sorted claims (best-effort determinism). */
export async function buildSqlite(
  claims: readonly Claim[],
  jsonlSha256: string,
): Promise<{ sqlite: Uint8Array; sqliteSha256: string }> {
  const SQL = await getSql();
  const db = new SQL.Database();
  db.run(SCHEMA_DDL);

  for (const claim of claims) {
    insertClaim(db, claim);
  }

  db.run('INSERT INTO _meta (key, value) VALUES (?, ?)', ['jsonl_sha256', jsonlSha256]);
  db.run('INSERT INTO _meta (key, value) VALUES (?, ?)', ['claim_count', String(claims.length)]);
  db.run('INSERT INTO _meta (key, value) VALUES (?, ?)', ['compiler_name', 'vincent-compiler']);
  db.run('INSERT INTO _meta (key, value) VALUES (?, ?)', ['compiler_version', '1.0.0']);

  const exported = db.export();
  db.close();

  const sqlite = new Uint8Array(exported);
  return { sqlite, sqliteSha256: contentSha256(sqlite) };
}

/** Reset cached sql.js instance (tests only). */
export function resetSqlCacheForTests(): void {
  sqlPromise = undefined;
}

import type { Claim, VehicleAttribute } from '@kargain/vincent/protocol';
import { claimHash } from '@kargain/vincent/protocol';

import { deriveWmiRegion } from './derive-region.js';
import { keysToMatch } from './keys-to-match.js';
import type { VpicLookups } from '../vpic/parse-lookups.js';
import type { PatternRow, VinSchemaRow, WmiVinSchemaRow } from '../vpic/parse-vds.js';
import type { WmiTableRow } from '../vpic/parse-wmi.js';
import type { ProgressFn } from '../vpic/source.js';
import { trimField } from '../vpic/parse-utils.js';
import { PROVENANCE } from '../vpic/source.js';

export const PROFILE_ELEMENT_MAP: ReadonlyMap<number, VehicleAttribute> = new Map([
  [28, 'model'],
  [5, 'bodyType'],
  [24, 'fuelType'],
  [15, 'driveType'],
  [37, 'transmission'],
  [34, 'series'],
  [18, 'engine'],
  [9, 'engineCylinders'],
  [13, 'displacementL'],
  [31, 'plant'],
]);

const LOOKUP_TABLE_BY_ELEMENT = new Map<number, keyof VpicLookups>([
  [28, 'models'],
  [5, 'bodyStyles'],
  [24, 'fuelTypes'],
  [15, 'driveTypes'],
  [37, 'transmissions'],
]);

export interface SkippedPatternStats {
  totalProfile: number;
  skipped: number;
  byReason: Map<string, number>;
}

export interface SeedBuildMeta {
  skippedPatterns: SkippedPatternStats;
  duplicateSchemaNames: number;
  nullYearToBindings: number;
  wmiSixChar: number;
  totalWmiRows: number;
  skippedInvalidWmis: string[];
}

const VIN_ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXYZ';

function isValidWmiCode(wmi: string): boolean {
  if (wmi.length !== 3 && wmi.length !== 6) {
    return false;
  }
  for (const char of wmi) {
    if (!VIN_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

function resolveSchemaNames(rows: VinSchemaRow[]): { names: Map<number, string>; duplicateCount: number } {
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    nameCounts.set(row.name, (nameCounts.get(row.name) ?? 0) + 1);
  }

  const names = new Map<number, string>();
  let duplicateCount = 0;
  for (const row of rows) {
    const trimmed = row.name.trim();
    const count = nameCounts.get(row.name) ?? 0;
    if (count > 1) {
      duplicateCount += 1;
      names.set(row.id, `${trimmed} [vpic:${String(row.id)}]`);
    } else {
      names.set(row.id, trimmed);
    }
  }
  return { names, duplicateCount };
}

function resolvePatternCode(
  row: PatternRow,
  lookups: VpicLookups,
): string | null {
  const lookupKey = LOOKUP_TABLE_BY_ELEMENT.get(row.elementId);
  if (lookupKey !== undefined) {
    const id = Number.parseInt(row.attributeId, 10);
    if (Number.isNaN(id)) {
      return null;
    }
    const table = lookups[lookupKey];
    const name = table.get(id);
    return name === undefined ? null : trimField(name);
  }
  return trimField(row.attributeId);
}

export function buildSeedClaims(
  wmiRows: WmiTableRow[],
  vinSchemas: VinSchemaRow[],
  wmiVinSchemas: WmiVinSchemaRow[],
  patterns: PatternRow[],
  lookups: VpicLookups,
  wmiIdToCode: Map<number, string>,
  progress?: ProgressFn,
): { claims: Claim[]; meta: SeedBuildMeta } {
  const { names: schemaNames, duplicateCount } = resolveSchemaNames(vinSchemas);

  const validWmiRows = wmiRows.filter((row) => isValidWmiCode(row.wmi));
  const skippedInvalidWmis = wmiRows
    .filter((row) => !isValidWmiCode(row.wmi))
    .map((row) => row.wmi);

  progress?.('Building vds-schema claims');
  const schemaClaims: Claim[] = vinSchemas.map((row) => ({
    schemaVersion: '1.1' as const,
    provenance: PROVENANCE,
    license: 'CC0-1.0' as const,
    type: 'vds-schema' as const,
    key: { name: schemaNames.get(row.id) ?? row.name.trim() },
    value: {},
  }));

  const schemaIdToHash = new Map<number, string>();
  for (let i = 0; i < vinSchemas.length; i += 1) {
    schemaIdToHash.set(vinSchemas[i].id, claimHash(schemaClaims[i]));
  }

  let nullYearToBindings = 0;
  progress?.('Building vds-binding claims');
  const bindingClaims: Claim[] = [];
  for (const row of wmiVinSchemas) {
    const wmi = wmiIdToCode.get(row.wmiId);
    const schemaHash = schemaIdToHash.get(row.vinSchemaId);
    if (wmi === undefined || schemaHash === undefined || !isValidWmiCode(wmi)) {
      continue;
    }
    if (row.yearTo === null) {
      nullYearToBindings += 1;
    }
    bindingClaims.push({
      schemaVersion: '1.1' as const,
      provenance: PROVENANCE,
      license: 'CC0-1.0' as const,
      type: 'vds-binding',
      key: {
        wmi,
        yearFrom: row.yearFrom,
        yearTo: row.yearTo,
        schema: schemaHash,
      },
      value: {},
    });
  }

  const skippedByReason = new Map<string, number>();
  let profileCount = 0;
  let skipped = 0;
  progress?.('Building vds-pattern claims');
  const patternClaims: Claim[] = [];
  const seenPatternHashes = new Set<string>();

  for (const row of patterns) {
    profileCount += 1;

    const attribute = PROFILE_ELEMENT_MAP.get(row.elementId);
    const schemaHash = schemaIdToHash.get(row.vinSchemaId);
    if (attribute === undefined || schemaHash === undefined) {
      skipped += 1;
      skippedByReason.set('missing-schema', (skippedByReason.get('missing-schema') ?? 0) + 1);
      continue;
    }

    const matchResult = keysToMatch(row.keys);
    if (!matchResult.ok) {
      skipped += 1;
      skippedByReason.set(
        matchResult.reason,
        (skippedByReason.get(matchResult.reason) ?? 0) + 1,
      );
      continue;
    }

    const code = resolvePatternCode(row, lookups);
    if (code === null) {
      skipped += 1;
      skippedByReason.set('unresolved-code', (skippedByReason.get('unresolved-code') ?? 0) + 1);
      continue;
    }

    const claim: Claim = {
      schemaVersion: '1.1' as const,
      provenance: PROVENANCE,
      license: 'CC0-1.0' as const,
      type: 'vds-pattern',
      key: {
        schema: schemaHash,
        match: matchResult.claimMatch,
      },
      value: { attribute, code },
    };

    const hash = claimHash(claim);
    if (seenPatternHashes.has(hash)) {
      skipped += 1;
      skippedByReason.set(
        'dedupe-after-sanitize',
        (skippedByReason.get('dedupe-after-sanitize') ?? 0) + 1,
      );
      continue;
    }
    seenPatternHashes.add(hash);
    patternClaims.push(claim);
  }

  const wmiSixChar = validWmiRows.filter((row) => row.wmi.length === 6).length;
  progress?.('Building wmi claims');
  const wmiClaims: Claim[] = validWmiRows.map((row) => ({
    schemaVersion: '1.0' as const,
    provenance: PROVENANCE,
    license: 'CC0-1.0' as const,
    type: 'wmi',
    key: { wmi: row.wmi },
    value: {
      manufacturer: row.manufacturer.trim(),
      country: row.country === null ? null : row.country.trim(),
      vehicleType: row.vehicleType === null ? null : row.vehicleType.trim(),
      region: deriveWmiRegion(row.wmi),
    },
  }));

  const claims = [...schemaClaims, ...bindingClaims, ...patternClaims, ...wmiClaims];

  return {
    claims,
    meta: {
      skippedPatterns: {
        totalProfile: profileCount,
        skipped,
        byReason: skippedByReason,
      },
      duplicateSchemaNames: duplicateCount,
      nullYearToBindings,
      wmiSixChar,
      totalWmiRows: wmiRows.length,
      skippedInvalidWmis,
    },
  };
}

export function countClaimsByType(claims: readonly Claim[]): Record<string, number> {
  const counts: Record<string, number> = {
    wmi: 0,
    'vds-schema': 0,
    'vds-binding': 0,
    'vds-pattern': 0,
  };
  for (const claim of claims) {
    counts[claim.type] = (counts[claim.type] ?? 0) + 1;
  }
  return counts;
}

export function assertSeedCounts(
  counts: Record<string, number>,
  meta: SeedBuildMeta,
): void {
  const skipPct =
    meta.skippedPatterns.totalProfile === 0
      ? 0
      : (meta.skippedPatterns.skipped / meta.skippedPatterns.totalProfile) * 100;
  if (skipPct > 2) {
    const breakdown = [...meta.skippedPatterns.byReason.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, n]) => `${reason}: ${String(n)}`)
      .join(', ');
    throw new Error(
      `STOP: skipped ${String(meta.skippedPatterns.skipped)} profile patterns (${skipPct.toFixed(2)}% > 2%): ${breakdown}`,
    );
  }

  const invalidWmiPct =
    meta.totalWmiRows === 0 ? 0 : (meta.skippedInvalidWmis.length / meta.totalWmiRows) * 100;
  if (invalidWmiPct > 1) {
    throw new Error(
      `STOP: skipped ${String(meta.skippedInvalidWmis.length)} invalid WMIs (${invalidWmiPct.toFixed(2)}% > 1%)`,
    );
  }

  const minimums: Record<string, number> = {
    wmi: 12_000,
    'vds-schema': 24_000,
    'vds-binding': 40_000,
    'vds-pattern': 500_000,
  };

  for (const [type, min] of Object.entries(minimums)) {
    const actual = counts[type] ?? 0;
    if (actual < min) {
      throw new Error(
        `STOP: implausibly low ${type} count ${String(actual)} (expected >= ${String(min)})`,
      );
    }
  }
}

/** @deprecated Use buildSeedClaims — genesis seed claims are unsigned; manifest attestation in phase A. */
export const buildSignedSeedClaims = buildSeedClaims;

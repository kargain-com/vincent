import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitJsonl, sortClaimsForJsonl } from '@kargain/vincent-compiler';
import { parseClaim } from '@kargain/vincent/protocol';

import { progress } from './generate-wmi-internals.js';
import { prepareSource, SEED_JSONL_PATH, sha256Buffer } from './vpic/source.js';
import { parseAllLookups } from './vpic/parse-lookups.js';
import { buildWmiIdMap, parseWmiTable } from './vpic/parse-wmi.js';
import {
  parseProfilePatternRows,
  parseVinSchemaRows,
  parseWmiVinSchemaRows,
} from './vpic/parse-vds.js';
import {
  assertSeedCounts,
  buildSeedClaims,
  countClaimsByType,
} from './seed/build-claims.js';

export interface GenerateSeedOptions {
  skipDownload?: boolean;
  outputPath?: string;
}

export interface GenerateSeedReport {
  outputPath: string;
  bytes: number;
  sha256: string;
  counts: Record<string, number>;
  skippedPatterns: {
    totalProfile: number;
    skipped: number;
    skipPct: number;
    byReason: Record<string, number>;
  };
  duplicateSchemaNames: number;
  nullYearToBindings: number;
  wmiSixChar: number;
  totalWmiRows: number;
  skippedInvalidWmis: string[];
  invalidWmiPct: number;
}

export async function generateSeed(
  options: GenerateSeedOptions = {},
): Promise<GenerateSeedReport> {
  await prepareSource(progress, options.skipDownload ?? false);

  progress('Parsing lookup tables');
  const lookups = await parseAllLookups(undefined, progress);

  progress('Parsing WMI table');
  const wmiRows = await parseWmiTable(lookups, undefined, progress);
  const wmiIdToCode = buildWmiIdMap(wmiRows);

  progress('Parsing vinschema table');
  const vinSchemas = await parseVinSchemaRows(undefined, progress);

  progress('Parsing wmi_vinschema table');
  const wmiVinSchemas = await parseWmiVinSchemaRows(undefined, progress);

  progress('Parsing profile pattern rows');
  const patterns = await parseProfilePatternRows(undefined, progress);

  progress('Building unsigned content-addressed claims');
  const { claims, meta } = buildSeedClaims(
    wmiRows,
    vinSchemas,
    wmiVinSchemas,
    patterns,
    lookups,
    wmiIdToCode,
    progress,
  );

  const counts = countClaimsByType(claims);
  assertSeedCounts(counts, meta);

  progress('Validating claim well-formedness');
  for (const claim of claims) {
    const validated = parseClaim(claim);
    if (!validated.ok) {
      throw new Error(`Invalid claim (${claim.type}): ${validated.error.message}`);
    }
  }

  const sorted = sortClaimsForJsonl(claims);
  const { jsonl } = emitJsonl(sorted);
  const outputPath = options.outputPath ?? SEED_JSONL_PATH;
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, jsonl, 'utf8');

  const bytes = Buffer.byteLength(jsonl, 'utf8');
  const sha256 = sha256Buffer(jsonl);
  const skipPct =
    meta.skippedPatterns.totalProfile === 0
      ? 0
      : (meta.skippedPatterns.skipped / meta.skippedPatterns.totalProfile) * 100;

  const byReason: Record<string, number> = {};
  for (const [reason, n] of meta.skippedPatterns.byReason.entries()) {
    byReason[reason] = n;
  }

  const invalidWmiPct =
    meta.totalWmiRows === 0 ? 0 : (meta.skippedInvalidWmis.length / meta.totalWmiRows) * 100;

  const report: GenerateSeedReport = {
    outputPath,
    bytes,
    sha256,
    counts,
    skippedPatterns: {
      totalProfile: meta.skippedPatterns.totalProfile,
      skipped: meta.skippedPatterns.skipped,
      skipPct,
      byReason,
    },
    duplicateSchemaNames: meta.duplicateSchemaNames,
    nullYearToBindings: meta.nullYearToBindings,
    wmiSixChar: meta.wmiSixChar,
    totalWmiRows: meta.totalWmiRows,
    skippedInvalidWmis: meta.skippedInvalidWmis,
    invalidWmiPct,
  };

  printReport(report);
  return report;
}

export function printReport(report: GenerateSeedReport): void {
  progress(`Seed written to ${report.outputPath}`);
  progress(`Size: ${String(report.bytes)} bytes (${(report.bytes / 1024 / 1024).toFixed(2)} MB)`);
  progress(`SHA256: ${report.sha256}`);
  progress('Claim counts:');
  for (const type of ['wmi', 'vds-schema', 'vds-binding', 'vds-pattern'] as const) {
    progress(`  ${type}: ${String(report.counts[type] ?? 0)}`);
  }
  progress(
    `Skipped patterns: ${String(report.skippedPatterns.skipped)} / ${String(report.skippedPatterns.totalProfile)} (${report.skippedPatterns.skipPct.toFixed(4)}%)`,
  );
  if (Object.keys(report.skippedPatterns.byReason).length > 0) {
    progress('Skip reasons:');
    for (const [reason, n] of Object.entries(report.skippedPatterns.byReason).sort(
      (a, b) => b[1] - a[1],
    )) {
      progress(`  ${reason}: ${String(n)}`);
    }
  }
  progress(`Duplicate vinschema names disambiguated: ${String(report.duplicateSchemaNames)}`);
  progress(`Bindings with yearTo=null: ${String(report.nullYearToBindings)}`);
  progress(`6-char WMIs: ${String(report.wmiSixChar)}`);
  progress(
    `Invalid WMIs skipped: ${String(report.skippedInvalidWmis.length)} / ${String(report.totalWmiRows)} (${report.invalidWmiPct.toFixed(4)}%)`,
  );
  if (report.skippedInvalidWmis.length > 0) {
    progress(`Skipped invalid WMIs (I/O/Q): ${report.skippedInvalidWmis.join(', ')}`);
  }
}

async function main(): Promise<void> {
  await generateSeed();
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`generate-seed failed: ${message}\n`);
    process.exit(1);
  });
}

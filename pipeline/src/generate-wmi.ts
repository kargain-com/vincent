import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CORE_SIZE_BUDGET_BYTES,
  EXTENDED_SIZE_BUDGET_BYTES,
  OUTPUT_CORE_PATH,
  OUTPUT_EXTENDED_PATH,
  prepareSource,
  progress,
  sha256Buffer,
} from './generate-wmi-internals.js';
import type { WmiRow } from './vpic/parse-wmi.js';
import { parseBaseLookups } from './vpic/parse-lookups.js';
import { parseWmiRows } from './vpic/parse-wmi.js';
import {
  buildPayload,
  emitGeneratedFile,
  type GeneratedModuleReport,
  type GenerateWmiOptions,
  type WmiPayload,
} from './generate-wmi-internals.js';

export type { WmiRow, WmiPayload, GeneratedModuleReport, GenerateWmiOptions };
export { buildPayload, emitGeneratedFile };

export async function generateWmiFiles(
  options: GenerateWmiOptions = {},
): Promise<GeneratedModuleReport[]> {
  const coreOutputPath = options.coreOutputPath ?? OUTPUT_CORE_PATH;
  const extendedOutputPath = options.extendedOutputPath ?? OUTPUT_EXTENDED_PATH;

  const sourceSha256 = await prepareSource(progress, options.skipDownload ?? false);

  progress('Parsing lookup tables');
  const lookups = await parseBaseLookups(undefined, progress);

  progress('Parsing WMI table');
  const rows = await parseWmiRows(lookups, undefined, progress);

  const coreRows = rows.filter((row) => row.wmi.length === 3);
  const extendedRows = rows.filter((row) => row.wmi.length === 6);

  progress(
    `Building payloads: ${String(coreRows.length)} core, ${String(extendedRows.length)} extended`,
  );

  const coreReport = writeModule(
    'core',
    coreRows,
    coreOutputPath,
    sourceSha256,
    CORE_SIZE_BUDGET_BYTES,
  );
  const extendedReport = writeModule(
    'extended',
    extendedRows,
    extendedOutputPath,
    sourceSha256,
    EXTENDED_SIZE_BUDGET_BYTES,
  );

  return [coreReport, extendedReport];
}

function reportSizeBudgetExceeded(
  label: 'core' | 'extended',
  content: string,
  rows: WmiRow[],
  budgetBytes: number,
): never {
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  const byVehicleType = new Map<string, number>();
  for (const row of rows) {
    const key = row.vehicleType ?? '(null)';
    byVehicleType.set(key, (byVehicleType.get(key) ?? 0) + 1);
  }

  const distribution = [...byVehicleType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `  ${type}: ${String(count)}`)
    .join('\n');

  progress(
    `ERROR: ${label} generated file size ${String(sizeBytes)} bytes exceeds ${String(budgetBytes)} byte budget`,
  );
  progress(`Entries: ${String(rows.length)}`);
  progress(`Vehicle type distribution:\n${distribution}`);
  process.exit(1);
}

function writeModule(
  label: 'core' | 'extended',
  rows: WmiRow[],
  outputPath: string,
  sourceSha256: string,
  budgetBytes: number,
): GeneratedModuleReport {
  const keyLength = label === 'core' ? 3 : 6;
  const payload = buildPayload(rows);
  const { content, deflateB64 } = emitGeneratedFile(payload, sourceSha256, label, keyLength);
  const fileBytes = Buffer.byteLength(content, 'utf8');

  if (fileBytes > budgetBytes) {
    reportSizeBudgetExceeded(label, content, rows, budgetBytes);
  }

  writeFileSync(outputPath, content, 'utf8');

  const fileGzipBytes = gzipSync(content).length;
  const deflateBytes = Buffer.byteLength(deflateB64, 'utf8');
  const deflateGzipBytes = gzipSync(deflateB64).length;
  const sha256 = sha256Buffer(content);

  progress(
    `${label}: ${String(rows.length)} entries | file ${String(fileBytes)} B (gzip ${String(fileGzipBytes)} B) | deflate-b64 ${String(deflateBytes)} B (gzip ${String(deflateGzipBytes)} B) | sha256 ${sha256}`,
  );

  return {
    label,
    outputPath,
    entryCount: rows.length,
    fileBytes,
    fileGzipBytes,
    deflateB64Bytes: deflateBytes,
    deflateGzipBytes,
    sha256,
  };
}

async function main(): Promise<void> {
  const reports = await generateWmiFiles();
  for (const report of reports) {
    progress(`Wrote ${report.outputPath}`);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`generate-wmi failed: ${message}\n`);
    process.exit(1);
  });
}

import { deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROVENANCE,
  SOURCE_FILENAME,
  type ProgressFn,
} from './vpic/source.js';
import type { WmiRow } from './vpic/parse-wmi.js';

export const CORE_SIZE_BUDGET_BYTES = 100 * 1024;
export const EXTENDED_SIZE_BUDGET_BYTES = 250 * 1024;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PIPELINE_SRC = __dirname;
const PIPELINE_ROOT = resolve(__dirname, '..');
const VINCENT_SRC = resolve(PIPELINE_ROOT, '../packages/vincent/src');
export const OUTPUT_CORE_PATH = join(VINCENT_SRC, 'wmi-core.generated.ts');
export const OUTPUT_EXTENDED_PATH = join(VINCENT_SRC, 'wmi-extended.generated.ts');

export interface WmiPayload {
  strings: string[];
  keys: string[];
  data: [number, number | null, number | null][];
}

export interface GeneratedModuleReport {
  label: 'core' | 'extended';
  outputPath: string;
  entryCount: number;
  fileBytes: number;
  fileGzipBytes: number;
  deflateB64Bytes: number;
  deflateGzipBytes: number;
  sha256: string;
}

export interface GenerateWmiOptions {
  coreOutputPath?: string;
  extendedOutputPath?: string;
  skipDownload?: boolean;
}

export { prepareSource, sha256Buffer } from './vpic/source.js';

export function progress(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function buildPayload(rows: WmiRow[]): WmiPayload {
  const strings: string[] = [];
  const indices = new Map<string, number>();

  const intern = (value: string): number => {
    const existing = indices.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const idx = strings.length;
    strings.push(value);
    indices.set(value, idx);
    return idx;
  };

  const keys: string[] = [];
  const data: [number, number | null, number | null][] = [];

  for (const row of rows) {
    keys.push(row.wmi);
    data.push([
      intern(row.manufacturer),
      row.country === null ? null : intern(row.country),
      row.vehicleType === null ? null : intern(row.vehicleType),
    ]);
  }

  return { strings, keys, data };
}

export function chunkBase64(base64: string, lineWidth = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += lineWidth) {
    lines.push(base64.slice(i, i + lineWidth));
  }
  return lines.map((line) => `  '${line}'`).join(' +\n');
}

export function emitGeneratedFile(
  payload: WmiPayload,
  sourceSha256: string,
  label: 'core' | 'extended',
  keyLength: 3 | 6,
): { content: string; deflateB64: string } {
  const json = JSON.stringify(payload);
  const deflateB64 = deflateRawSync(json, { level: 9 }).toString('base64');

  const content = `/**
 * @generated — do not edit manually
 * Module: wmi-${label}
 * Source: ${SOURCE_FILENAME}
 * Source sha256: ${sourceSha256}
 * Provenance: ${PROVENANCE}
 * Encoding: raw-deflate-compressed JSON (strings, sorted keys, tuple data)
 * Key length: ${String(keyLength)} characters
 * Column mapping:
 *   vpic.wmi.wmi → WMI key (${String(keyLength)} characters)
 *   vpic.manufacturer.name → manufacturer (via wmi.manufacturerid)
 *   vpic.country.name → country (via wmi.countryid)
 *   vpic.vehicletype.name → vehicleType (via wmi.vehicletypeid)
 */

export const WMI_PROVENANCE = '${PROVENANCE}' as const;

export const WMI_SOURCE = {
  filename: '${SOURCE_FILENAME}',
  sha256: '${sourceSha256}',
} as const;

/** Raw-deflate-compressed JSON payload: { strings, keys, data } */
export const WMI_DEFLATE_B64 =
${chunkBase64(deflateB64)};
`;

  return { content, deflateB64 };
}

export type { ProgressFn };

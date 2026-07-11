import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const SOURCE_URL =
  'https://vpic.nhtsa.dot.gov/downloads/vPICList_lite_2026_06.plain.zip';
const SOURCE_FILENAME = 'vPICList_lite_2026_06.plain.zip';
const EXPECTED_SHA256 =
  'ab16275b0994e79b2d9f0fba512797631a107e2c5e18182b043d97a17ef02ea9';
const PROVENANCE = 'regulatory/us-vpic';
const SIZE_BUDGET_BYTES = 300 * 1024;
const SQL_BASENAME = 'vPICList_lite_2026_06.sql';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = resolve(__dirname, '..');
const CACHE_DIR = join(PIPELINE_ROOT, '.cache');
const ZIP_PATH = join(CACHE_DIR, SOURCE_FILENAME);
const EXTRACT_DIR = join(CACHE_DIR, 'extracted');
const SQL_PATH = join(EXTRACT_DIR, SQL_BASENAME);
const OUTPUT_PATH = resolve(PIPELINE_ROOT, '../packages/vincent/src/wmi.generated.ts');

interface WmiRow {
  wmi: string;
  manufacturer: string;
  country: string | null;
  vehicleType: string | null;
}

interface WmiPayload {
  strings: string[];
  keys: string[];
  data: [number, number | null, number | null][];
}

function sha256File(path: string): string {
  const data = readFileSync(path);
  return createHash('sha256').update(data).digest('hex');
}

function progress(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function ensureSourceZip(): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (existsSync(ZIP_PATH)) {
    const cachedSha = sha256File(ZIP_PATH);
    if (cachedSha === EXPECTED_SHA256) {
      progress(`Using cached zip (sha256: ${cachedSha})`);
      return cachedSha;
    }
    progress(`Cached zip sha256 mismatch (${cachedSha}), re-downloading`);
  }

  progress(`Downloading ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpPath = `${ZIP_PATH}.tmp`;
  writeFileSync(tmpPath, buffer);
  const sha = createHash('sha256').update(buffer).digest('hex');

  if (sha !== EXPECTED_SHA256) {
    throw new Error(
      `Downloaded zip sha256 mismatch: expected ${EXPECTED_SHA256}, got ${sha}`,
    );
  }

  renameSync(tmpPath, ZIP_PATH);
  progress(`Downloaded and verified zip (sha256: ${sha})`);
  return sha;
}

function ensureSqlExtracted(): void {
  if (existsSync(SQL_PATH)) {
    progress(`Using extracted SQL at ${SQL_PATH}`);
    return;
  }

  progress(`Extracting ${SOURCE_FILENAME}`);
  mkdirSync(EXTRACT_DIR, { recursive: true });
  const zip = new AdmZip(ZIP_PATH);
  zip.extractAllTo(EXTRACT_DIR, true);

  if (!existsSync(SQL_PATH)) {
    throw new Error(`Expected SQL file not found after extraction: ${SQL_PATH}`);
  }
}

function parseField(value: string): string | null {
  return value === '\\N' ? null : value;
}

function parseIntField(value: string): number | null {
  const parsed = parseField(value);
  if (parsed === null) {
    return null;
  }
  const num = Number.parseInt(parsed, 10);
  return Number.isNaN(num) ? null : num;
}

async function parseLookupTables(
  sqlPath: string,
): Promise<{
  countries: Map<number, string>;
  manufacturers: Map<number, string>;
  vehicleTypes: Map<number, string>;
}> {
  const countries = new Map<number, string>();
  const manufacturers = new Map<number, string>();
  const vehicleTypes = new Map<number, string>();

  const targets = new Set(['country', 'manufacturer', 'vehicletype']);
  let activeTable: string | null = null;

  const rl = createInterface({
    input: createReadStream(sqlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (activeTable === null) {
      const match = /^COPY vpic\.(\w+) \((.+)\) FROM stdin;$/.exec(line);
      if (!match) {
        continue;
      }
      const table = match[1].toLowerCase();
      if (!targets.has(table)) {
        continue;
      }
      activeTable = table;
      continue;
    }

    if (line === '\\.') {
      activeTable = null;
      continue;
    }

    const fields = line.split('\t');
    if (activeTable === 'country') {
      const id = parseIntField(fields[0]);
      const name = parseField(fields[1]);
      if (id !== null && name !== null) {
        countries.set(id, name);
      }
    } else if (activeTable === 'manufacturer') {
      const id = parseIntField(fields[0]);
      const name = parseField(fields[1]);
      if (id !== null && name !== null) {
        manufacturers.set(id, name);
      }
    } else if (activeTable === 'vehicletype') {
      const id = parseIntField(fields[0]);
      const name = parseField(fields[1]);
      if (id !== null && name !== null) {
        vehicleTypes.set(id, name);
      }
    }
  }

  progress(
    `Parsed lookups: ${countries.size} countries, ${manufacturers.size} manufacturers, ${vehicleTypes.size} vehicle types`,
  );
  return { countries, manufacturers, vehicleTypes };
}

async function parseWmiRows(
  sqlPath: string,
  lookups: {
    countries: Map<number, string>;
    manufacturers: Map<number, string>;
    vehicleTypes: Map<number, string>;
  },
): Promise<WmiRow[]> {
  const rows: WmiRow[] = [];
  let active = false;

  const rl = createInterface({
    input: createReadStream(sqlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!active) {
      if (line === 'COPY vpic.wmi (id, wmi, manufacturerid, makeid, vehicletypeid, createdon, updatedon, countryid, publicavailabilitydate, trucktypeid, processedon, noncompliant, noncompliantsetbyovsc) FROM stdin;') {
        active = true;
      }
      continue;
    }

    if (line === '\\.') {
      break;
    }

    const fields = line.split('\t');
    const wmi = parseField(fields[1]);
    if (wmi === null) {
      continue;
    }

    const manufacturerId = parseIntField(fields[2]);
    const vehicleTypeId = parseIntField(fields[4]);
    const countryId = parseIntField(fields[7]);

    const manufacturer =
      manufacturerId === null ? null : lookups.manufacturers.get(manufacturerId) ?? null;
    if (manufacturer === null) {
      continue;
    }

    const country =
      countryId === null ? null : lookups.countries.get(countryId) ?? null;
    const vehicleType =
      vehicleTypeId === null ? null : lookups.vehicleTypes.get(vehicleTypeId) ?? null;

    rows.push({ wmi, manufacturer, country, vehicleType });
  }

  rows.sort((a, b) => a.wmi.localeCompare(b.wmi));
  progress(`Parsed ${rows.length} WMI entries`);
  return rows;
}

function buildPayload(rows: WmiRow[]): WmiPayload {
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

function chunkBase64(base64: string, lineWidth = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += lineWidth) {
    lines.push(base64.slice(i, i + lineWidth));
  }
  return lines.map((line) => `  '${line}'`).join(' +\n');
}

function emitGeneratedFile(payload: WmiPayload, sourceSha256: string): string {
  const json = JSON.stringify(payload);
  const deflateB64 = deflateRawSync(json, { level: 9 }).toString('base64');

  return `/**
 * @generated — do not edit manually
 * Source: ${SOURCE_FILENAME}
 * Source sha256: ${sourceSha256}
 * Provenance: ${PROVENANCE}
 * Encoding: raw-deflate-compressed JSON (strings, sorted keys, tuple data)
 * Column mapping:
 *   vpic.wmi.wmi → WMI key (3 or 6 characters)
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
}

function reportSizeBudgetExceeded(content: string, rows: WmiRow[]): never {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const threeChar = rows.filter((row) => row.wmi.length === 3).length;
  const sixChar = rows.filter((row) => row.wmi.length === 6).length;

  const byVehicleType = new Map<string, number>();
  for (const row of rows) {
    const key = row.vehicleType ?? '(null)';
    byVehicleType.set(key, (byVehicleType.get(key) ?? 0) + 1);
  }

  const distribution = [...byVehicleType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `  ${type}: ${String(count)}`)
    .join('\n');

  progress(`ERROR: Generated file size ${String(sizeBytes)} bytes exceeds ${String(SIZE_BUDGET_BYTES)} byte budget`);
  progress(`Entries: ${String(rows.length)} total (${String(threeChar)} x 3-char, ${String(sixChar)} x 6-char)`);
  progress(`Vehicle type distribution:\n${distribution}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const sourceSha256 = await ensureSourceZip();
  ensureSqlExtracted();

  progress('Parsing lookup tables');
  const lookups = await parseLookupTables(SQL_PATH);

  progress('Parsing WMI table');
  const rows = await parseWmiRows(SQL_PATH, lookups);

  progress('Building compact payload');
  const payload = buildPayload(rows);

  progress('Emitting generated TypeScript');
  const content = emitGeneratedFile(payload, sourceSha256);
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  if (sizeBytes > SIZE_BUDGET_BYTES) {
    reportSizeBudgetExceeded(content, rows);
  }

  writeFileSync(OUTPUT_PATH, content, 'utf8');
  progress(`Wrote ${OUTPUT_PATH} (${String(sizeBytes)} bytes, ${String(rows.length)} entries)`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`generate-wmi failed: ${message}\n`);
  process.exit(1);
});

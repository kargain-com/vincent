import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

export const SOURCE_URL =
  'https://vpic.nhtsa.dot.gov/downloads/vPICList_lite_2026_06.plain.zip';
export const SOURCE_FILENAME = 'vPICList_lite_2026_06.plain.zip';
export const EXPECTED_SHA256 =
  'ab16275b0994e79b2d9f0fba512797631a107e2c5e18182b043d97a17ef02ea9';
export const PROVENANCE = 'regulatory/us-vpic';
export const SQL_BASENAME = 'vPICList_lite_2026_06.sql';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PIPELINE_ROOT = resolve(__dirname, '../..');
export const CACHE_DIR = join(PIPELINE_ROOT, '.cache');
export const BUILD_DIR = join(PIPELINE_ROOT, '.build');
export const ZIP_PATH = join(CACHE_DIR, SOURCE_FILENAME);
export const EXTRACT_DIR = join(CACHE_DIR, 'extracted');
export const SQL_PATH = join(EXTRACT_DIR, SQL_BASENAME);
export const SEED_JSONL_PATH = join(BUILD_DIR, 'genesis-seed.jsonl');

export function sha256Buffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path: string): string {
  return sha256Buffer(readFileSync(path));
}

export type ProgressFn = (message: string) => void;

export async function ensureSourceZip(progress: ProgressFn): Promise<string> {
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
  const sha = sha256Buffer(buffer);

  if (sha !== EXPECTED_SHA256) {
    throw new Error(
      `Downloaded zip sha256 mismatch: expected ${EXPECTED_SHA256}, got ${sha}`,
    );
  }

  renameSync(tmpPath, ZIP_PATH);
  progress(`Downloaded and verified zip (sha256: ${sha})`);
  return sha;
}

export function ensureSqlExtracted(progress: ProgressFn): void {
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

export function ensureCachedSource(progress: ProgressFn, skipDownload: boolean): string {
  if (skipDownload) {
    if (!existsSync(ZIP_PATH)) {
      throw new Error(`Cached zip not found at ${ZIP_PATH}`);
    }
    const sourceSha256 = sha256File(ZIP_PATH);
    if (sourceSha256 !== EXPECTED_SHA256) {
      throw new Error(
        `Cached zip sha256 mismatch: expected ${EXPECTED_SHA256}, got ${sourceSha256}`,
      );
    }
    ensureSqlExtracted(progress);
    return sourceSha256;
  }

  throw new Error('ensureCachedSource requires skipDownload; use prepareSource for downloads');
}

export async function prepareSource(
  progress: ProgressFn,
  skipDownload: boolean,
): Promise<string> {
  if (skipDownload) {
    return ensureCachedSource(progress, true);
  }
  const sourceSha256 = await ensureSourceZip(progress);
  ensureSqlExtracted(progress);
  return sourceSha256;
}

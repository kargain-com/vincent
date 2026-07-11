import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CompileStageTimingMs, EpochBuild } from '@kargain/vincent-compiler';
import { buildMerkle, LEAF_CAP_BYTES } from '@kargain/vincent-compiler';
import type { Decoder } from '@kargain/vincent/decoder';
import type { Claim } from '@kargain/vincent/protocol';
import { parseClaim } from '@kargain/vincent/protocol';

import { generateSeed, type GenerateSeedReport } from './generate-seed.js';
import { progress } from './generate-wmi-internals.js';
import { buildSeedDecoder, loadSeedClaims } from './seed/load-seed.js';
import {
  buildFailureDiag,
  printSelfConsistencyFailureReport,
  type SelfConsistencyFailureDiag,
} from './seed/self-consistency-diagnose.js';
import { synthesizeVin, deterministicSampleIndices } from './seed/synthesize-vin.js';
import { EXPECTED_SHA256, SEED_JSONL_PATH } from './vpic/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = join(__dirname, '../fixtures/seed-vins/cases.json');

export interface SeedVinCase {
  vin: string;
  year?: number;
  note?: string;
  expected: {
    manufacturer: string;
    model?: string;
    bodyType?: string;
    fuelType?: string;
  };
}

export interface ValidationReport {
  timing: {
    loadMs: number;
    compileMs: number;
    compileStageMs: CompileStageTimingMs;
    fixtureDecodeMs: number;
    selfConsistencyMs: number;
    totalMs: number;
    wallClockMs?: number;
  };
  sizes: {
    jsonlBytes: number;
    merkleRoot: string;
    treeDepth: number;
    leafCount: number;
    leafCapBytes: number;
    partitionedWmiCount: number;
    maxLeafBytes: number;
    totalLeafBytes: number;
    leafSizeBytes: { median: number; p90: number; p99: number; max: number };
    proofSizeBytes: { median: number; p90: number; p99: number; max: number };
    largestLeafBytes: number;
    largestLeafWmi: string;
  };
  claimCounts: Record<string, number>;
  seedGeneration?: GenerateSeedReport;
  fixtureResults: Array<{
    vin: string;
    pass: boolean;
    expected: SeedVinCase['expected'];
    decoded: Record<string, string | null | undefined>;
    errors: string[];
  }>;
  selfConsistency: {
    sampled: number;
    passed: number;
    passRate: number;
  };
}

export interface ValidateSeedCliOptions {
  seedPath?: string;
  regen?: boolean;
  determinism?: boolean;
  diagnoseSelfConsistency?: boolean;
}

export function loadFixtureCases(): SeedVinCase[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as SeedVinCase[];
}

export function parseValidateSeedArgs(argv: readonly string[]): ValidateSeedCliOptions {
  const options: ValidateSeedCliOptions = {};
  for (const arg of argv) {
    if (arg === '--determinism') {
      options.determinism = true;
    } else if (arg === '--regen') {
      options.regen = true;
    } else if (arg === '--diagnose-self-consistency') {
      options.diagnoseSelfConsistency = true;
    } else if (!arg.startsWith('--')) {
      options.seedPath = arg;
    }
  }
  return options;
}

function parseCompiledClaims(jsonl: string): Claim[] {
  const claims: Claim[] = [];
  for (const line of jsonl.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    const parsed = parseClaim(JSON.parse(line) as unknown);
    if (!parsed.ok) {
      throw new Error(`invalid compiled claim: ${parsed.error.message}`);
    }
    claims.push(parsed.value);
  }
  return claims;
}

function selfConsistencyPass(
  attr: { value: string | null; ambiguous: boolean; candidates?: Array<{ value: string }> } | undefined,
  expectedCode: string,
): boolean {
  if (attr === undefined) {
    return false;
  }
  if (attr.value === expectedCode && !attr.ambiguous) {
    return true;
  }
  if (attr.ambiguous && attr.candidates?.some((c) => c.value === expectedCode)) {
    return true;
  }
  return false;
}
function getAttribute(
  attributes: Array<{ attribute: string; value: string | null }>,
  name: string,
): string | null {
  return attributes.find((attr) => attr.attribute === name)?.value ?? null;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function distribution(values: number[]): { median: number; p90: number; p99: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

function computeSizes(epoch: EpochBuild): ValidationReport['sizes'] {
  const leafSizes: number[] = [];
  const proofSizes: number[] = [];
  let totalLeafBytes = 0;
  let largestLeafBytes = 0;
  let largestLeafWmi = '';
  let partitionedWmiCount = 0;

  const ordered = [...epoch.leaves.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [leafKey, entry] of ordered) {
    const leafBytes = Buffer.byteLength(entry.leaf, 'utf8');
    // Proof size = JSON byte length of the proof array (siblings + sides).
    const proofBytes = Buffer.byteLength(JSON.stringify(entry.proof), 'utf8');
    leafSizes.push(leafBytes);
    proofSizes.push(proofBytes);
    totalLeafBytes += leafBytes;
    if (leafBytes > largestLeafBytes) {
      largestLeafBytes = leafBytes;
      largestLeafWmi = leafKey;
    }
    try {
      const parsed = JSON.parse(entry.leaf) as { partitioned?: boolean; wmi?: string };
      if (parsed.partitioned === true && typeof parsed.wmi === 'string') {
        partitionedWmiCount += 1;
      }
    } catch {
      // ignore non-JSON leaves
    }
  }

  const digests = ordered.map(([, entry]) => entry.leafHash);
  const { depth: treeDepth } = buildMerkle(digests);

  return {
    jsonlBytes: Buffer.byteLength(epoch.jsonl, 'utf8'),
    merkleRoot: epoch.merkleRoot,
    treeDepth,
    leafCount: epoch.leaves.size,
    leafCapBytes: LEAF_CAP_BYTES,
    partitionedWmiCount,
    maxLeafBytes: largestLeafBytes,
    totalLeafBytes,
    leafSizeBytes: distribution(leafSizes),
    proofSizeBytes: distribution(proofSizes),
    largestLeafBytes,
    largestLeafWmi,
  };
}

function formatField(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return value;
}

export async function validateSeed(
  seedPath: string = SEED_JSONL_PATH,
  options: { diagnoseSelfConsistency?: boolean } = {},
): Promise<ValidationReport> {
  progress('=== validate:seed ===');
  const totalStart = performance.now();

  progress('Stage: load');
  const loadStart = performance.now();
  const claims = await loadSeedClaims(seedPath);
  const loadMs = performance.now() - loadStart;

  progress('Stage: compile');
  const compileStart = performance.now();
  const { decoder, epoch } = buildSeedDecoder(claims);
  const compileMs = performance.now() - compileStart;

  const sizes = computeSizes(epoch);
  const claimCounts: Record<string, number> = { ...epoch.byType };

  progress('Stage: fixture decode');
  const fixtureStart = performance.now();
  const cases = loadFixtureCases();
  const fixtureResults = await Promise.all(
    cases.map(async (testCase) => {
      const result = await decoder.decode(
        testCase.vin,
        testCase.year === undefined ? {} : { year: testCase.year },
      );
      const decoded = {
        manufacturer: result.wmi?.manufacturer ?? null,
        model: getAttribute(result.attributes, 'model'),
        bodyType: getAttribute(result.attributes, 'bodyType'),
        fuelType: getAttribute(result.attributes, 'fuelType'),
      };

      const errors: string[] = [];
      if (decoded.manufacturer !== testCase.expected.manufacturer) {
        errors.push(
          `manufacturer: expected ${testCase.expected.manufacturer}, got ${String(decoded.manufacturer)}`,
        );
      }
      for (const field of ['model', 'bodyType', 'fuelType'] as const) {
        const expected = testCase.expected[field];
        if (expected !== undefined && decoded[field] !== expected) {
          errors.push(`${field}: expected ${expected}, got ${String(decoded[field])}`);
        }
      }

      return {
        vin: testCase.vin,
        pass: errors.length === 0,
        expected: testCase.expected,
        decoded,
        errors,
      };
    }),
  );
  const fixtureDecodeMs = performance.now() - fixtureStart;

  progress('Stage: self-consistency');
  const selfStart = performance.now();
  const selfConsistency = await runSelfConsistency(parseCompiledClaims(epoch.jsonl), decoder, {
    diagnoseFailures: options.diagnoseSelfConsistency ?? false,
  });
  const selfConsistencyMs = performance.now() - selfStart;

  return {
    timing: {
      loadMs,
      compileMs,
      compileStageMs: epoch.stageTimingMs,
      fixtureDecodeMs,
      selfConsistencyMs,
      totalMs: performance.now() - totalStart,
    },
    sizes,
    claimCounts,
    fixtureResults,
    selfConsistency,
  };
}

async function runSelfConsistency(
  claims: readonly Claim[],
  decoder: Decoder,
  options: { diagnoseFailures?: boolean } = {},
): Promise<ValidationReport['selfConsistency']> {
  const patternClaims = claims.filter((c) => c.type === 'vds-pattern');
  const bindingClaims = claims.filter((c) => c.type === 'vds-binding');

  const bindingsBySchema = new Map<string, typeof bindingClaims>();
  for (const binding of bindingClaims) {
    if (binding.type !== 'vds-binding') {
      continue;
    }
    const list = bindingsBySchema.get(binding.key.schema) ?? [];
    list.push(binding);
    bindingsBySchema.set(binding.key.schema, list);
  }

  const resolvable: Array<{
    pattern: Extract<Claim, { type: 'vds-pattern' }>;
    binding: Extract<Claim, { type: 'vds-binding' }>;
  }> = [];

  for (const pattern of patternClaims) {
    if (pattern.type !== 'vds-pattern') {
      continue;
    }
    const bindings = bindingsBySchema.get(pattern.key.schema);
    if (bindings === undefined || bindings.length === 0) {
      continue;
    }
    for (const binding of bindings) {
      if (binding.type !== 'vds-binding') {
        continue;
      }
      resolvable.push({ pattern, binding });
    }
  }

  const sampleSize = 200;
  const indices = deterministicSampleIndices(resolvable.length, sampleSize, EXPECTED_SHA256);
  let passed = 0;
  const failures: SelfConsistencyFailureDiag[] = [];

  for (const idx of indices) {
    const { pattern, binding } = resolvable[idx];
    let vin: string;
    try {
      vin = synthesizeVin(binding.key.wmi, pattern.key.match);
    } catch {
      continue;
    }

    const decodeYear = binding.key.yearTo ?? binding.key.yearFrom;
    const result = await decoder.decode(vin, { year: decodeYear });
    const attr = result.attributes.find((a) => a.attribute === pattern.value.attribute);
    if (selfConsistencyPass(attr, pattern.value.code)) {
      passed += 1;
    } else if (options.diagnoseFailures) {
      failures.push(buildFailureDiag(idx, pattern, binding, vin, result));
    }
  }

  if (options.diagnoseFailures && failures.length > 0) {
    printSelfConsistencyFailureReport(failures);
  }

  return {
    sampled: indices.length,
    passed,
    passRate: indices.length === 0 ? 0 : passed / indices.length,
  };
}

export interface SeedDeterminismReport {
  firstSha256: string;
  secondSha256: string;
}

export async function checkSeedGeneratorDeterminism(): Promise<SeedDeterminismReport> {
  progress('Checking full-seed generator determinism (two runs)...');

  const runOnce = async (): Promise<string> => {
    const tempDir = mkdtempSync(join(tmpdir(), 'vincent-seed-determinism-'));
    const outputPath = join(tempDir, 'genesis-seed.jsonl');
    try {
      const report = await generateSeed({
        skipDownload: true,
        outputPath,
      });
      return report.sha256;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  const firstSha256 = await runOnce();
  const secondSha256 = await runOnce();

  if (firstSha256 !== secondSha256) {
    throw new Error(
      `Seed generator determinism failed: ${firstSha256} !== ${secondSha256}`,
    );
  }

  return { firstSha256, secondSha256 };
}

export async function runDeterminismCheck(): Promise<SeedDeterminismReport> {
  const report = await checkSeedGeneratorDeterminism();
  printSeedDeterminismReport(report);
  return report;
}

export function printSeedDeterminismReport(report: SeedDeterminismReport): void {
  progress('Seed generator determinism:');
  progress(`  run 1 SHA256: ${report.firstSha256}`);
  progress(`  run 2 SHA256: ${report.secondSha256}`);
  progress('  status: OK (byte-identical)');
}

export async function ensureSeed(
  seedPath: string,
  regen: boolean,
): Promise<GenerateSeedReport | undefined> {
  if (regen) {
    progress(`Regenerating seed at ${seedPath}...`);
    return generateSeed({ skipDownload: true, outputPath: seedPath });
  }

  if (!existsSync(seedPath)) {
    progress(`Seed not found at ${seedPath}; generating...`);
    return generateSeed({ skipDownload: true, outputPath: seedPath });
  }

  progress(`Using existing seed at ${seedPath}`);
  return undefined;
}

function printSeedGenerationStats(seedGeneration: GenerateSeedReport | undefined): void {
  if (seedGeneration === undefined) {
    progress(
      'Skip stats: (unavailable — run --regen or pnpm generate:seed to refresh)',
    );
    return;
  }

  progress(`Seed SHA256: ${seedGeneration.sha256}`);
  progress(
    `Skipped patterns: ${String(seedGeneration.skippedPatterns.skipped)} / ${String(seedGeneration.skippedPatterns.totalProfile)} (${seedGeneration.skippedPatterns.skipPct.toFixed(4)}%)`,
  );
  if (Object.keys(seedGeneration.skippedPatterns.byReason).length > 0) {
    progress('Skip reasons:');
    for (const [reason, count] of Object.entries(seedGeneration.skippedPatterns.byReason).sort(
      (a, b) => b[1] - a[1],
    )) {
      progress(`  ${reason}: ${String(count)}`);
    }
  }
}

export function printValidationReport(report: ValidationReport): void {
  progress('Timing (ms):');
  progress(`  load: ${report.timing.loadMs.toFixed(0)}`);
  progress(`  compile: ${report.timing.compileMs.toFixed(0)}`);
  progress('  compile stages:');
  progress(`    prepare: ${report.timing.compileStageMs.prepare.toFixed(0)}`);
  progress(`    anchor: ${report.timing.compileStageMs.anchor.toFixed(0)}`);
  progress(`    supersession: ${report.timing.compileStageMs.supersession.toFixed(0)}`);
  progress(`    conflict: ${report.timing.compileStageMs.conflict.toFixed(0)}`);
  progress(`    sort: ${report.timing.compileStageMs.sort.toFixed(0)}`);
  progress(`    jsonl: ${report.timing.compileStageMs.jsonl.toFixed(0)}`);
  progress(`    leaves: ${report.timing.compileStageMs.leaves.toFixed(0)}`);
  progress(`    merkle: ${report.timing.compileStageMs.merkle.toFixed(0)}`);
  progress(`  fixture decode: ${report.timing.fixtureDecodeMs.toFixed(0)}`);
  progress(`  self-consistency: ${report.timing.selfConsistencyMs.toFixed(0)}`);
  progress(`  total: ${report.timing.totalMs.toFixed(0)}`);
  if (report.timing.wallClockMs !== undefined) {
    progress(`  wall-clock: ${(report.timing.wallClockMs / 1000).toFixed(1)}s`);
  }

  progress('Claim counts (compiled):');
  for (const type of ['wmi', 'vds-schema', 'vds-binding', 'vds-pattern'] as const) {
    progress(`  ${type}: ${String(report.claimCounts[type] ?? 0)}`);
  }

  printSeedGenerationStats(report.seedGeneration);

  progress('Dataset sizes:');
  progress(`  jsonl: ${(report.sizes.jsonlBytes / 1024 / 1024).toFixed(2)} MB`);
  progress(`  merkleRoot: ${report.sizes.merkleRoot}`);
  progress(`  tree depth: ${String(report.sizes.treeDepth)}`);
  progress(
    `  leaves: ${String(report.sizes.leafCount)} (${(report.sizes.totalLeafBytes / 1024 / 1024).toFixed(2)} MB total)`,
  );
  progress(`  LEAF_CAP: ${String(report.sizes.leafCapBytes)} bytes (${(report.sizes.leafCapBytes / 1024).toFixed(0)} KB)`);
  progress(`  partitioned WMIs: ${String(report.sizes.partitionedWmiCount)}`);
  progress(`  max leaf: ${String(report.sizes.maxLeafBytes)} bytes (${(report.sizes.maxLeafBytes / 1024).toFixed(1)} KB)`);
  progress(
    `  leaf size bytes: median=${String(report.sizes.leafSizeBytes.median)}` +
      ` p90=${String(report.sizes.leafSizeBytes.p90)}` +
      ` p99=${String(report.sizes.leafSizeBytes.p99)}` +
      ` max=${String(report.sizes.leafSizeBytes.max)}`,
  );
  progress(
    `  proof size bytes (JSON): median=${String(report.sizes.proofSizeBytes.median)}` +
      ` p90=${String(report.sizes.proofSizeBytes.p90)}` +
      ` p99=${String(report.sizes.proofSizeBytes.p99)}` +
      ` max=${String(report.sizes.proofSizeBytes.max)}`,
  );
  progress(
    `  largest leaf: WMI ${report.sizes.largestLeafWmi} (${(report.sizes.largestLeafBytes / 1024).toFixed(1)} KB)`,
  );

  progress('Fixture VIN decode table:');
  for (const result of report.fixtureResults) {
    const status = result.pass ? 'PASS' : 'FAIL';
    progress(`  [${status}] ${result.vin}`);
    progress(
      `    expected: manufacturer=${result.expected.manufacturer}` +
        ` model=${formatField(result.expected.model)}` +
        ` bodyType=${formatField(result.expected.bodyType)}` +
        ` fuelType=${formatField(result.expected.fuelType)}`,
    );
    progress(
      `    decoded:  manufacturer=${formatField(result.decoded.manufacturer)}` +
        ` model=${formatField(result.decoded.model)}` +
        ` bodyType=${formatField(result.decoded.bodyType)}` +
        ` fuelType=${formatField(result.decoded.fuelType)}`,
    );
    if (!result.pass) {
      for (const err of result.errors) {
        progress(`    ${err}`);
      }
    }
  }

  const failed = report.fixtureResults.filter((r) => !r.pass).length;
  progress(
    `Fixtures: ${String(report.fixtureResults.length - failed)}/${String(report.fixtureResults.length)} passed`,
  );
  progress(
    `Self-consistency: ${String(report.selfConsistency.passed)}/${String(report.selfConsistency.sampled)} (${(report.selfConsistency.passRate * 100).toFixed(1)}%)`,
  );
}

export async function validateSeedCli(
  options: ValidateSeedCliOptions = {},
): Promise<ValidationReport | SeedDeterminismReport> {
  if (options.determinism) {
    return runDeterminismCheck();
  }

  const wallClockStart = performance.now();
  const path = options.seedPath ?? SEED_JSONL_PATH;
  const seedGeneration = await ensureSeed(path, options.regen ?? false);

  const report = await validateSeed(path, {
    diagnoseSelfConsistency: options.diagnoseSelfConsistency ?? false,
  });
  report.seedGeneration = seedGeneration;
  report.timing.wallClockMs = performance.now() - wallClockStart;

  printValidationReport(report);

  const failedFixtures = report.fixtureResults.filter((r) => !r.pass).length;
  if (failedFixtures > 0) {
    throw new Error(`${String(failedFixtures)} fixture VIN(s) failed validation`);
  }

  if (report.selfConsistency.passRate < 0.95) {
    throw new Error(
      `Self-consistency pass rate ${(report.selfConsistency.passRate * 100).toFixed(1)}% below 95% threshold`,
    );
  }

  if (report.sizes.maxLeafBytes > report.sizes.leafCapBytes) {
    throw new Error(
      `Max leaf size ${String(report.sizes.maxLeafBytes)} exceeds LEAF_CAP ${String(report.sizes.leafCapBytes)}`,
    );
  }

  return report;
}

async function main(): Promise<void> {
  const options = parseValidateSeedArgs(process.argv.slice(2));
  await validateSeedCli(options);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`validate-seed failed: ${message}\n`);
    process.exit(1);
  });
}

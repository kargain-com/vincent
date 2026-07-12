import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../pipeline/fixtures/seed-vins/cases.json',
);

export function loadSeedFixtureCases(): SeedVinCase[] {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as SeedVinCase[];
}

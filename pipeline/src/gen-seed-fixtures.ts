import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { progress } from './generate-wmi-internals.js';
import { buildSeedDecoder, loadSeedClaims } from './seed/load-seed.js';
import { FIXTURE_PATH } from './validate-seed.js';
import { SEED_JSONL_PATH } from './vpic/source.js';
import { withValidCheckDigit } from './seed/synthesize-vin.js';

const CANDIDATE_TEMPLATES: Array<{ template17: string; year?: number; note?: string }> = [
  { template17: '1FAHP3F20CL123456', year: 2012, note: 'US Ford Fusion' },
  { template17: '1G1YY22G965123456', year: 2006, note: 'US GM Chevrolet Corvette' },
  { template17: '1HGCM82633A123456', year: 2003, note: 'US Honda Accord' },
  { template17: 'JT2BF28K0X0123456', year: 1999, note: 'JP Toyota' },
  { template17: 'VF3ABC12345678901', note: 'EU Peugeot' },
  { template17: 'JHMFA16508S123456', year: 2008, note: 'JP Honda' },
  { template17: 'KMHXX00XXXX000000', year: 2015, note: 'KR Hyundai' },
  { template17: 'WBA3A5C50CF123456', year: 2012, note: 'DE BMW' },
  { template17: 'SALSH2E41AA123456', year: 2010, note: 'GB Land Rover' },
  { template17: '5YJSA1E11HF123456', year: 2017, note: 'US Tesla' },
  { template17: 'WAUZZZ8V5EA123456', year: 2014, note: 'DE Audi' },
  { template17: 'ZFF67NFA000123456', year: 2010, note: 'IT Ferrari' },
  { template17: 'YV1RS592941234567', year: 2004, note: 'SE Volvo' },
  { template17: '1N4AL3AP8DC123456', year: 2013, note: 'US Nissan Altima' },
  { template17: '2T1BURHE0FC123456', year: 2015, note: 'CA Toyota' },
  { template17: '3VWDX7AJ5DM123456', year: 2013, note: 'MX Volkswagen' },
  { template17: '4T1BF1FK5EU123456', year: 2014, note: 'US Toyota Camry ambiguous year candidate' },
  { template17: '1FTFW1ET5DFC12345', year: 2013, note: 'US Ford truck' },
  { template17: '1C4RJFBG0FC123456', year: 2015, note: 'US Jeep' },
  { template17: '1GKS2JKJ3FR123456', year: 2015, note: 'US GMC Yukon 6-char WMI region' },
];

async function main(): Promise<void> {
  if (!existsSync(SEED_JSONL_PATH)) {
    throw new Error(`Seed not found at ${SEED_JSONL_PATH}; run generate:seed first`);
  }

  const claims = await loadSeedClaims(SEED_JSONL_PATH);
  const { decoder } = buildSeedDecoder(claims);
  const cases = [];

  for (const candidate of CANDIDATE_TEMPLATES) {
    const vin = withValidCheckDigit(candidate.template17.slice(0, 17).padEnd(17, '0').slice(0, 17));
    const result = await decoder.decode(
      vin,
      candidate.year === undefined ? {} : { year: candidate.year },
    );
    const manufacturer = result.wmi?.manufacturer;
    const model = result.attributes.find((a) => a.attribute === 'model')?.value;
    const bodyType = result.attributes.find((a) => a.attribute === 'bodyType')?.value;
    const fuelType = result.attributes.find((a) => a.attribute === 'fuelType')?.value;

    if (manufacturer === undefined) {
      progress(`Skip ${vin}: no WMI`);
      continue;
    }

    cases.push({
      vin,
      ...(candidate.year === undefined ? {} : { year: candidate.year }),
      ...(candidate.note === undefined ? {} : { note: candidate.note }),
      expected: {
        manufacturer,
        ...(model === undefined ? {} : { model }),
        ...(bodyType === undefined ? {} : { bodyType }),
        ...(fuelType === undefined ? {} : { fuelType }),
      },
    });
  }

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(cases, null, 2)}\n`);

  progress(`Wrote ${String(cases.length)} fixture cases to ${FIXTURE_PATH}`);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`gen-fixtures failed: ${message}\n`);
    process.exit(1);
  });
}

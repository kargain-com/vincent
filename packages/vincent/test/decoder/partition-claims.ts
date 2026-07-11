import type { Claim } from '@kargain/vincent/protocol';

import { loadGenesisMiniClaims } from './helpers.js';

const PROVENANCE = 'regulatory/us-vpic' as const;
const LICENSE = 'CC0-1.0' as const;

function schemaRef(index: number): string {
  const hex = index.toString(16).padStart(64, '0');
  return `sha256:${hex}`;
}

/** Extend genesis 1FA with future-year schemas so partitioning splits heavy data away from genesis years. */
export function buildPartitioned1FaClaims(patternsPerSchema: number, futureYears: number): Claim[] {
  const claims = loadGenesisMiniClaims();
  const startYear = 2020;

  for (let offset = 0; offset < futureYears; offset++) {
    const schemaIndex = offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-schema',
      key: { name: `1FA partition schema ${String(schemaIndex)}` },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    const year = startYear + offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-binding',
      key: {
        wmi: '1FA',
        yearFrom: year,
        yearTo: year,
        schema: schemaRef(schemaIndex),
      },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    for (let patternIndex = 0; patternIndex < patternsPerSchema; patternIndex++) {
      const suffix = patternIndex.toString(16).padStart(2, '0').toUpperCase();
      claims.push({
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: {
          schema: schemaRef(schemaIndex),
          match: { vds: `**${suffix}` },
        },
        value: {
          attribute: 'model',
          code: `Future-${String(year)}-${String(patternIndex).padStart(3, '0')}`,
        },
        provenance: PROVENANCE,
        license: LICENSE,
      });
    }
  }

  return claims;
}

/** Synthetic WMI claims for low-level partition tests (requires bundled WMI table entry to decode). */
export function buildOversizedWmiClaims(wmi: string, patternsPerSchema: number, yearCount: number): Claim[] {
  const startYear = 2000;
  const claims: Claim[] = [
    {
      schemaVersion: '1.0',
      type: 'wmi',
      key: { wmi },
      value: {
        manufacturer: 'Partition Test Motors',
        country: 'US',
        vehicleType: 'Passenger Car',
        region: 'NA',
      },
      provenance: PROVENANCE,
      license: LICENSE,
    },
  ];

  for (let offset = 0; offset < yearCount; offset++) {
    const schemaIndex = offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-schema',
      key: { name: `partition schema ${wmi}-${String(schemaIndex)}` },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    const year = startYear + offset;
    claims.push({
      schemaVersion: '1.1',
      type: 'vds-binding',
      key: {
        wmi,
        yearFrom: year,
        yearTo: year,
        schema: schemaRef(schemaIndex),
      },
      value: {},
      provenance: PROVENANCE,
      license: LICENSE,
    });

    for (let patternIndex = 0; patternIndex < patternsPerSchema; patternIndex++) {
      const suffix = patternIndex.toString(16).padStart(2, '0').toUpperCase();
      claims.push({
        schemaVersion: '1.1',
        type: 'vds-pattern',
        key: {
          schema: schemaRef(schemaIndex),
          match: { vds: `**${suffix}` },
        },
        value: {
          attribute: 'model',
          code: `Y${String(year)}-M${String(patternIndex).padStart(3, '0')}`,
        },
        provenance: PROVENANCE,
        license: LICENSE,
      });
    }
  }

  return claims;
}

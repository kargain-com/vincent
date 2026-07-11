import { claimHash } from '@kargain/vincent/protocol';
import { describe, expect, it } from 'vitest';

import { compile } from '../src/compile.js';

describe('compile scale', () => {
  it(
    'compiles 50k unsigned vds-schema fact cores without per-claim verification',
    () => {
      const claims = Array.from({ length: 50_000 }, (_, i) => ({
        schemaVersion: '1.1' as const,
        type: 'vds-schema' as const,
        key: { name: `scale-schema-${String(i)}` },
        value: {},
        provenance: 'regulatory/us-vpic' as const,
        license: 'CC0-1.0' as const,
      }));

      const start = performance.now();
      const result = compile(claims, {});
      const elapsedMs = performance.now() - start;

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.claimCount).toBe(50_000);
      expect(elapsedMs).toBeLessThan(60_000);

      const hashes = new Set(claims.map((c) => claimHash(c)));
      expect(hashes.size).toBe(50_000);
    },
    120_000,
  );
});

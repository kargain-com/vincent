import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWmiFiles } from '../src/generate-wmi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE_ROOT = resolve(__dirname, '..');
const CACHE_ZIP = join(PIPELINE_ROOT, '.cache', 'vPICList_lite_2026_06.plain.zip');

const cacheAvailable = existsSync(CACHE_ZIP);

describe.skipIf(!cacheAvailable)('WMI generator determinism', () => {
  it(
    'produces identical core and extended modules across two runs',
    async () => {
    const runOnce = async (): Promise<{ core: string; extended: string }> => {
      const tempDir = mkdtempSync(join(tmpdir(), 'vincent-wmi-'));
      try {
        const reports = await generateWmiFiles({
          skipDownload: true,
          coreOutputPath: join(tempDir, 'wmi-core.generated.ts'),
          extendedOutputPath: join(tempDir, 'wmi-extended.generated.ts'),
        });
        return {
          core: reports[0].sha256,
          extended: reports[1].sha256,
        };
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    };

    const first = await runOnce();
    const second = await runOnce();

    expect(second.core).toBe(first.core);
    expect(second.extended).toBe(first.extended);
  }, 60_000);
});

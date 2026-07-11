import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import baseline from '../protocol/baseline-dist.json';

const packageRoot = process.cwd();
const srcRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function forbiddenRuntimeImportPattern(): RegExp {
  const db = 'sql' + 'ite';
  return new RegExp(`@${db}\\.org|${db}-wasm|${db}\\.js`, 'i');
}

describe('decoder isolation', () => {
  it('has no database or wasm imports anywhere under src/', () => {
    const pattern = forbiddenRuntimeImportPattern();
    for (const file of listSourceFiles(srcRoot)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(pattern);
    }
  });

  it('keeps dist/index.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'index.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['index.js'].md5);
    expect(content).not.toMatch(/decoder\//);
  });

  it('keeps dist/wmi-export.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'wmi-export.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['wmi-export.js'].md5);
    expect(content).not.toMatch(/decoder\//);
  });

  it('keeps decoder entry free of database-wasm deps in dist', () => {
    const pattern = forbiddenRuntimeImportPattern();
    const decoderJs = readFileSync(join(distRoot, 'decoder-export.js'), 'utf8');
    expect(decoderJs).not.toMatch(pattern);
    expect(readFileSync(join(distRoot, 'index.js'), 'utf8')).not.toMatch(pattern);
    expect(readFileSync(join(distRoot, 'wmi-export.js'), 'utf8')).not.toMatch(pattern);
  });
});

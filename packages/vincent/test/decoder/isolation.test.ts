import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import baseline from '../protocol/baseline-dist.json';

const packageRoot = process.cwd();
const srcRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');
const sqliteAllowed = join(srcRoot, 'decoder/sqlite-db.ts');

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

describe('decoder isolation', () => {
  it('allows @sqlite.org/sqlite-wasm imports only in sqlite-db.ts', () => {
    for (const file of listSourceFiles(srcRoot)) {
      if (file === sqliteAllowed) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(content.includes('@sqlite.org/sqlite-wasm')).toBe(false);
    }
  });

  it('keeps dist/index.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'index.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['index.js'].md5);
    expect(content).not.toMatch(/@sqlite\.org|decoder\//);
  });

  it('keeps dist/wmi-export.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'wmi-export.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['wmi-export.js'].md5);
    expect(content).not.toMatch(/@sqlite\.org|decoder\//);
  });

  it('places sqlite-wasm imports only under dist/decoder/sqlite-db.js', () => {
    const sqliteJs = readFileSync(join(distRoot, 'decoder/sqlite-db.js'), 'utf8');
    expect(sqliteJs).toMatch(/@sqlite\.org\/sqlite-wasm/);
    expect(readFileSync(join(distRoot, 'index.js'), 'utf8')).not.toMatch(/@sqlite\.org/);
    expect(readFileSync(join(distRoot, 'wmi-export.js'), 'utf8')).not.toMatch(/@sqlite\.org/);
  });
});

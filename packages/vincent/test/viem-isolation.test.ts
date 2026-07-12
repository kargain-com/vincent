import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const srcRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');

const VIEM_IMPORT = /from ['"]viem/;

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

describe('viem isolation', () => {
  it('imports viem only under src/anchor/ and anchor-export.ts', () => {
    for (const file of listSourceFiles(srcRoot)) {
      const rel = file.slice(srcRoot.length + 1);
      if (rel.startsWith('anchor/') || rel === 'anchor-export.ts') {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(VIEM_IMPORT);
    }
  });

  it('keeps core subpath dist entries free of viem', () => {
    const coreEntries = [
      'index.js',
      'wmi-export.js',
      'protocol/index.js',
      'decoder-export.js',
      'arweave-export.js',
    ];
    for (const rel of coreEntries) {
      const js = readFileSync(join(distRoot, rel), 'utf8');
      expect(js).not.toMatch(/viem/);
    }
  });

  it('keeps decoder and arweave impl dist free of viem', () => {
    const implFiles = [
      'decoder/create-decoder.js',
      'arweave/create-arweave-get-leaf.js',
    ];
    for (const rel of implFiles) {
      const js = readFileSync(join(distRoot, rel), 'utf8');
      expect(js).not.toMatch(/viem/);
    }
  });
});

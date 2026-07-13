import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const arweaveSrcRoot = join(packageRoot, 'src', 'arweave');
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

function importLines(content: string): string[] {
  return content.split('\n').filter((line) => /\bfrom '/.test(line));
}

describe('arweave isolation', () => {
  it('imports nothing at runtime beyond global fetch', () => {
    for (const file of listSourceFiles(arweaveSrcRoot)) {
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/@noble\//);
      expect(content).not.toMatch(/protocol\//);
      const fileName = file.split('/').pop() ?? '';
      for (const line of importLines(content)) {
        // Cross-module decoder imports must be type-only, except verifyLeaf in gateway verify.
        if (/decoder\//.test(line)) {
          const allowedRuntimeDecoder =
            fileName === 'fetch-leaf-from-gateway.ts' && line.includes("from '../decoder/verify-leaf.js'");
          if (!allowedRuntimeDecoder) {
            expect(line.trimStart().startsWith('import type')).toBe(true);
          }
        }
      }
    }
  });

  it('keeps createArweaveGetLeaf built entry free of non-fetch dependencies', () => {
    const implJs = readFileSync(join(distRoot, 'arweave', 'create-arweave-get-leaf.js'), 'utf8');
    expect(implJs).not.toMatch(/@noble/);
    expect(implJs).not.toMatch(/protocol\//);
    expect(implJs).not.toMatch(/decoder\//);
    expect(implJs).not.toMatch(/from 'node:/);
  });
});

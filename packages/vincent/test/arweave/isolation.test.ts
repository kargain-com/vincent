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
      for (const line of importLines(content)) {
        // Any cross-module import (e.g. decoder types) must be type-only and erased.
        if (/decoder\//.test(line)) {
          expect(line.trimStart().startsWith('import type')).toBe(true);
        }
      }
    }
  });

  it('keeps built arweave entry free of non-fetch dependencies', () => {
    const entryJs = readFileSync(join(distRoot, 'arweave-export.js'), 'utf8');
    const implJs = readFileSync(join(distRoot, 'arweave', 'create-arweave-get-leaf.js'), 'utf8');
    for (const js of [entryJs, implJs]) {
      expect(js).not.toMatch(/@noble/);
      expect(js).not.toMatch(/protocol\//);
      expect(js).not.toMatch(/decoder\//);
      expect(js).not.toMatch(/from 'node:/);
    }
  });
});

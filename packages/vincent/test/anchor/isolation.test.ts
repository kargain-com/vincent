import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = process.cwd();
const anchorSrcRoot = join(packageRoot, 'src', 'anchor');
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

describe('anchor isolation', () => {
  it('allows viem imports under src/anchor/', () => {
    const anchorFiles = listSourceFiles(anchorSrcRoot);
    const withViem = anchorFiles.filter((file) =>
      /from 'viem/.test(readFileSync(file, 'utf8')),
    );
    expect(withViem.length).toBeGreaterThan(0);
  });

  it('keeps built anchor impl wired to viem', () => {
    const implJs = readFileSync(join(distRoot, 'anchor', 'create-anchor-reader.js'), 'utf8');
    expect(implJs).toMatch(/viem/);
  });
});

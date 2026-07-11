import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import baseline from './baseline-dist.json';
import golden from './fixtures/golden.json';
import { attest, signManifest } from '../../src/protocol/sign.js';
import { claimHash } from '../../src/protocol/hash.js';

const packageRoot = process.cwd();
const srcRoot = join(packageRoot, 'src');
const distRoot = join(packageRoot, 'dist');
const nobleAllowed = join(srcRoot, 'protocol/crypto.ts');

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

describe('protocol isolation', () => {
  it('allows @noble imports only in crypto.ts', () => {
    for (const file of listSourceFiles(srcRoot)) {
      if (file === nobleAllowed) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(content.includes('@noble/')).toBe(false);
    }
  });

  it('keeps dist/index.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'index.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['index.js'].md5);
    expect(content).not.toMatch(/@noble|protocol\//);
  });

  it('keeps dist/wmi-export.js byte-identical to baseline', () => {
    const content = readFileSync(join(distRoot, 'wmi-export.js'), 'utf8');
    expect(createHash('md5').update(content).digest('hex')).toBe(baseline['wmi-export.js'].md5);
    expect(content).not.toMatch(/@noble|protocol\//);
  });

  it('places noble imports only under dist/protocol/crypto.js', () => {
    const cryptoJs = readFileSync(join(distRoot, 'protocol/crypto.js'), 'utf8');
    expect(cryptoJs).toMatch(/@noble\/curves/);
    expect(cryptoJs).toMatch(/@noble\/hashes/);
    expect(readFileSync(join(distRoot, 'index.js'), 'utf8')).not.toMatch(/@noble/);
  });
});

describe('golden fixture generator', () => {
  it('matches committed golden hashes', () => {
    const { privateKey, claims, hashes } = golden;
    expect(claimHash(claims.wmi)).toBe(hashes.wmi);
    expect(claimHash(claims.vdsSchema)).toBe(hashes.vdsSchema);
    expect(claimHash(claims.vdsBinding)).toBe(hashes.vdsBinding);
    expect(claimHash(claims.vdsPattern)).toBe(hashes.vdsPattern);
    expect(claimHash(claims.yearHint)).toBe(hashes.yearHint);

    const att = attest(hashes.wmi, privateKey);
    expect(att.claim).toBe(hashes.wmi);

    const manifestClaims = [
      hashes.wmi,
      hashes.vdsSchema,
      hashes.vdsBinding,
      hashes.vdsPattern,
      hashes.yearHint,
    ].sort();
    const manifest = signManifest({ ...golden.manifest, claims: manifestClaims }, privateKey);
    expect(manifest.claims).toEqual(manifestClaims);
  });
});

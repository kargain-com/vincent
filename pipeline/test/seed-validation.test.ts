import { describe, expect, it } from 'vitest';

import {
  GENESIS_MINI_VIN_2011,
  buildGenesisMiniDecoder,
  compileGenesisMini,
  loadGenesisMiniGolden,
} from './helpers/genesis-mini.js';

describe('genesis-mini compile and decode', () => {
  it('produces stable merkleRoot and leaf hashes across two compiles', () => {
    const golden = loadGenesisMiniGolden();
    const first = compileGenesisMini();
    const second = compileGenesisMini();

    expect(first.jsonlSha256).toBe(golden.jsonlSha256);
    expect(first.merkleRoot).toBe(golden.merkleRoot);
    expect(second.jsonlSha256).toBe(first.jsonlSha256);
    expect(second.merkleRoot).toBe(first.merkleRoot);

    for (const [wmi, entry] of first.leaves) {
      expect(second.leaves.get(wmi)?.leaf).toBe(entry.leaf);
      expect(second.leaves.get(wmi)?.leafHash).toBe(entry.leafHash);
    }
    expect(first.leaves.get(golden.sampleLeafWmi)?.leafHash).toBe(golden.sampleLeafHash);
  });

  it('decodes genesis-mini VINs via Merkle-authenticated leaves', async () => {
    const epoch = compileGenesisMini();
    const decoder = buildGenesisMiniDecoder(epoch);

    const origin = await decoder.origin(GENESIS_MINI_VIN_2011);
    expect(origin.wmi?.manufacturer).toMatch(/Ford/i);
    expect(origin.wmi?.region).toBe('north-america');

    const result = await decoder.decode(GENESIS_MINI_VIN_2011, { year: 2011 });
    expect(result.wmi?.manufacturer).toMatch(/Ford/i);
    expect(result.attributes.find((attr) => attr.attribute === 'model')?.value).toBe('Fusion');
  });
});

describe('keys-to-match', () => {
  it('parses vPIC keys without pipe as vds-only', async () => {
    const { keysToMatch } = await import('../src/seed/keys-to-match.js');
    const result = keysToMatch('**BB');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.match.vis).toBeUndefined();
    }
  });

  it('strips I/O/Q from character classes and keeps valid alternatives', async () => {
    const { keysToMatch } = await import('../src/seed/keys-to-match.js');

    const abo = keysToMatch('[ABO]');
    expect(abo.ok).toBe(true);
    if (abo.ok) {
      expect(abo.claimMatch.vds).toBe('[AB]');
    }

    const aio = keysToMatch('[AIO]');
    expect(aio.ok).toBe(true);
    if (aio.ok) {
      expect(aio.claimMatch.vds).toBe('[A]');
    }

    const range = keysToMatch('[E-K][GH]*1');
    expect(range.ok).toBe(true);
    if (range.ok) {
      expect(range.claimMatch.vds).toBe('[EFGHJK][GH]*1');
    }
  });

  it('skips when a class becomes empty after stripping I/O/Q', async () => {
    const { keysToMatch } = await import('../src/seed/keys-to-match.js');
    const onlyO = keysToMatch('[O]');
    expect(onlyO.ok).toBe(false);
    if (!onlyO.ok) {
      expect(onlyO.reason).toBe('empty-class');
    }
    expect(keysToMatch('**C[IO]').ok).toBe(false);
  });

  it('normalizes character classes to explicit sorted VIN chars in claimMatch', async () => {
    const { keysToMatch } = await import('../src/seed/keys-to-match.js');
    const result = keysToMatch('[A-D][GH]*1|*0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claimMatch).toEqual({ vds: '[ABCD][GH]*1', vis: '*0' });
    }
  });

  it('skips keys with literal I/O/Q outside character classes', async () => {
    const { keysToMatch } = await import('../src/seed/keys-to-match.js');
    expect(keysToMatch('**C[IO]').ok).toBe(false);
    expect(keysToMatch('*I*').ok).toBe(false);
    if (!keysToMatch('*I*').ok) {
      expect(keysToMatch('*I*').reason).toBe('char:I');
    }
  });
});

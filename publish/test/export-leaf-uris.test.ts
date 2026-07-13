import { describe, expect, it } from 'vitest';

import { parseExportLeafUrisArgs } from '../src/cli/export-leaf-uris.js';

describe('export-leaf-uris CLI args', () => {
  it('parses network, epoch, out path, and checkpoint file', () => {
    const options = parseExportLeafUrisArgs([
      '--network',
      'base-sepolia',
      '--epoch',
      '2',
      '--out',
      'leaf-uris.json',
      '--checkpoint-file',
      '/tmp/checkpoint.json',
    ]);

    expect(options.epochNumber).toBe(2);
    expect(options.outFile).toBe('leaf-uris.json');
    expect(options.checkpointFile).toBe('/tmp/checkpoint.json');
  });

  it('parses --epoch=N and --out=PATH forms', () => {
    const options = parseExportLeafUrisArgs([
      '--devnet',
      '--epoch=3',
      '--out=./sidecar.json',
    ]);

    expect(options.epochNumber).toBe(3);
    expect(options.outFile).toBe('./sidecar.json');
  });

  it('requires --out', () => {
    expect(() => parseExportLeafUrisArgs(['--network', 'base-sepolia'])).toThrow(
      /--out=PATH/,
    );
  });

  it('rejects invalid epoch', () => {
    expect(() =>
      parseExportLeafUrisArgs(['--network', 'base-sepolia', '--out', 'x.json', '--epoch', '0']),
    ).toThrow(/--epoch must be a positive integer/);
  });
});

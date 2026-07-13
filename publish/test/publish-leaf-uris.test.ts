import { describe, expect, it } from 'vitest';

import { parsePublishLeafUrisArgs } from '../src/cli/publish-leaf-uris.js';

describe('publish-leaf-uris CLI args', () => {
  it('parses network, epoch, checkpoint file, and skip-backfill', () => {
    const options = parsePublishLeafUrisArgs([
      '--network',
      'base',
      '--epoch',
      '2',
      '--checkpoint-file',
      '/tmp/checkpoint.json',
      '--skip-backfill',
    ]);

    expect(options.network).toBe('base');
    expect(options.epochNumber).toBe(2);
    expect(options.checkpointFile).toBe('/tmp/checkpoint.json');
    expect(options.skipBackfill).toBe(true);
  });

  it('defaults skipBackfill to false', () => {
    const options = parsePublishLeafUrisArgs(['--devnet']);
    expect(options.skipBackfill).toBe(false);
  });

  it('rejects invalid epoch', () => {
    expect(() =>
      parsePublishLeafUrisArgs(['--network', 'base-sepolia', '--epoch', '-1']),
    ).toThrow(/--epoch must be a positive integer/);
  });
});

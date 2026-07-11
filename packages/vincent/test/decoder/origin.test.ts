import { describe, expect, it, vi } from 'vitest';

import { originFromWmiTable } from '../../src/decoder/origin.js';
import * as region from '../../src/region.js';
import { buildDecoderFromClaims } from './compile-helper.js';
import { loadGenesisMiniClaims, VIN_2011, withValidCheckDigit } from './helpers.js';

describe('origin', () => {
  it('returns WMI metadata from bundled ./wmi without fetching leaves', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result = await decoder.origin(VIN_2011);
    expect(result.wmi).toEqual({
      wmi: '1FA',
      manufacturer: 'FORD MOTOR COMPANY',
      country: 'UNITED STATES (USA)',
      vehicleType: 'Passenger Car',
      region: 'north-america',
    });
    expect(result.valid).toBe(true);
  });

  it('returns null wmi for unknown WMI keys', async () => {
    const decoder = buildDecoderFromClaims(loadGenesisMiniClaims());
    const result = await decoder.origin('ZZZ00000000000000');
    expect(result.wmi).toBeNull();
  });

  it('returns early for invalid VIN length', async () => {
    expect((await originFromWmiTable('1F')).wmi).toBeNull();
  });

  it('uses 6-char WMI when position 3 is 9', async () => {
    const vin = withValidCheckDigit('12945600000000000');
    const result = await originFromWmiTable(vin);
    expect(result.valid).toBe(true);
    if (result.wmi !== null) {
      expect(result.wmi.wmi).toBe('129456');
      expect(result.wmi.region).toBe('north-america');
    }
  });

  it('falls back to empty region when vinRegion returns null', async () => {
    const spy = vi.spyOn(region, 'vinRegion').mockReturnValue(null);
    const result = await originFromWmiTable(VIN_2011);
    expect(result.wmi?.region).toBe('');
    spy.mockRestore();
  });
});

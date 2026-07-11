import { vinRegion } from '../region.js';
import { validateVin } from '../validation.js';
import { lookupWmi } from '../wmi.js';
import { resolveWmiKey } from './resolve.js';
import type { DecodedWmi, VinError, VinWarning } from './types.js';

/** Origin lookup result (bundled ./wmi table; no leaf fetch). */
export interface OriginResult {
  vin: string;
  valid: boolean;
  wmi: DecodedWmi | null;
  errors: VinError[];
  warnings: VinWarning[];
}

/**
 * Resolve WMI metadata from the bundled ./wmi table + vinRegion.
 *
 * Note: bundled ./wmi ↔ dataset wmi-claims convergence remains future work
 * (do not change ./wmi here).
 */
export async function originFromWmiTable(vin: string): Promise<OriginResult> {
  const validation = validateVin(vin);
  const base: OriginResult = {
    vin: validation.normalized,
    valid: validation.ok,
    wmi: null,
    errors: validation.errors,
    warnings: validation.warnings,
  };

  if (!validation.ok || validation.normalized.length < 3) {
    return base;
  }

  const wmiKey = resolveWmiKey(validation.normalized);
  const info = await lookupWmi(wmiKey);
  if (info === null) {
    return base;
  }

  const region = vinRegion(validation.normalized.charAt(0)) ?? '';
  base.wmi = {
    wmi: info.wmi,
    manufacturer: info.manufacturer,
    country: info.country,
    vehicleType: info.vehicleType,
    region,
  };
  return base;
}

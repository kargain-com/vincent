import { vinRegion } from '@kargain/vincent';

const REGION_CODES: Record<NonNullable<ReturnType<typeof vinRegion>>, string> = {
  'north-america': 'NA',
  oceania: 'OC',
  'south-america': 'SA',
  africa: 'AF',
  asia: 'AS',
  europe: 'EU',
};

/** Derive protocol wmi claim region from WMI first character (ISO 3780). */
export function deriveWmiRegion(wmi: string): string {
  if (wmi.length === 0) {
    return 'XX';
  }
  const region = vinRegion(wmi.charAt(0));
  if (region === null) {
    return 'XX';
  }
  return REGION_CODES[region];
}

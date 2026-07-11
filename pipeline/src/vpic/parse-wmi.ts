import type { BaseLookups } from './parse-lookups.js';
import type { ProgressFn } from './source.js';
import { SQL_PATH } from './source.js';
import { iterateCopyBlock } from './copy-block.js';
import { parseField, parseIntField } from './parse-utils.js';

export const WMI_COPY_HEADER =
  'COPY vpic.wmi (id, wmi, manufacturerid, makeid, vehicletypeid, createdon, updatedon, countryid, publicavailabilitydate, trucktypeid, processedon, noncompliant, noncompliantsetbyovsc) FROM stdin;';

export interface WmiTableRow {
  id: number;
  wmi: string;
  manufacturer: string;
  country: string | null;
  vehicleType: string | null;
}

export interface WmiRow {
  wmi: string;
  manufacturer: string;
  country: string | null;
  vehicleType: string | null;
}

export async function parseWmiTable(
  lookups: BaseLookups,
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<WmiTableRow[]> {
  const rows: WmiTableRow[] = [];

  for await (const fields of iterateCopyBlock(sqlPath, WMI_COPY_HEADER)) {
    const id = parseIntField(fields[0]);
    const wmi = parseField(fields[1]);
    if (id === null || wmi === null) {
      continue;
    }

    const manufacturerId = parseIntField(fields[2]);
    const vehicleTypeId = parseIntField(fields[4]);
    const countryId = parseIntField(fields[7]);

    const manufacturer =
      manufacturerId === null ? null : lookups.manufacturers.get(manufacturerId) ?? null;
    if (manufacturer === null) {
      continue;
    }

    const country =
      countryId === null ? null : lookups.countries.get(countryId) ?? null;
    const vehicleType =
      vehicleTypeId === null ? null : lookups.vehicleTypes.get(vehicleTypeId) ?? null;

    rows.push({ id, wmi, manufacturer, country, vehicleType });
  }

  rows.sort((a, b) => a.wmi.localeCompare(b.wmi));
  progress?.(`Parsed ${String(rows.length)} WMI entries`);
  return rows;
}

export async function parseWmiRows(
  lookups: BaseLookups,
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<WmiRow[]> {
  const tableRows = await parseWmiTable(lookups, sqlPath, progress);
  return tableRows.map(({ wmi, manufacturer, country, vehicleType }) => ({
    wmi,
    manufacturer,
    country,
    vehicleType,
  }));
}

export function buildWmiIdMap(rows: WmiTableRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    map.set(row.id, row.wmi);
  }
  return map;
}

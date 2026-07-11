import type { ProgressFn } from './source.js';
import { SQL_PATH } from './source.js';
import { iterateCopyBlock } from './copy-block.js';
import { parseField, parseIntField } from './parse-utils.js';

export const PROFILE_ELEMENT_IDS = new Set([28, 5, 24, 15, 37, 34, 18, 9, 13, 31]);

export const VINSCHEMA_COPY_HEADER =
  'COPY vpic.vinschema (id, name, sourcewmi, createdon, updatedon, tobeqced) FROM stdin;';

export const WMI_VINSCHEMA_COPY_HEADER =
  'COPY vpic.wmi_vinschema (id, wmiid, vinschemaid, yearfrom, yearto, orgid) FROM stdin;';

export const PATTERN_COPY_HEADER =
  'COPY vpic.pattern (id, vinschemaid, keys, elementid, attributeid, createdon, updatedon) FROM stdin;';

export interface VinSchemaRow {
  id: number;
  name: string;
}

export interface WmiVinSchemaRow {
  id: number;
  wmiId: number;
  vinSchemaId: number;
  yearFrom: number;
  yearTo: number | null;
}

export interface PatternRow {
  id: number;
  vinSchemaId: number;
  keys: string;
  elementId: number;
  attributeId: string;
}

export async function parseVinSchemaRows(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<VinSchemaRow[]> {
  const rows: VinSchemaRow[] = [];

  for await (const fields of iterateCopyBlock(sqlPath, VINSCHEMA_COPY_HEADER)) {
    const id = parseIntField(fields[0]);
    const name = parseField(fields[1]);
    if (id === null || name === null) {
      continue;
    }
    rows.push({ id, name });
  }

  rows.sort((a, b) => a.id - b.id);
  progress?.(`Parsed ${String(rows.length)} vinschema rows`);
  return rows;
}

export async function parseWmiVinSchemaRows(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<WmiVinSchemaRow[]> {
  const rows: WmiVinSchemaRow[] = [];

  for await (const fields of iterateCopyBlock(sqlPath, WMI_VINSCHEMA_COPY_HEADER)) {
    const id = parseIntField(fields[0]);
    const wmiId = parseIntField(fields[1]);
    const vinSchemaId = parseIntField(fields[2]);
    const yearFrom = parseIntField(fields[3]);
    const yearToRaw = parseField(fields[4]);
    if (id === null || wmiId === null || vinSchemaId === null || yearFrom === null) {
      continue;
    }
    const yearTo = yearToRaw === null ? null : parseIntField(fields[4]);
    if (yearToRaw !== null && yearTo === null) {
      continue;
    }
    rows.push({ id, wmiId, vinSchemaId, yearFrom, yearTo });
  }

  rows.sort((a, b) => {
    const cmp = a.wmiId - b.wmiId;
    if (cmp !== 0) {
      return cmp;
    }
    const yearCmp = a.yearFrom - b.yearFrom;
    if (yearCmp !== 0) {
      return yearCmp;
    }
    return a.id - b.id;
  });
  progress?.(`Parsed ${String(rows.length)} wmi_vinschema rows`);
  return rows;
}

export async function parseProfilePatternRows(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<PatternRow[]> {
  const rows: PatternRow[] = [];

  for await (const fields of iterateCopyBlock(sqlPath, PATTERN_COPY_HEADER)) {
    const elementId = parseIntField(fields[3]);
    if (elementId === null || !PROFILE_ELEMENT_IDS.has(elementId)) {
      continue;
    }
    const id = parseIntField(fields[0]);
    const vinSchemaId = parseIntField(fields[1]);
    const keys = parseField(fields[2]);
    const attributeId = parseField(fields[4]);
    if (
      id === null ||
      vinSchemaId === null ||
      keys === null ||
      attributeId === null
    ) {
      continue;
    }
    rows.push({ id, vinSchemaId, keys, elementId, attributeId });
  }

  progress?.(`Parsed ${String(rows.length)} profile pattern rows`);
  return rows;
}

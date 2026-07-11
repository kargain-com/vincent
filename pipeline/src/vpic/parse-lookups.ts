import type { ProgressFn } from './source.js';
import { SQL_PATH } from './source.js';
import { iterateCopyBlocksByTable } from './copy-block.js';
import { parseField, parseIntField } from './parse-utils.js';

export interface BaseLookups {
  countries: Map<number, string>;
  manufacturers: Map<number, string>;
  vehicleTypes: Map<number, string>;
}

export interface ProfileLookups {
  models: Map<number, string>;
  bodyStyles: Map<number, string>;
  fuelTypes: Map<number, string>;
  driveTypes: Map<number, string>;
  transmissions: Map<number, string>;
}

export type VpicLookups = BaseLookups & ProfileLookups;

const BASE_TABLES = new Set(['country', 'manufacturer', 'vehicletype']);
const PROFILE_TABLES = new Set([
  'model',
  'bodystyle',
  'fueltype',
  'drivetype',
  'transmission',
]);

function setLookup(
  map: Map<number, string>,
  fields: string[],
): void {
  const id = parseIntField(fields[0]);
  const name = parseField(fields[1]);
  if (id !== null && name !== null) {
    map.set(id, name);
  }
}

export async function parseBaseLookups(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<BaseLookups> {
  const countries = new Map<number, string>();
  const manufacturers = new Map<number, string>();
  const vehicleTypes = new Map<number, string>();

  for await (const { table, fields } of iterateCopyBlocksByTable(sqlPath, BASE_TABLES)) {
    if (table === 'country') {
      setLookup(countries, fields);
    } else if (table === 'manufacturer') {
      setLookup(manufacturers, fields);
    } else if (table === 'vehicletype') {
      setLookup(vehicleTypes, fields);
    }
  }

  progress?.(
    `Parsed lookups: ${String(countries.size)} countries, ${String(manufacturers.size)} manufacturers, ${String(vehicleTypes.size)} vehicle types`,
  );

  return { countries, manufacturers, vehicleTypes };
}

export async function parseProfileLookups(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<ProfileLookups> {
  const models = new Map<number, string>();
  const bodyStyles = new Map<number, string>();
  const fuelTypes = new Map<number, string>();
  const driveTypes = new Map<number, string>();
  const transmissions = new Map<number, string>();

  for await (const { table, fields } of iterateCopyBlocksByTable(sqlPath, PROFILE_TABLES)) {
    if (table === 'model') {
      setLookup(models, fields);
    } else if (table === 'bodystyle') {
      setLookup(bodyStyles, fields);
    } else if (table === 'fueltype') {
      setLookup(fuelTypes, fields);
    } else if (table === 'drivetype') {
      setLookup(driveTypes, fields);
    } else if (table === 'transmission') {
      setLookup(transmissions, fields);
    }
  }

  progress?.(
    `Parsed profile lookups: ${String(models.size)} models, ${String(bodyStyles.size)} body styles, ${String(fuelTypes.size)} fuel types, ${String(driveTypes.size)} drive types, ${String(transmissions.size)} transmissions`,
  );

  return { models, bodyStyles, fuelTypes, driveTypes, transmissions };
}

export async function parseAllLookups(
  sqlPath: string = SQL_PATH,
  progress?: ProgressFn,
): Promise<VpicLookups> {
  const base = await parseBaseLookups(sqlPath, progress);
  const profile = await parseProfileLookups(sqlPath, progress);
  return { ...base, ...profile };
}

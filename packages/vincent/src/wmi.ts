import { inflateRawDeflate } from './inflate.vendored.js';
import { normalizeVin } from './normalize.js';
import { WMI_DEFLATE_B64 } from './wmi.generated.js';

export interface WmiInfo {
  wmi: string;
  manufacturer: string;
  country: string | null;
  vehicleType: string | null;
}

interface WmiPayload {
  strings: string[];
  keys: string[];
  data: [number, number | null, number | null][];
}

interface WmiTable {
  strings: readonly string[];
  keys: readonly string[];
  data: readonly (readonly [number, number | null, number | null])[];
}

let cachedTable: WmiTable | null = null;

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function loadWmiTable(): WmiTable {
  if (cachedTable !== null) {
    return cachedTable;
  }

  const compressed = decodeBase64(WMI_DEFLATE_B64);
  const inflated = inflateRawDeflate(compressed);
  const json = new TextDecoder().decode(inflated);
  const payload = JSON.parse(json) as WmiPayload;

  cachedTable = {
    strings: payload.strings,
    keys: payload.keys,
    data: payload.data,
  };
  return cachedTable;
}

function wmiCandidates(normalized: string): string[] {
  if (normalized.length >= 17) {
    const base = normalized.slice(0, 3);
    if (normalized[2] === '9') {
      const extended = base + normalized.slice(11, 14);
      return [extended, base];
    }
    return [base];
  }
  if (normalized.length >= 6) {
    return [normalized.slice(0, 6), normalized.slice(0, 3)];
  }
  if (normalized.length >= 3) {
    return [normalized.slice(0, 3)];
  }
  return [];
}

function binarySearch(keys: readonly string[], target: string): number {
  let low = 0;
  let high = keys.length - 1;

  while (low <= high) {
    const mid = low + Math.floor((high - low) / 2);
    const value = keys[mid];
    if (value === target) {
      return mid;
    }
    if (value < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return -1;
}

function resolveEntry(table: WmiTable, index: number): WmiInfo {
  const wmi = table.keys[index];
  const tuple = table.data[index] as readonly [number, number | null, number];
  const manufacturer = table.strings[tuple[0]];
  const country = tuple[1] === null ? null : table.strings[tuple[1]];
  const vehicleType = table.strings[tuple[2]];
  return { wmi, manufacturer, country, vehicleType };
}

export function lookupWmi(vinOrWmi: string): WmiInfo | null {
  const normalized = normalizeVin(vinOrWmi);
  const candidates = wmiCandidates(normalized);
  if (candidates.length === 0) {
    return null;
  }

  const table = loadWmiTable();
  for (const candidate of candidates) {
    const index = binarySearch(table.keys, candidate);
    if (index >= 0) {
      return resolveEntry(table, index);
    }
  }

  return null;
}

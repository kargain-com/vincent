import { decodeModelYear } from '../model-year.js';
import type { VinErrorCode } from '../validation.js';
import { validateVin } from '../validation.js';
import { originFromWmiTable } from './origin.js';
import { isPartitionManifest } from './parse-leaf.js';
import { decodeFromLeaf, resolveWmiKey } from './resolve.js';
import type {
  DecodeOptions,
  DecodeResult,
  Decoder,
  OriginResult,
} from './types.js';
import type {
  DecodeLeaf,
  GetLeaf,
  LeafBinding,
  LeafPattern,
  MerkleProof,
  PartitionEntry,
  PartitionManifest,
  WireLeaf,
} from './leaf-types.js';
import { verifyLeaf } from './verify-leaf.js';

export interface CreateDecoderOptions {
  /** Anchored Merkle root from the epoch manifest (caller must verify signature). */
  merkleRoot: string;
  /** Untrusted leaf provider; every leaf is verified against merkleRoot. */
  getLeaf: GetLeaf;
}

function bindingKey(binding: LeafBinding): string {
  return `${String(binding.yearFrom)}:${binding.yearTo === null ? 'null' : String(binding.yearTo)}:${binding.schemaRef}`;
}

function patternKey(pattern: LeafPattern): string {
  return JSON.stringify({
    match: pattern.match,
    attribute: pattern.attribute,
    code: pattern.code,
  });
}

function compareBindings(a: LeafBinding, b: LeafBinding): number {
  let cmp = a.yearFrom - b.yearFrom;
  if (cmp !== 0) {
    return cmp;
  }
  if (a.yearTo === null && b.yearTo === null) {
    cmp = 0;
  } else if (a.yearTo === null) {
    cmp = 1;
  } else if (b.yearTo === null) {
    cmp = -1;
  } else {
    cmp = a.yearTo - b.yearTo;
  }
  if (cmp !== 0) {
    return cmp;
  }
  return a.schemaRef.localeCompare(b.schemaRef);
}

function comparePatterns(a: LeafPattern, b: LeafPattern): number {
  let cmp = a.match.vds.localeCompare(b.match.vds);
  if (cmp !== 0) {
    return cmp;
  }
  cmp = (a.match.vis ?? '').localeCompare(b.match.vis ?? '');
  if (cmp !== 0) {
    return cmp;
  }
  cmp = a.attribute.localeCompare(b.attribute);
  if (cmp !== 0) {
    return cmp;
  }
  return a.code.localeCompare(b.code);
}

function partitionOverlapsYear(partition: PartitionEntry, year: number): boolean {
  if (year < partition.yearFrom) {
    return false;
  }
  if (partition.yearTo !== null && year > partition.yearTo) {
    return false;
  }
  return true;
}

function selectPartitions(
  manifest: PartitionManifest,
  resolvedYear: number | null,
  candidates: readonly number[],
): PartitionEntry[] {
  if (resolvedYear !== null) {
    return manifest.partitions.filter((partition) =>
      partitionOverlapsYear(partition, resolvedYear),
    );
  }
  if (candidates.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const selected: PartitionEntry[] = [];
  for (const partition of manifest.partitions) {
    if (seen.has(partition.key)) {
      continue;
    }
    if (candidates.some((year) => partitionOverlapsYear(partition, year))) {
      seen.add(partition.key);
      selected.push(partition);
    }
  }
  return selected;
}

function mergeSubLeaves(wmi: string, leaves: readonly DecodeLeaf[]): DecodeLeaf {
  const bindingSeen = new Set<string>();
  const bindings: LeafBinding[] = [];
  const schemas: DecodeLeaf['schemas'] = {};

  for (const leaf of leaves) {
    for (const binding of leaf.bindings) {
      const key = bindingKey(binding);
      if (!bindingSeen.has(key)) {
        bindingSeen.add(key);
        bindings.push(binding);
      }
    }
    for (const [schemaRef, schema] of Object.entries(leaf.schemas)) {
      const existing = schemas[schemaRef] ?? { patterns: [] };
      const seenPatterns = new Set(existing.patterns.map(patternKey));
      const mergedPatterns = [...existing.patterns];
      for (const pattern of schema.patterns) {
        const key = patternKey(pattern);
        if (!seenPatterns.has(key)) {
          seenPatterns.add(key);
          mergedPatterns.push(pattern);
        }
      }
      mergedPatterns.sort(comparePatterns);
      schemas[schemaRef] = { patterns: mergedPatterns };
    }
  }

  bindings.sort(compareBindings);
  return { wmi, bindings, schemas };
}

/** Open a decoder over an anchored Merkle root and injected leaf provider. */
export function createDecoder(options: CreateDecoderOptions): Decoder {
  const { merkleRoot, getLeaf } = options;
  const wireLeafCache = new Map<string, WireLeaf>();
  const subLeafCache = new Map<string, DecodeLeaf>();

  async function loadVerifiedWireLeaf(
    wmiKey: string,
  ): Promise<
    | { ok: true; leaf: WireLeaf }
    | { ok: false; error: { code: VinErrorCode; message: string } }
  > {
    const cached = wireLeafCache.get(wmiKey);
    if (cached !== undefined) {
      return { ok: true, leaf: cached };
    }

    let fetched: { leaf: Uint8Array | string; proof: MerkleProof };
    try {
      fetched = await getLeaf(wmiKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'leaf fetch failed';
      if (message.includes('missing') || message.includes('unknown')) {
        return { ok: false, error: { code: 'unknown-wmi', message } };
      }
      return { ok: false, error: { code: 'invalid-leaf', message } };
    }

    const verified = verifyLeaf(fetched.leaf, fetched.proof, merkleRoot);
    if (!verified.ok) {
      return {
        ok: false,
        error: {
          code: verified.code,
          message: verified.reason,
        },
      };
    }

    if (verified.leaf.wmi !== wmiKey) {
      return {
        ok: false,
        error: {
          code: 'invalid-leaf',
          message: `leaf.wmi mismatch: expected ${wmiKey}, got ${verified.leaf.wmi}`,
        },
      };
    }

    wireLeafCache.set(wmiKey, verified.leaf);
    return { ok: true, leaf: verified.leaf };
  }

  async function loadVerifiedSubLeaf(
    partitionKey: string,
    expectedHash: string,
    wmiKey: string,
  ): Promise<
    | { ok: true; leaf: DecodeLeaf }
    | { ok: false; error: { code: VinErrorCode; message: string } }
  > {
    const cached = subLeafCache.get(partitionKey);
    if (cached !== undefined) {
      return { ok: true, leaf: cached };
    }

    let fetched: { leaf: Uint8Array | string; proof: MerkleProof };
    try {
      fetched = await getLeaf(partitionKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'partition leaf fetch failed';
      return {
        ok: false,
        error: {
          code: 'partition-not-found',
          message: `partition leaf missing for ${partitionKey}: ${message}`,
        },
      };
    }

    const verified = verifyLeaf(fetched.leaf, fetched.proof, merkleRoot);
    if (!verified.ok) {
      return {
        ok: false,
        error: {
          code: verified.code,
          message: verified.reason,
        },
      };
    }

    if (isPartitionManifest(verified.leaf)) {
      return {
        ok: false,
        error: {
          code: 'invalid-leaf',
          message: `partition leaf ${partitionKey} must not be a manifest`,
        },
      };
    }

    if (verified.leafHash !== expectedHash) {
      return {
        ok: false,
        error: {
          code: 'partition-leaf-hash-mismatch',
          message: `partition leaf hash mismatch for ${partitionKey}: expected ${expectedHash}, got ${verified.leafHash}`,
        },
      };
    }

    if (verified.leaf.wmi !== wmiKey) {
      return {
        ok: false,
        error: {
          code: 'invalid-leaf',
          message: `partition leaf.wmi mismatch: expected ${wmiKey}, got ${verified.leaf.wmi}`,
        },
      };
    }

    subLeafCache.set(partitionKey, verified.leaf);
    return { ok: true, leaf: verified.leaf };
  }

  return {
    async origin(vin: string): Promise<OriginResult> {
      return originFromWmiTable(vin);
    },

    async decode(vin: string, decodeOptions?: DecodeOptions): Promise<DecodeResult> {
      const origin = await originFromWmiTable(vin);
      const validation = validateVin(vin);
      const modelYear = decodeModelYear(validation.normalized);
      const resolvedYear = decodeOptions?.year ?? modelYear.best ?? null;
      const yearAmbiguous = decodeOptions?.year === undefined && modelYear.best === null;

      const base: DecodeResult = {
        vin: origin.vin,
        valid: origin.valid,
        year: {
          value: resolvedYear,
          ambiguous: yearAmbiguous,
          candidates: modelYear.candidates,
        },
        wmi: origin.wmi,
        attributes: [],
        errors: [...origin.errors],
        warnings: origin.warnings,
      };

      if (!origin.valid || validation.normalized.length < 3) {
        return base;
      }

      if (origin.wmi === null) {
        base.errors.push({
          code: 'unknown-wmi',
          message: `WMI not found in bundled table for ${resolveWmiKey(validation.normalized)}`,
        });
        return base;
      }

      const wmiKey = resolveWmiKey(validation.normalized);
      const loaded = await loadVerifiedWireLeaf(wmiKey);
      if (!loaded.ok) {
        base.errors.push({ code: loaded.error.code, message: loaded.error.message });
        return base;
      }

      let decodeLeaf: DecodeLeaf;
      if (isPartitionManifest(loaded.leaf)) {
        const selected = selectPartitions(
          loaded.leaf,
          resolvedYear,
          modelYear.candidates,
        );
        if (selected.length === 0) {
          return base;
        }
        const subLeaves: DecodeLeaf[] = [];
        for (const partition of selected) {
          const subLoaded = await loadVerifiedSubLeaf(
            partition.key,
            partition.leafHash,
            wmiKey,
          );
          if (!subLoaded.ok) {
            base.errors.push({ code: subLoaded.error.code, message: subLoaded.error.message });
            return base;
          }
          subLeaves.push(subLoaded.leaf);
        }
        decodeLeaf = mergeSubLeaves(wmiKey, subLeaves);
      } else {
        decodeLeaf = loaded.leaf;
      }

      return decodeFromLeaf(decodeLeaf, vin, origin.wmi, decodeOptions);
    },
  };
}

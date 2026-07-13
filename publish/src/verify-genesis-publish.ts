import { createArweaveGetLeafWithUris, resolveVerifierLeafUris } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import type { Manifest } from '@kargain/vincent/protocol';

import type {
  OnChainEpoch,
  WaitForLatestEpochOptions,
} from './adapters/base-sepolia-publisher.js';
import { bytes32ToContentId, sha256ContentIdToBytes32 } from './adapters/sha256-bytes32.js';
import type { PublishGenesisReport } from './adapters/types.js';
import {
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
} from './cli/genesis-mini-vins.js';
import { loadSeedFixtureCases } from './seed-fixtures.js';
import { manifestHash, verifySignedManifest } from './sign-manifest.js';

export interface GenesisPublishChainVerifier {
  waitForLatestEpoch(
    publisher: `0x${string}`,
    options?: WaitForLatestEpochOptions,
  ): Promise<OnChainEpoch>;
}

export interface VerifyGenesisPublishOptions {
  report: PublishGenesisReport;
  chainPublisher: GenesisPublishChainVerifier;
  gatewayUrl: string;
  graphqlUrl: string;
  fixture: 'genesis-mini' | 'full';
  fetchImpl?: typeof fetch;
  /** Leaf tag epoch for getLeaf (defaults to report.manifest.epoch). */
  epochNumber?: number;
  /** Checkpoint leafKey → ar://txId map for gateway-first decode. */
  leafUris?: Record<string, string>;
  /** Published Kind=leaf-uris sidecar URI. */
  leafUriSidecarUri?: string;
  /** When true and leafUris omitted, discover sidecar via GraphQL (default true). */
  discoverLeafUriSidecar?: boolean;
  waitForLatestEpochOptions?: WaitForLatestEpochOptions;
}

export interface VerifyGenesisPublishResult {
  ok: boolean;
  failures: string[];
}

function arUriToGatewayUrl(gatewayUrl: string, uri: string): string {
  if (!uri.startsWith('ar://')) {
    throw new Error(`Expected ar:// URI, got ${uri}`);
  }
  const id = uri.slice('ar://'.length);
  return `${gatewayUrl.replace(/\/+$/, '')}/${id}`;
}

async function fetchManifest(
  gatewayUrl: string,
  manifestUri: string,
  fetchImpl: typeof fetch,
): Promise<Manifest> {
  const response = await fetchImpl(arUriToGatewayUrl(gatewayUrl, manifestUri));
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }
  return (await response.json()) as Manifest;
}

async function verifyFixtureVins(
  gatewayUrl: string,
  graphqlUrl: string,
  publisher: string,
  merkleRoot: string,
  epochNumber: number,
  fetchImpl: typeof fetch,
  leafUris?: Record<string, string>,
): Promise<string[]> {
  const failures: string[] = [];
  const getLeaf = createArweaveGetLeafWithUris({
    gatewayUrl,
    graphqlUrl,
    publisher,
    epoch: epochNumber,
    fetchImpl,
    leafUris,
  });
  const decoder = createDecoder({ merkleRoot, getLeaf });

  const checks = [
    { vin: VIN_2011, year: 2011 },
    { vin: VIN_2014, year: 2014 },
  ];

  for (const check of checks) {
    const result = await decoder.decode(check.vin);
    if (result.year.value !== check.year) {
      failures.push(`decode year for ${check.vin}`);
    }
  }

  const body = await decoder.decode(VIN_BODY);
  if (body.attributes.find((attr) => attr.attribute === 'bodyType')?.value !== 'Sedan') {
    failures.push(`decode bodyType: ${JSON.stringify(body.errors)}`);
  }

  const fuel = await decoder.decode(VIN_FUEL);
  if (fuel.attributes.find((attr) => attr.attribute === 'fuelType')?.value !== 'Gasoline') {
    failures.push(`decode fuelType: ${JSON.stringify(fuel.errors)}`);
  }

  const plant = await decoder.decode(VIN_PLANT);
  const expectedPlant = epochNumber === 2 ? 'Detroit' : 'Chicago';
  if (plant.attributes.find((attr) => attr.attribute === 'plant')?.value !== expectedPlant) {
    failures.push(`decode plant: ${JSON.stringify(plant.errors)}`);
  }

  return failures;
}

async function verifySeedFixtureVins(
  gatewayUrl: string,
  graphqlUrl: string,
  publisher: string,
  merkleRoot: string,
  epochNumber: number,
  fetchImpl: typeof fetch,
  leafUris?: Record<string, string>,
): Promise<string[]> {
  const getLeaf = createArweaveGetLeafWithUris({
    gatewayUrl,
    graphqlUrl,
    publisher,
    epoch: epochNumber,
    fetchImpl,
    leafUris,
  });
  const decoder = createDecoder({ merkleRoot, getLeaf });

  const results = await Promise.all(
    loadSeedFixtureCases().map(async (testCase) => {
      const decoded = await decoder.decode(
        testCase.vin,
        testCase.year === undefined ? {} : { year: testCase.year },
      );
      const actual = {
        manufacturer: decoded.wmi?.manufacturer ?? null,
        model: decoded.attributes.find((attr) => attr.attribute === 'model')?.value,
        bodyType: decoded.attributes.find((attr) => attr.attribute === 'bodyType')?.value,
        fuelType: decoded.attributes.find((attr) => attr.attribute === 'fuelType')?.value,
      };
      const failures: string[] = [];

      if (actual.manufacturer !== testCase.expected.manufacturer) {
        failures.push(
          `decode manufacturer for ${testCase.vin}: expected ${testCase.expected.manufacturer}, got ${String(actual.manufacturer)}`,
        );
      }
      for (const field of ['model', 'bodyType', 'fuelType'] as const) {
        const expected = testCase.expected[field];
        if (expected !== undefined && actual[field] !== expected) {
          failures.push(
            `decode ${field} for ${testCase.vin}: expected ${expected}, got ${String(actual[field])}`,
          );
        }
      }

      return failures;
    }),
  );

  return results.flat();
}

/** Post-publish verification shared by the founder CLI and offline simulations. */
export async function verifyGenesisPublish(
  options: VerifyGenesisPublishOptions,
): Promise<VerifyGenesisPublishResult> {
  const failures: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const { report } = options;
  const epochNumber = options.epochNumber ?? report.manifest.epoch;

  const waitOptions: WaitForLatestEpochOptions = {
    minEpochCount: BigInt(report.manifest.epoch),
    expectedManifestUri: report.manifestUri,
    ...options.waitForLatestEpochOptions,
  };

  const onChain = await options.chainPublisher.waitForLatestEpoch(
    report.publisher as `0x${string}`,
    waitOptions,
  );

  if (bytes32ToContentId(onChain.merkleRoot) !== report.manifest.dataset.merkleRoot) {
    failures.push('on-chain merkleRoot mismatch');
  }
  if (bytes32ToContentId(onChain.jsonlSha256) !== report.manifest.dataset.jsonlSha256) {
    failures.push('on-chain jsonlSha256 mismatch');
  }
  if (bytes32ToContentId(onChain.manifestHash) !== report.manifestHash) {
    failures.push('on-chain manifestHash mismatch');
  }
  if (onChain.manifestUri !== report.manifestUri) {
    failures.push('on-chain manifestUri mismatch');
  }

  const fetched = await fetchManifest(options.gatewayUrl, report.manifestUri, fetchImpl);
  if (manifestHash(fetched) !== report.manifestHash) {
    failures.push('fetched manifest hash mismatch');
  }

  const verified = verifySignedManifest(fetched);
  if (!verified.ok) {
    failures.push(`manifest signature: ${verified.reason}`);
  }

  if (sha256ContentIdToBytes32(report.manifestHash) !== onChain.manifestHash) {
    failures.push('manifest hash bytes32 conversion');
  }

  const resolvedLeafUris = await resolveVerifierLeafUris({
    publisher: report.publisher.toLowerCase(),
    epoch: epochNumber,
    merkleRoot: report.manifest.dataset.merkleRoot,
    jsonlSha256: report.manifest.dataset.jsonlSha256,
    gatewayUrl: options.gatewayUrl,
    graphqlUrl: options.graphqlUrl,
    fetchImpl,
    leafUris: options.leafUris,
    leafUriSidecarUri: options.leafUriSidecarUri,
    discoverLeafUriSidecar: options.discoverLeafUriSidecar,
  });

  if (options.fixture === 'genesis-mini') {
    failures.push(
      ...(await verifyFixtureVins(
        options.gatewayUrl,
        options.graphqlUrl,
        report.publisher.toLowerCase(),
        report.manifest.dataset.merkleRoot,
        epochNumber,
        fetchImpl,
        resolvedLeafUris,
      )),
    );
  } else {
    failures.push(
      ...(await verifySeedFixtureVins(
        options.gatewayUrl,
        options.graphqlUrl,
        report.publisher.toLowerCase(),
        report.manifest.dataset.merkleRoot,
        epochNumber,
        fetchImpl,
        resolvedLeafUris,
      )),
    );
  }

  return { ok: failures.length === 0, failures };
}

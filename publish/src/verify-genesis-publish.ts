import { createArweaveGetLeaf } from '@kargain/vincent/arweave';
import { createDecoder } from '@kargain/vincent/decoder';
import type { Manifest } from '@kargain/vincent/protocol';

import type { OnChainEpoch } from './adapters/base-sepolia-publisher.js';
import { sha256ContentIdToBytes32 } from './adapters/sha256-bytes32.js';
import type { PublishGenesisReport } from './adapters/types.js';
import {
  VIN_2011,
  VIN_2014,
  VIN_BODY,
  VIN_FUEL,
  VIN_PLANT,
} from './cli/genesis-mini-vins.js';
import { manifestHash, verifySignedManifest } from './sign-manifest.js';

export interface GenesisPublishChainVerifier {
  waitForLatestEpoch(publisher: `0x${string}`): Promise<OnChainEpoch>;
}

export interface VerifyGenesisPublishOptions {
  report: PublishGenesisReport;
  chainPublisher: GenesisPublishChainVerifier;
  gatewayUrl: string;
  graphqlUrl: string;
  fixture: 'genesis-mini' | 'full';
  fetchImpl?: typeof fetch;
}

export interface VerifyGenesisPublishResult {
  ok: boolean;
  failures: string[];
}

function bytes32ToContentId(value: `0x${string}`): string {
  return `sha256:${value.slice(2).toLowerCase()}`;
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
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const failures: string[] = [];
  const getLeaf = createArweaveGetLeaf({
    gatewayUrl,
    graphqlUrl,
    publisher,
    epoch: 1,
    fetchImpl,
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
  if (plant.attributes.find((attr) => attr.attribute === 'plant')?.value !== 'Chicago') {
    failures.push(`decode plant: ${JSON.stringify(plant.errors)}`);
  }

  return failures;
}

/** Post-publish verification shared by the founder CLI and offline simulations. */
export async function verifyGenesisPublish(
  options: VerifyGenesisPublishOptions,
): Promise<VerifyGenesisPublishResult> {
  const failures: string[] = [];
  const fetchImpl = options.fetchImpl ?? fetch;
  const { report } = options;

  const onChain = await options.chainPublisher.waitForLatestEpoch(
    report.publisher as `0x${string}`,
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

  if (options.fixture === 'genesis-mini') {
    failures.push(
      ...(await verifyFixtureVins(
        options.gatewayUrl,
        options.graphqlUrl,
        report.publisher.toLowerCase(),
        report.manifest.dataset.merkleRoot,
        fetchImpl,
      )),
    );
  }

  return { ok: failures.length === 0, failures };
}

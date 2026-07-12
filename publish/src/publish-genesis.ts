import type { EpochBuild } from '@kargain/vincent-compiler';

import type { ChainPublisher, PublishGenesisReport } from './adapters/types.js';
import type { GenesisPreflightOptions } from './preflight-genesis-publish.js';
import { publishEpoch, type LeafIndexCheckOptions, type PublishEpochDeps } from './publish-epoch.js';
import type { EpochChainReader } from './resolve-epoch-parent.js';

export type { LeafIndexCheckOptions } from './publish-epoch.js';

export interface PublishGenesisDeps {
  epoch: EpochBuild;
  signerKeyHex: string;
  uploader: PublishEpochDeps['uploader'];
  chainPublisher: ChainPublisher & EpochChainReader;
  compiler?: PublishEpochDeps['compiler'];
  /** When set, run live preflight before any Arweave/Irys uploads. */
  preflight?: GenesisPreflightOptions;
  /** When set, verify GraphQL leaf indexing before on-chain anchor. */
  leafIndexCheck?: LeafIndexCheckOptions;
}

/** Genesis publish (epoch 1 only, fail-closed when publisher already has epochs). */
export async function publishGenesis(deps: PublishGenesisDeps): Promise<PublishGenesisReport> {
  return publishEpoch({ ...deps, requireGenesis: true });
}

export type {
  ChainPublisher,
  PublishEpochArgs,
  PublishGenesisReport,
  UploadResult,
  UploadTag,
  Uploader,
} from './adapters/types.js';

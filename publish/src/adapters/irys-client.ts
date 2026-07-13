import { Uploader } from '@irys/upload';
import { BaseEth } from '@irys/upload-ethereum';

import {
  BASE_SEPOLIA_CHAIN_ID,
  IRYS_UPLOAD_TIMEOUT_MS,
  resolveIrysBundlerUrl,
} from '../constants.js';

export interface IrysClientOptions {
  chainId: number;
  privateKeyHex: string;
  rpcUrl: string;
  timeoutMs?: number;
}

/** Irys upload client for Base Sepolia (devnet) or Base mainnet. */
export async function createIrysClient(options: IrysClientOptions) {
  const builder = Uploader(BaseEth)
    .withWallet(options.privateKeyHex)
    .bundlerUrl(resolveIrysBundlerUrl(options.chainId))
    .withRpc(options.rpcUrl);

  const client =
    options.chainId === BASE_SEPOLIA_CHAIN_ID ? await builder.devnet() : await builder;

  const timeoutMs = options.timeoutMs ?? IRYS_UPLOAD_TIMEOUT_MS;
  if (client.api?.applyConfig !== undefined && client.api?.getConfig !== undefined) {
    const currentConfig = client.api.getConfig();
    client.api.applyConfig({
      ...currentConfig,
      url: client.url ?? currentConfig.url,
      timeout: timeoutMs,
    });
  }

  return client;
}

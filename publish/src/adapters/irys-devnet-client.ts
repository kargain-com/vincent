import { Uploader } from '@irys/upload';
import { BaseEth } from '@irys/upload-ethereum';

import { IRYS_DEVNET_BUNDLER_URL, IRYS_UPLOAD_TIMEOUT_MS } from '../constants.js';

export interface IrysDevnetClientOptions {
  privateKeyHex: string;
  rpcUrl: string;
  timeoutMs?: number;
}

/** Shared Irys devnet client — Base ETH on Base Sepolia (same as Kargain). */
export async function createIrysDevnetClient(options: IrysDevnetClientOptions) {
  const client = await Uploader(BaseEth)
    .withWallet(options.privateKeyHex)
    .bundlerUrl(IRYS_DEVNET_BUNDLER_URL)
    .withRpc(options.rpcUrl)
    .devnet();

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

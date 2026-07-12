import { Uploader } from '@irys/upload';
import { BaseEth } from '@irys/upload-ethereum';

import { IRYS_DEVNET_BUNDLER_URL } from '../constants.js';

export interface IrysDevnetClientOptions {
  privateKeyHex: string;
  rpcUrl: string;
}

/** Shared Irys devnet client — Base ETH on Base Sepolia (same as Kargain). */
export async function createIrysDevnetClient(options: IrysDevnetClientOptions) {
  return Uploader(BaseEth)
    .withWallet(options.privateKeyHex)
    .bundlerUrl(IRYS_DEVNET_BUNDLER_URL)
    .withRpc(options.rpcUrl)
    .devnet();
}

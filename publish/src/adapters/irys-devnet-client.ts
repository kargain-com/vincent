import { Uploader } from '@irys/upload';
import { Ethereum } from '@irys/upload-ethereum';

export interface IrysDevnetClientOptions {
  privateKeyHex: string;
  rpcUrl: string;
}

/** Shared Irys devnet client (founder-run CLI and preflight only). */
export async function createIrysDevnetClient(options: IrysDevnetClientOptions) {
  return Uploader(Ethereum)
    .withWallet(options.privateKeyHex)
    .withRpc(options.rpcUrl)
    .devnet();
}

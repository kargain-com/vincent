import { readFileSync } from 'node:fs';

/** P-1 Hardhat test key — dev/validation default only; never use for production genesis. */
export const DEFAULT_TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cab039431e99c5825582831';

export function loadSigningPrivateKey(): string {
  const keyFile = process.env.VINCENT_SEED_PRIVATE_KEY_FILE;
  if (keyFile !== undefined && keyFile.length > 0) {
    const contents = readFileSync(keyFile, 'utf8').trim();
    if (contents.length === 0) {
      throw new Error(`Empty signing key file: ${keyFile}`);
    }
    return contents.startsWith('0x') ? contents : `0x${contents}`;
  }

  const keyHex = process.env.VINCENT_SEED_PRIVATE_KEY;
  if (keyHex !== undefined && keyHex.length > 0) {
    return keyHex.startsWith('0x') ? keyHex : `0x${keyHex}`;
  }

  return DEFAULT_TEST_PRIVATE_KEY;
}

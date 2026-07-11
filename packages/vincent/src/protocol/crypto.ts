import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/** SHA-256 digest as lowercase hex (no prefix). */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/** Keccak-256 digest as lowercase hex (no prefix). */
export function keccak256Hex(bytes: Uint8Array): string {
  return bytesToHex(keccak_256(bytes));
}

function applyChecksum(lowerHex: string): string {
  const hash = keccak256Hex(new TextEncoder().encode(lowerHex));
  let result = '0x';
  for (let i = 0; i < 40; i++) {
    const hashNibble = parseInt(hash[i], 16);
    const char = lowerHex[i];
    result += hashNibble >= 8 ? char.toUpperCase() : char;
  }
  return result;
}

/** Apply EIP-55 mixed-case checksum to a 0x-prefixed address. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  if (lower.length !== 40 || !/^[0-9a-f]{40}$/.test(lower)) {
    throw new RangeError('Invalid address length or characters');
  }
  return applyChecksum(lower);
}

function normalizeHexKey(hex: string): Uint8Array {
  let stripped = hex.replace(/^0x/, '');
  if (stripped.length % 2 !== 0) {
    stripped = `0${stripped}`;
  }
  if (stripped.length > 64) {
    throw new RangeError('Private key must be at most 32 bytes');
  }
  stripped = stripped.padStart(64, '0');
  return hexToBytes(stripped);
}

/** Derive EIP-55 checksummed address from a secp256k1 private key hex string. */
export function addressFromPrivateKey(privateKeyHex: string): string {
  const keyBytes = normalizeHexKey(privateKeyHex);
  const publicKey = secp256k1.getPublicKey(keyBytes, false);
  const hash = keccak_256(publicKey.slice(1));
  const address = `0x${bytesToHex(hash.slice(-20))}`;
  return toChecksumAddress(address);
}

function eip191MessageHash(message: string): Uint8Array {
  const messageBytes = new TextEncoder().encode(message);
  const prefix = `\x19Ethereum Signed Message:\n${String(messageBytes.length)}`;
  const prefixBytes = new TextEncoder().encode(prefix);
  const payload = new Uint8Array(prefixBytes.length + messageBytes.length);
  payload.set(prefixBytes);
  payload.set(messageBytes, prefixBytes.length);
  return keccak_256(payload);
}

/** EIP-191 personal_sign over UTF-8 signing payload; returns 0x + 130 hex chars. */
export function signPersonalMessage(message: string, privateKeyHex: string): string {
  const keyBytes = normalizeHexKey(privateKeyHex);
  const hash = eip191MessageHash(message);
  const signature = secp256k1.sign(hash, keyBytes);
  const compact = signature.toCompactRawBytes();
  /* v8 ignore next -- noble secp256k1 always supplies recovery in practice */
  const recovery = signature.recovery ?? 0;
  const v = recovery + 27;
  return `0x${bytesToHex(compact)}${v.toString(16).padStart(2, '0')}`;
}

/** Recover EIP-55 address from personal_sign signature over message. */
export function recoverPersonalSignAddress(message: string, signatureHex: string): string {
  const sigBytes = hexToBytes(signatureHex.replace(/^0x/, ''));
  if (sigBytes.length !== 65) {
    throw new RangeError('Signature must be 65 bytes');
  }
  const r = sigBytes.slice(0, 32);
  const s = sigBytes.slice(32, 64);
  const v = sigBytes[64];
  const recovery = v >= 27 ? v - 27 : v;
  const hash = eip191MessageHash(message);
  const sig = secp256k1.Signature.fromCompact(bytesToHex(r) + bytesToHex(s)).addRecoveryBit(
    recovery,
  );
  const publicKey = sig.recoverPublicKey(hash);
  const addressHash = keccak_256(publicKey.toRawBytes(false).slice(1));
  const address = `0x${bytesToHex(addressHash.slice(-20))}`;
  return toChecksumAddress(address);
}

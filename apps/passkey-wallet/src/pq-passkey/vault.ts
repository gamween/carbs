// The ML-DSA-44 seed of the post-quantum account, sealed in this browser under a key derived
// from the passkey's PRF output (released only after Touch ID). The passkey itself is never on
// the ledger: the account's authority is the ML-DSA key (its RegularKey).

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import {
  isPqVault,
  kMlDsa44SignatureLength,
  mlDsaKeyPairFromSeed,
  type PqVault,
} from "@carbs/sessions";
import { type XrplDefinitions, encodeForSigning } from "ripple-binary-codec";

import { bytesToHex, hexToBytes } from "../hex.ts";
import type { TxJson } from "../ledger.ts";

const STORAGE_KEY = "carbs.pqVault";

// The vault's crypto (PRF secret -> HKDF-SHA256 -> AES-256-GCM, account as associated data) lives
// in @carbs/sessions, shared with the web app; this module keeps the wallet's storage and signing.
export { isPqVault, openSeed, sealSeed, type PqVault } from "@carbs/sessions";

function assertLength(bytes: Uint8Array, length: number, what: string): void {
  if (bytes.length !== length) throw new Error(`${what} must be ${length} bytes`);
}

export function loadVault(): PqVault | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;
  const parsed: unknown = JSON.parse(raw);
  if (!isPqVault(parsed))
    throw new Error("the stored PQ vault is unreadable; clear it to start again");
  return parsed;
}

export function saveVault(vault: PqVault): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

export function clearVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Signs with the ML-DSA-44 key of the seed: pure ML-DSA, empty context, over the bytes the node
 * verifies (`STX\0 ‖ signing fields`, i.e. encodeForSigning). The caller wipes the seed.
 */
export function signTxMlDsa(defs: XrplDefinitions, tx: TxJson, seed: Uint8Array): TxJson {
  const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
  try {
    const unsigned: TxJson = { ...tx, SigningPubKey: bytesToHex(publicKey) };
    const signature = ml_dsa44.sign(hexToBytes(encodeForSigning(unsigned, defs)), secretKey);
    assertLength(signature, kMlDsa44SignatureLength, "the ML-DSA-44 signature");
    return { ...unsigned, TxnSignature: bytesToHex(signature) };
  } finally {
    secretKey.fill(0);
  }
}

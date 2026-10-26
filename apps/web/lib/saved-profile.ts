/**
 * The account a page reload must not forget: what the screens need to find it on the node
 * again. Address, profile, node and the public key of the account's own authority, the
 * ML-DSA-44 key (the Stax's, or the Mac account's). For a Mac account also its sealed vault:
 * the ML-DSA-44 seed encrypted under the passkey's PRF secret (AES-256-GCM), which opens only
 * after Touch ID and is the only copy of that key. Never a key in clear, never a session key:
 * session keys live for one session in one page.
 */
import { isPqVault, type PqVault } from "@carbs/sessions";
import type { KeyAlgorithm } from "./ports";
import type { ChoiceStorage } from "./node-choice";

/** One profile per node: the local node's account and the team node's are both remembered. */
export function profileStorageKey(node: string): string {
  return `carbs-profile:${node}`;
}
/** 2: the Mac account became the PRF vault account (version 1 held a P-256 passkey). */
const SAVED_PROFILE_VERSION = 2;

/** A public key and its address. */
export interface SavedKey {
  algorithm: KeyAlgorithm;
  publicKey: string;
  address: string;
}

export interface SavedProfile {
  version: typeof SAVED_PROFILE_VERSION;
  /** The node the account lives on (its URL); a profile of another node is not restored. */
  node: string;
  /** Only these two survive a reload: a demo account's master key is thrown away with the page. */
  profile: "mac" | "ledger";
  address: string;
  /** Ledger accounts: the real Stax over USB, whose keys outlive the page. */
  device: "usb" | null;
  /** The account's own authority: the ML-DSA-44 key, as its regular key. */
  authority: SavedKey;
  /** Mac accounts: the sealed ML-DSA-44 seed. */
  vault: PqVault | null;
}

const ALGORITHMS: readonly KeyAlgorithm[] = ["secp256k1", "p256", "mldsa44"];
const HEX = /^[0-9A-Fa-f]+$/;
const ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlgorithm(value: unknown): value is KeyAlgorithm {
  return ALGORITHMS.some((known) => known === value);
}

function savedKey(value: unknown): SavedKey | null {
  if (!isRecord(value)) return null;
  const { algorithm, publicKey, address } = value;
  if (!isAlgorithm(algorithm)) return null;
  if (typeof publicKey !== "string" || !HEX.test(publicKey)) return null;
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  return { algorithm, publicKey, address };
}

/** The saved profile, checked field by field; anything else (or nothing) is null. */
export function parseSavedProfile(text: string | null): SavedProfile | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value["version"] !== SAVED_PROFILE_VERSION) return null;
  const { node, profile, address, device, vault } = value;
  const authority = savedKey(value["authority"]);
  if (typeof node !== "string" || node === "") return null;
  if (profile !== "mac" && profile !== "ledger") return null;
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  if (device !== "usb" && device !== null) return null;
  if (authority === null) return null;
  // A Mac account needs its vault, sealed for this very account; a Ledger account has none.
  let sealed: PqVault | null = null;
  if (profile === "mac") {
    if (!isPqVault(vault) || vault.account !== address) return null;
    sealed = {
      version: vault.version,
      credentialId: vault.credentialId,
      account: vault.account,
      mlDsaAddress: vault.mlDsaAddress,
      publicKey: vault.publicKey,
      salt: vault.salt,
      iv: vault.iv,
      ciphertext: vault.ciphertext,
    };
  } else if (vault !== null) return null;
  return {
    version: SAVED_PROFILE_VERSION,
    node,
    profile,
    address,
    device,
    authority,
    vault: sealed,
  };
}

export function newSavedProfile(fields: Omit<SavedProfile, "version">): SavedProfile {
  return { version: SAVED_PROFILE_VERSION, ...fields };
}

/**
 * The profile saved for `node`; one whose own `node` field differs is not used. Storage can be
 * blocked (private window, site data off): the profile then lasts for the page.
 */
export function readSavedProfile(storage: ChoiceStorage | null, node: string): SavedProfile | null {
  try {
    const saved = parseSavedProfile(storage?.getItem(profileStorageKey(node)) ?? null);
    return saved?.node === node ? saved : null;
  } catch {
    return null;
  }
}

export function writeSavedProfile(storage: ChoiceStorage | null, profile: SavedProfile): void {
  try {
    storage?.setItem(profileStorageKey(profile.node), JSON.stringify(profile));
  } catch {
    // Blocked storage: nothing survives the reload, as before.
  }
}

export function clearSavedProfile(storage: ChoiceStorage | null, node: string): void {
  try {
    storage?.removeItem(profileStorageKey(node));
  } catch {
    // Nothing saved, or storage blocked.
  }
}

/**
 * A Mac account's vault is the only copy of its ML-DSA-44 key: besides the profile, which a new
 * setup or a disconnect replaces, it is kept under its account's own key, which the page never
 * removes.
 */
export function vaultStorageKey(account: string): string {
  return `carbs-vault:${account}`;
}

/** Keeps the vault under its account's key; true when it reads back unchanged. */
export function archiveVault(storage: ChoiceStorage | null, vault: PqVault): boolean {
  try {
    const text = JSON.stringify(vault);
    storage?.setItem(vaultStorageKey(vault.account), text);
    return storage?.getItem(vaultStorageKey(vault.account)) === text;
  } catch {
    return false;
  }
}

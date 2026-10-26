/**
 * The account a page reload must not forget: what the screens need to find it on the node
 * again, and nothing that signs. Address, profile, node and the public key of the account's
 * own authority (the Stax's ML-DSA-44 key, or the passkey's public key and credential id).
 * Never a seed, a private key or a session key: session keys are non-extractible WebCrypto
 * keys (or ML-DSA-44 keys kept in memory) and live for one session in one page.
 */
import type { KeyAlgorithm } from "./ports";
import type { ChoiceStorage } from "./node-choice";

/** One profile per node: the local node's account and the team node's are both remembered. */
export function profileStorageKey(node: string): string {
  return `carbs-profile:${node}`;
}
const SAVED_PROFILE_VERSION = 1;

/** A public key, with its credential id for a passkey. */
export interface SavedKey {
  algorithm: KeyAlgorithm;
  publicKey: string;
  address: string;
  credentialId?: string;
}

export interface SavedProfile {
  version: typeof SAVED_PROFILE_VERSION;
  /** The node the account lives on (its URL); a profile of another node is not restored. */
  node: string;
  /** Only these two survive a reload: a demo account's master key is thrown away with the page. */
  profile: "mac" | "ledger";
  address: string;
  passkeyOnly: boolean;
  /** Ledger accounts: the real Stax over USB, whose keys outlive the page. */
  device: "usb" | null;
  /** The account's own authority: the device's ML-DSA-44 key or the passkey. */
  authority: SavedKey;
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
  const { algorithm, publicKey, address, credentialId } = value;
  if (!isAlgorithm(algorithm)) return null;
  if (typeof publicKey !== "string" || !HEX.test(publicKey)) return null;
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  if (credentialId !== undefined && (typeof credentialId !== "string" || !HEX.test(credentialId)))
    return null;
  const key: SavedKey = { algorithm, publicKey, address };
  if (credentialId !== undefined) key.credentialId = credentialId;
  return key;
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
  const { node, profile, address, passkeyOnly, device } = value;
  const authority = savedKey(value["authority"]);
  if (typeof node !== "string" || node === "") return null;
  if (profile !== "mac" && profile !== "ledger") return null;
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  if (typeof passkeyOnly !== "boolean") return null;
  if (device !== "usb" && device !== null) return null;
  if (authority === null) return null;
  return { version: SAVED_PROFILE_VERSION, node, profile, address, passkeyOnly, device, authority };
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

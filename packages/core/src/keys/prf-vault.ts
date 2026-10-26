/**
 * A post-quantum account unlocked by a passkey's WebAuthn PRF output (moved here from
 * `apps/passkey-wallet/src/pq-passkey`, PR #106, so the wallet and the web app share it).
 *
 * The passkey is used only as a PRF oracle and is never registered on the ledger. After the
 * person's user verification (Touch ID), the PRF extension returns a per-credential 32-byte
 * secret, HMAC(credential secret, salt). `HKDF-SHA256(secret, info "carbs pq vault v1")` gives a
 * non-extractable AES-256-GCM key that seals the 32-byte ML-DSA-44 seed, with the account's
 * address as associated data, so a vault moved to another account does not open.
 *
 * Why PRF: a platform authenticator such as Apple's cannot create an ML-DSA-44 (COSE -48)
 * credential, so the PRF secret is the only way to bind a post-quantum key to Touch ID there.
 * PRF with a real Touch ID has not been verified by this project; a virtual authenticator with
 * PRF has (`apps/passkey-wallet`).
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { addressFromPublicKey } from "../address.js";
import { bytesToHex, hexToBytes } from "../bytes.js";
import { kMlDsa44PublicKeyLength, kMlDsa44SeedLength } from "../constants.js";
import { KeyError } from "./classic.js";
import { mlDsaKeyPairFromSeed } from "./mldsa.js";

export const kPrfVaultVersion = 1;
/** The PRF output is HMAC-SHA-256: 32 bytes. */
export const kPrfSecretLength = 32;
/** The PRF input (salt) of the vault. */
export const kPrfSaltLength = 32;
const kGcmIvLength = 12;
const kGcmTagLength = 16;
const kAesKeyBits = 256;
const kHexCharsPerByte = 2;
const kHkdfInfo = new TextEncoder().encode("carbs pq vault v1");
/** No HKDF salt: the PRF output is already a uniform per-credential secret. */
const kHkdfSalt = new Uint8Array(0);

export interface PqVault {
  version: typeof kPrfVaultVersion;
  /** The PRF passkey's credential id, base64url. */
  credentialId: string;
  /** The account the seed belongs to: the AES-GCM associated data. */
  account: string;
  /** The address of the ML-DSA-44 key (the account's RegularKey). */
  mlDsaAddress: string;
  /** Hex, 1 312 bytes. */
  publicKey: string;
  /** Hex, 32 bytes: the PRF input. */
  salt: string;
  /** Hex, 12 bytes. */
  iv: string;
  /** Hex: AES-256-GCM of the 32-byte seed, with its tag. */
  ciphertext: string;
}

/** The browser or the authenticator does not give a PRF secret. */
export class PrfUnsupportedError extends Error {
  override readonly name = "PrfUnsupportedError";
}

function assertLength(bytes: Uint8Array, length: number, what: string): void {
  if (bytes.length !== length) throw new KeyError(`${what} must be ${length} bytes`);
}

/** HKDF-SHA256(prfSecret, info "carbs pq vault v1") -> non-extractable AES-256-GCM key. */
async function vaultKey(prfSecret: Uint8Array): Promise<CryptoKey> {
  assertLength(prfSecret, kPrfSecretLength, "the PRF secret");
  const secret = new Uint8Array(prfSecret);
  try {
    const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    return await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: kHkdfSalt, info: kHkdfInfo },
      material,
      { name: "AES-GCM", length: kAesKeyBits },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    secret.fill(0);
  }
}

const associatedData = (account: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(account));

const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export async function sealSeed(
  prfSecret: Uint8Array,
  seed: Uint8Array,
  meta: { credentialId: string; account: string; salt: Uint8Array },
): Promise<PqVault> {
  assertLength(seed, kMlDsa44SeedLength, "the ML-DSA seed");
  assertLength(meta.salt, kPrfSaltLength, "the PRF salt");
  const { publicKey, secretKey } = mlDsaKeyPairFromSeed(seed);
  secretKey.fill(0);
  const key = await vaultKey(prfSecret);
  const iv = crypto.getRandomValues(new Uint8Array(kGcmIvLength));
  const plaintext = new Uint8Array(seed);
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(meta.account) },
      key,
      plaintext,
    );
    return {
      version: kPrfVaultVersion,
      credentialId: meta.credentialId,
      account: meta.account,
      mlDsaAddress: addressFromPublicKey(publicKey),
      publicKey: bytesToHex(publicKey),
      salt: bytesToHex(meta.salt),
      iv: bytesToHex(iv),
      ciphertext: bytesToHex(new Uint8Array(ciphertext)),
    };
  } finally {
    plaintext.fill(0);
  }
}

/** The 32-byte seed; throws when the secret, the account or the ciphertext does not match. */
export async function openSeed(prfSecret: Uint8Array, vault: PqVault): Promise<Uint8Array> {
  const key = await vaultKey(prfSecret);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: view(hexToBytes(vault.iv)),
        additionalData: associatedData(vault.account),
      },
      key,
      view(hexToBytes(vault.ciphertext)),
    );
  } catch (error) {
    throw new KeyError(
      "the vault does not open with this passkey (wrong secret, other account or altered record)",
      { cause: error },
    );
  }
  const seed = new Uint8Array(plaintext);
  if (seed.length !== kMlDsa44SeedLength) {
    seed.fill(0);
    throw new KeyError("the vault holds no ML-DSA seed");
  }
  return seed;
}

function isHexOfLength(value: unknown, bytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length === bytes * kHexCharsPerByte &&
    /^[0-9a-fA-F]*$/.test(value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A stored vault, checked field by field. */
export function isPqVault(value: unknown): value is PqVault {
  if (typeof value !== "object" || value === null) return false;
  const field = (name: keyof PqVault): unknown => Reflect.get(value, name);
  return (
    field("version") === kPrfVaultVersion &&
    isNonEmptyString(field("credentialId")) &&
    isNonEmptyString(field("account")) &&
    isNonEmptyString(field("mlDsaAddress")) &&
    isHexOfLength(field("publicKey"), kMlDsa44PublicKeyLength) &&
    isHexOfLength(field("salt"), kPrfSaltLength) &&
    isHexOfLength(field("iv"), kGcmIvLength) &&
    isHexOfLength(field("ciphertext"), kMlDsa44SeedLength + kGcmTagLength)
  );
}

/* ---- the PRF oracle: the browser's passkey, or a software double ---- */

/** A passkey used as a PRF oracle. */
export interface PrfOracle {
  /** True for the software double: nothing it returns comes from an authenticator (SIMULATED). */
  readonly simulated: boolean;
  /** Creates the PRF passkey (one user verification); returns its credential id, base64url. */
  create(accountName: string): Promise<string>;
  /** The 32-byte PRF secret for `salt` (one user verification); the caller wipes it. */
  evaluate(credentialId: string, salt: Uint8Array): Promise<Uint8Array>;
}

/** COSE algorithms offered at creation; the key itself never signs anything that counts. */
const kEs256 = -7;
const kRs256 = -257;
const kCeremonyTimeoutMs = 60_000;
const kUserIdLength = 16;
const kChallengeLength = 32;
const kNotAllowedError = "NotAllowedError";
const kBase64Block = 4;

function bytesToBase64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  if (/[^A-Za-z0-9_-]/.test(text)) throw new KeyError("passkey id is not base64url");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / kBase64Block) * kBase64Block, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The person cancelled, refused or let the prompt time out. */
export class PrfCancelledError extends Error {
  override readonly name = "PrfCancelledError";
}

/** What the oracle reads from a credential: its id and its extension results. */
interface PrfCredential {
  rawId: ArrayBuffer;
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
}

function isPrfCredential(value: unknown): value is PrfCredential {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "rawId") instanceof ArrayBuffer &&
    typeof Reflect.get(value, "getClientExtensionResults") === "function"
  );
}

async function ceremony(run: () => Promise<Credential | null>): Promise<PrfCredential> {
  let credential: Credential | null;
  try {
    credential = await run();
  } catch (error) {
    if (error instanceof DOMException && error.name === kNotAllowedError) {
      throw new PrfCancelledError("the passkey prompt was cancelled, refused or timed out", {
        cause: error,
      });
    }
    throw error;
  }
  if (!isPrfCredential(credential)) {
    throw new KeyError("the authenticator returned no public-key credential");
  }
  return credential;
}

export interface BrowserPrfOptions {
  rpId: string;
  rpName: string;
}

/**
 * The browser's passkey as a PRF oracle (`navigator.credentials`). Real WebAuthn: it opens the
 * platform prompt, so it runs only from a click. Some platforms (iCloud Keychain) answer
 * `prf.enabled: true` at creation without results: the secret then comes from `get()` only.
 */
export function browserPrfOracle(
  container: CredentialsContainer,
  options: BrowserPrfOptions,
): PrfOracle {
  return {
    simulated: false,
    async create(accountName) {
      const created = await ceremony(() =>
        container.create({
          publicKey: {
            rp: { name: options.rpName, id: options.rpId },
            user: {
              id: crypto.getRandomValues(new Uint8Array(kUserIdLength)),
              name: accountName,
              displayName: accountName,
            },
            challenge: crypto.getRandomValues(new Uint8Array(kChallengeLength)),
            pubKeyCredParams: [
              { type: "public-key", alg: kEs256 },
              { type: "public-key", alg: kRs256 },
            ],
            authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
            attestation: "none",
            timeout: kCeremonyTimeoutMs,
            extensions: { prf: {} },
          },
        }),
      );
      if (created.getClientExtensionResults().prf?.enabled !== true) {
        throw new PrfUnsupportedError(
          "the passkey was created, but the authenticator does not enable the PRF extension: it cannot protect a post-quantum key",
        );
      }
      return bytesToBase64url(new Uint8Array(created.rawId));
    },
    async evaluate(credentialId, salt) {
      const asserted = await ceremony(() =>
        container.get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(kChallengeLength)),
            rpId: options.rpId,
            allowCredentials: [{ type: "public-key", id: base64urlToBytes(credentialId) }],
            userVerification: "required",
            timeout: kCeremonyTimeoutMs,
            extensions: { prf: { eval: { first: view(salt) } } },
          },
        }),
      );
      const first = asserted.getClientExtensionResults().prf?.results?.first;
      if (first === undefined) {
        throw new PrfUnsupportedError(
          "the passkey returned no PRF secret: nothing can be unlocked",
        );
      }
      const secret =
        first instanceof ArrayBuffer
          ? new Uint8Array(first.slice(0))
          : new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice();
      if (secret.length !== kPrfSecretLength) {
        secret.fill(0);
        throw new PrfUnsupportedError(
          `unexpected PRF secret length (${secret.length} bytes instead of ${kPrfSecretLength})`,
        );
      }
      return secret;
    },
  };
}

/** Whether the browser says it supports PRF; true when it cannot tell (the ceremony will). */
export async function browserPrfAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === "undefined") return false;
  if (!("getClientCapabilities" in PublicKeyCredential)) return true;
  const capabilities = await PublicKeyCredential.getClientCapabilities();
  return capabilities["extension:prf"] ?? true;
}

const kSoftwareCredentialIdLength = 16;

/**
 * A software PRF oracle: HMAC-SHA-256(per-credential secret, salt), as the CTAP2 hmac-secret
 * behind WebAuthn PRF computes it. No authenticator, no prompt: tests and the simulation only,
 * and everything it unlocks is SIMULATED. Its secrets live in memory and die with the object.
 */
export class SoftwarePrfOracle implements PrfOracle {
  readonly simulated = true;
  readonly #secrets = new Map<string, Uint8Array>();

  async create(_accountName: string): Promise<string> {
    const id = bytesToBase64url(
      crypto.getRandomValues(new Uint8Array(kSoftwareCredentialIdLength)),
    );
    this.#secrets.set(id, crypto.getRandomValues(new Uint8Array(kPrfSecretLength)));
    return id;
  }

  async evaluate(credentialId: string, salt: Uint8Array): Promise<Uint8Array> {
    const secret = this.#secrets.get(credentialId);
    if (secret === undefined) throw new KeyError("unknown PRF passkey");
    return hmac(sha256, secret, salt);
  }
}

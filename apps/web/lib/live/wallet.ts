/**
 * The wallet of the live backend, on `@carbs/sessions`: real keys, signatures over the binary
 * signing data of the node's own definitions.
 * - master key: a secp256k1 key from a fresh family seed, kept in memory, used only to set the
 *   account up (the setup then disables it);
 * - the Mac account's key: an ML-DSA-44 seed sealed under a passkey's WebAuthn PRF secret
 *   (`sealSeed`, HKDF-SHA256 then AES-256-GCM, the account address as associated data), opened
 *   for each signature after Touch ID; the passkey never reaches the ledger;
 * - session keys: ML-DSA-44, generated here, a fresh one per session.
 */
import {
  addressFromPublicKey,
  bytesToHex,
  classicSignerFromSeed,
  generateClassicSeed,
  generateMlDsaSeed,
  hexToBytes,
  kPrfSaltLength,
  mlDsaSignerFromSeed,
  openSeed,
  sealSeed,
  signTransaction,
  type BytesSigner,
  type Definitions,
  type PqVault,
} from "@carbs/sessions";
import type { KeyAlgorithm, KeyHandle, TxJson, VaultKey, WalletPort } from "../ports";
import type { PrfSource } from "../wallets/prf";
import { fromCoreTx } from "./result";

function handleFor(algorithm: KeyAlgorithm, signer: BytesSigner, defs: Definitions): KeyHandle {
  return {
    algorithm,
    publicKey: bytesToHex(signer.publicKey),
    address: addressFromPublicKey(signer.publicKey),
    async sign(tx) {
      return fromCoreTx((await signTransaction(tx, signer, defs)).tx);
    },
  };
}

export class LiveWallet implements WalletPort {
  readonly mode = "live" as const;

  constructor(
    private readonly defs: Definitions,
    private readonly prf: PrfSource,
  ) {}

  get prfSimulated(): boolean {
    return this.prf.simulated;
  }

  async createMasterKey(): Promise<KeyHandle> {
    const signer = classicSignerFromSeed(generateClassicSeed("ecdsa-secp256k1"));
    return handleFor("secp256k1", signer, this.defs);
  }

  async createVaultKey(account: string): Promise<VaultKey> {
    // The passkey first, while the click's user activation lasts.
    const credentialId = await this.prf.oracle.create(`carbs ${account.slice(0, 8)}`);
    const salt = crypto.getRandomValues(new Uint8Array(kPrfSaltLength));
    const secret = await this.prf.oracle.evaluate(credentialId, salt);
    let seed: Uint8Array | null = generateMlDsaSeed();
    let vault: PqVault;
    try {
      vault = await sealSeed(secret, seed, { credentialId, account, salt });
    } catch (error) {
      seed.fill(0);
      throw error;
    } finally {
      secret.fill(0);
    }
    const unlocked = this.openVaultKey(vault);
    const defs = this.defs;
    const key: KeyHandle = {
      ...unlocked,
      async sign(tx: TxJson) {
        if (seed === null) return unlocked.sign(tx);
        return fromCoreTx((await signTransaction(tx, mlDsaSignerFromSeed(seed), defs)).tx);
      },
    };
    return {
      vault,
      key,
      wipe() {
        seed?.fill(0);
        seed = null;
      },
    };
  }

  openVaultKey(vault: PqVault): KeyHandle {
    const { prf, defs } = this;
    // The address comes from the sealed public key, not from the vault's own record of it.
    const address = addressFromPublicKey(vault.publicKey);
    if (address !== vault.mlDsaAddress) {
      throw new Error("The sealed key's public key does not match the address it was saved with");
    }
    return {
      algorithm: "mldsa44",
      publicKey: vault.publicKey,
      address,
      async sign(tx) {
        const secret = await prf.oracle.evaluate(vault.credentialId, hexToBytes(vault.salt));
        let seed: Uint8Array;
        try {
          seed = await openSeed(secret, vault);
        } finally {
          secret.fill(0);
        }
        try {
          return fromCoreTx((await signTransaction(tx, mlDsaSignerFromSeed(seed), defs)).tx);
        } finally {
          seed.fill(0);
        }
      },
    };
  }

  async createSessionKey(): Promise<KeyHandle> {
    return handleFor("mldsa44", mlDsaSignerFromSeed(generateMlDsaSeed()), this.defs);
  }
}

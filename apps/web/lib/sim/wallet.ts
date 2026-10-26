/**
 * SIMULATED browser wallet: the master key used to set an account up, the Mac account's key and
 * session keys. Master and session keys come from keys.ts (keyed digests, not cryptography).
 * The Mac account's ML-DSA-44 seed is sealed and opened with the real vault of
 * `@carbs/sessions` (HKDF-SHA256, AES-256-GCM, the account as associated data) under the PRF
 * secret of the software PRF double (SIMULATED: no passkey, no Touch ID); its simulated key is
 * derived from that seed, so every signature goes through the vault. The live wallet
 * (`lib/live/wallet.ts`) signs with real ML-DSA-44.
 */
import {
  bytesToHex,
  generateMlDsaSeed,
  hexToBytes,
  kPrfSaltLength,
  openSeed,
  sealSeed,
  SoftwarePrfOracle,
  type PqVault,
  type PrfOracle,
} from "@carbs/sessions";
import type { KeyAlgorithm, KeyHandle, TxJson, VaultKey, WalletPort } from "../ports";
import { accountIdOf, signWith, simPublicKey } from "./keys";

function handle(algorithm: KeyAlgorithm, publicKey: string): KeyHandle {
  return {
    algorithm,
    publicKey,
    address: accountIdOf(publicKey),
    async sign(tx: TxJson): Promise<TxJson> {
      return signWith(publicKey, tx);
    },
  };
}

/** The simulated ML-DSA-44 key of a vault's seed. */
function vaultPublicKey(seed: Uint8Array): string {
  return simPublicKey("mldsa44", `vault:${bytesToHex(seed)}`);
}

export class SimulatedWallet implements WalletPort {
  readonly mode = "simulated" as const;
  readonly prfSimulated = true;
  private counter = 0;
  /** Simulated vault keys, by the vault's ML-DSA address: the screens use the simulated key. */
  private readonly simKeys = new Map<string, string>();

  constructor(private readonly prf: PrfOracle = new SoftwarePrfOracle()) {}

  private next(label: string): string {
    this.counter += 1;
    return `wallet:${label}:${this.counter}`;
  }

  async createMasterKey(): Promise<KeyHandle> {
    return handle("secp256k1", simPublicKey("secp256k1", this.next("master")));
  }

  async createVaultKey(account: string): Promise<VaultKey> {
    const credentialId = await this.prf.create(`carbs ${account.slice(0, 8)}`);
    const salt = crypto.getRandomValues(new Uint8Array(kPrfSaltLength));
    const secret = await this.prf.evaluate(credentialId, salt);
    let seed: Uint8Array | null = generateMlDsaSeed();
    let vault: PqVault;
    try {
      vault = await sealSeed(secret, seed, { credentialId, account, salt });
    } finally {
      secret.fill(0);
    }
    const publicKey = vaultPublicKey(seed);
    this.simKeys.set(vault.mlDsaAddress, publicKey);
    const unlocked = this.openVaultKey(vault);
    return {
      vault,
      key: {
        ...unlocked,
        async sign(tx) {
          return seed === null ? unlocked.sign(tx) : signWith(publicKey, tx);
        },
      },
      wipe() {
        seed?.fill(0);
        seed = null;
      },
    };
  }

  openVaultKey(vault: PqVault): KeyHandle {
    const publicKey = this.simKeys.get(vault.mlDsaAddress);
    if (publicKey === undefined)
      throw new Error("This vault was not made in this page's simulation");
    const prf = this.prf;
    return {
      algorithm: "mldsa44",
      publicKey,
      address: accountIdOf(publicKey),
      async sign(tx) {
        const secret = await prf.evaluate(vault.credentialId, hexToBytes(vault.salt));
        let seed: Uint8Array;
        try {
          seed = await openSeed(secret, vault);
        } finally {
          secret.fill(0);
        }
        try {
          if (vaultPublicKey(seed) !== publicKey) throw new Error("The vault holds another key");
          return signWith(publicKey, tx);
        } finally {
          seed.fill(0);
        }
      },
    };
  }

  async createSessionKey(): Promise<KeyHandle> {
    return handle("mldsa44", simPublicKey("mldsa44", this.next("session")));
  }
}

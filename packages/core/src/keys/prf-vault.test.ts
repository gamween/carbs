import { describe, expect, it } from "vitest";
import { addressFromPublicKey } from "../address.js";
import { bytesToHex, hexToBytes } from "../bytes.js";
import { kMlDsa44SeedLength } from "../constants.js";
import { mlDsaKeyPairFromSeed } from "./mldsa.js";
import {
  PrfCancelledError,
  PrfUnsupportedError,
  SoftwarePrfOracle,
  browserPrfOracle,
  isPqVault,
  kPrfSaltLength,
  kPrfSecretLength,
  openSeed,
  sealSeed,
  type PqVault,
} from "./prf-vault.js";

const ACCOUNT = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
const OTHER_ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const CREDENTIAL_ID = "Y3JlZGVudGlhbA";

const random = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

async function sealed(): Promise<{ prfSecret: Uint8Array; seed: Uint8Array; vault: PqVault }> {
  const prfSecret = random(kPrfSecretLength);
  const seed = random(kMlDsa44SeedLength);
  const vault = await sealSeed(prfSecret, seed, {
    credentialId: CREDENTIAL_ID,
    account: ACCOUNT,
    salt: random(kPrfSaltLength),
  });
  return { prfSecret, seed, vault };
}

describe("PRF vault", () => {
  it("opens what it sealed and records the ML-DSA-44 key of the seed", async () => {
    const { prfSecret, seed, vault } = await sealed();
    const { publicKey } = mlDsaKeyPairFromSeed(seed);
    expect(isPqVault(vault)).toBe(true);
    expect(vault.account).toBe(ACCOUNT);
    expect(vault.publicKey).toBe(bytesToHex(publicKey));
    expect(vault.mlDsaAddress).toBe(addressFromPublicKey(publicKey));
    expect(hexToBytes(vault.iv)).toHaveLength(12);
    expect(vault.ciphertext).not.toContain(bytesToHex(seed));
    expect(await openSeed(prfSecret, vault)).toEqual(seed);
  });

  it("refuses another PRF secret, an altered ciphertext and another account (AAD)", async () => {
    const { prfSecret, vault } = await sealed();
    await expect(openSeed(random(kPrfSecretLength), vault)).rejects.toThrow(/does not open/);
    const bytes = hexToBytes(vault.ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    await expect(openSeed(prfSecret, { ...vault, ciphertext: bytesToHex(bytes) })).rejects.toThrow(
      /does not open/,
    );
    await expect(openSeed(prfSecret, { ...vault, account: OTHER_ACCOUNT })).rejects.toThrow(
      /other account/,
    );
  });

  it("refuses secrets, seeds and salts of the wrong size, and malformed records", async () => {
    await expect(
      sealSeed(random(16), random(kMlDsa44SeedLength), {
        credentialId: CREDENTIAL_ID,
        account: ACCOUNT,
        salt: random(kPrfSaltLength),
      }),
    ).rejects.toThrow(/PRF secret/);
    const { vault } = await sealed();
    expect(isPqVault({ ...vault, publicKey: "AB" })).toBe(false);
    expect(isPqVault({ ...vault, version: 2 })).toBe(false);
    expect(isPqVault(null)).toBe(false);
  });
});

describe("software PRF oracle (SIMULATED)", () => {
  it("gives the same 32-byte secret for the same salt, another for another salt", async () => {
    const oracle = new SoftwarePrfOracle();
    expect(oracle.simulated).toBe(true);
    const id = await oracle.create("carbs");
    const salt = random(kPrfSaltLength);
    const first = await oracle.evaluate(id, salt);
    expect(first).toHaveLength(kPrfSecretLength);
    expect(await oracle.evaluate(id, salt)).toEqual(first);
    expect(await oracle.evaluate(id, random(kPrfSaltLength))).not.toEqual(first);
    await expect(oracle.evaluate("other", salt)).rejects.toThrow(/unknown/);
  });
});

describe("browser PRF oracle", () => {
  /** A credentials container whose authenticator has no PRF: what a browser without it answers. */
  function noPrf(): CredentialsContainer {
    const credential = {
      id: "AQID",
      type: "public-key",
      rawId: new Uint8Array([1, 2, 3]).buffer,
      getClientExtensionResults: () => ({}),
    };
    return {
      create: async () => credential,
      get: async () => credential,
      preventSilentAccess: async () => undefined,
      store: async () => undefined,
    };
  }

  function cancelled(): CredentialsContainer {
    const refuse = async (): Promise<never> => {
      throw new DOMException(
        "The operation either timed out or was not allowed.",
        "NotAllowedError",
      );
    };
    return {
      create: refuse,
      get: refuse,
      preventSilentAccess: async () => undefined,
      store: refuse,
    };
  }

  it("says clearly when the authenticator gives no PRF", async () => {
    const oracle = browserPrfOracle(noPrf(), { rpId: "localhost", rpName: "carbs" });
    expect(oracle.simulated).toBe(false);
    await expect(oracle.create("carbs")).rejects.toBeInstanceOf(PrfUnsupportedError);
    await expect(oracle.create("carbs")).rejects.toThrow(/does not enable the PRF extension/);
    await expect(oracle.evaluate("AQID", random(kPrfSaltLength))).rejects.toThrow(/no PRF secret/);
  });

  it("says that the prompt was cancelled, not that PRF is missing", async () => {
    const oracle = browserPrfOracle(cancelled(), { rpId: "localhost", rpName: "carbs" });
    await expect(oracle.create("carbs")).rejects.toBeInstanceOf(PrfCancelledError);
  });
});

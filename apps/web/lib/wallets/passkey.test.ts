import { describe, expect, it } from "vitest";
import { bytesToHex } from "@carbs/sessions";
import { p256 } from "@noble/curves/nist.js";
import { browserPasskeySource, createBrowserPasskey, softwarePasskeySource } from "./passkey";
import { createAppContext } from "../app-context";
import { createWalletAdapters } from "./adapters";
import { WEBHID_MESSAGE } from "../browser-support";

/** The 26-byte SubjectPublicKeyInfo header of an uncompressed P-256 key. */
const SPKI_HEADER = Uint8Array.of(
  0x30,
  0x59,
  0x30,
  0x13,
  0x06,
  0x07,
  0x2a,
  0x86,
  0x48,
  0xce,
  0x3d,
  0x02,
  0x01,
  0x06,
  0x08,
  0x2a,
  0x86,
  0x48,
  0xce,
  0x3d,
  0x03,
  0x01,
  0x07,
  0x03,
  0x42,
  0x00,
);

describe("browser passkey creation", () => {
  it("turns the SPKI of the browser's credential into the XRPL passkey key (0xF6 ‖ X ‖ Y)", async () => {
    const raw = p256.getPublicKey(p256.utils.randomSecretKey(), false);
    const spki = new Uint8Array([...SPKI_HEADER, ...raw]);
    let seenRp = "";
    const container = {
      async create(options?: CredentialCreationOptions) {
        seenRp = options?.publicKey?.rp.id ?? "";
        return {
          rawId: new Uint8Array(16).fill(7).buffer,
          response: { getPublicKey: () => spki.buffer },
        };
      },
    } as unknown as CredentialsContainer;
    const key = await createBrowserPasskey(container, { id: "carbs.example", name: "carbs" });
    expect(seenRp).toBe("carbs.example");
    expect(key.algorithm).toBe("p256");
    expect(key.publicKey).toBe(`F6${bytesToHex(raw.subarray(1))}`);
  });

  it("refuses an authenticator that returns no key", async () => {
    const container = {
      async create() {
        return { response: {} };
      },
    } as unknown as CredentialsContainer;
    await expect(createBrowserPasskey(container, { id: "x", name: "x" })).rejects.toThrow(
      /no P-256/,
    );
  });

  it("is unavailable where the browser has no WebAuthn, and never prompts on its own", () => {
    expect(browserPasskeySource().available()).toBe(false);
    expect(browserPasskeySource().simulated).toBe(false);
    expect(softwarePasskeySource().simulated).toBe(true);
  });
});

describe("Ledger Stax availability", () => {
  it("offers the simulated Stax everywhere, the real one only on a live node with WebHID", async () => {
    const ctx = createAppContext();
    const host = {
      demo: ctx.demo,
      network: ctx.network,
      device: ctx.deviceSelection,
    };
    const simulation = createWalletAdapters(
      { ...host, backend: ctx.backend },
      softwarePasskeySource(),
    );
    const usb = (adapters: typeof simulation) => adapters.find((a) => a.id === "ledger-stax-usb");
    const double = (adapters: typeof simulation) =>
      adapters.find((a) => a.id === "ledger-stax-simulated");
    Object.defineProperty(navigator, "hid", { value: {}, configurable: true });
    try {
      expect(await double(simulation)?.isAvailable()).toBe(true);
      expect(await usb(simulation)?.isAvailable()).toBe(false);
      const live = createWalletAdapters(
        { ...host, backend: { ...ctx.backend, mode: "live" } },
        softwarePasskeySource(),
      );
      expect(await usb(live)?.isAvailable()).toBe(true);
      Reflect.deleteProperty(navigator, "hid");
      expect(await usb(live)?.isAvailable()).toBe(false);
      expect(await double(live)?.isAvailable()).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, "hid");
    }
    expect(WEBHID_MESSAGE).toContain("Use Chrome");
  });
});

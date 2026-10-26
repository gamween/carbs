import { SoftwareAuthenticator } from "@carbs/sessions";
import { describe, expect, it } from "vitest";
import { createSimBackend } from "./backend";
import { createDemo, OTHER_DEVICE_MESSAGE } from "./demo";
import { createLiveBackend } from "./live/backend";
import { FakeAlphaNet } from "./live/fake-alphanet";
import { NETWORKS } from "./networks";
import type { ChoiceStorage } from "./node-choice";
import type { Backend, DevicePort, ExposurePort, TxJson } from "./ports";
import { parseSavedProfile, profileStorageKey } from "./saved-profile";
import type { PasskeySource } from "./wallets/adapters";

const NODE = "wss://node.example.org";
const PROFILE_STORAGE_KEY = profileStorageKey(NODE);

/** A Map behind the storage surface of the browser. */
function memoryStorage(): ChoiceStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/**
 * The simulated Stax, behaving as a real one does on the points that matter here: it is not
 * the simulation (`mode` live), and a reset reads the same keys again instead of making new ones.
 */
function staxLike(device: DevicePort): DevicePort {
  return {
    mode: "live",
    model: "test Stax",
    getPublicKey: (algorithm) => device.getPublicKey(algorithm),
    review: (tx) => device.review(tx),
    reset: () => undefined,
    signTransaction: (algorithm, tx) => device.signTransaction(algorithm, tx),
  };
}

/** A simulated node and a Stax-like device, with every submission counted. */
function rig() {
  const sim = createSimBackend();
  sim.simDevice.setApprover(async () => true);
  const submitted: TxJson[] = [];
  const node = sim.simNode;
  const submit = node.submit.bind(node);
  node.submit = async (tx) => {
    submitted.push(tx);
    return submit(tx);
  };
  const backend: Backend = { ...sim, device: staxLike(sim.simDevice) };
  return { sim, backend, submitted };
}

describe("a Ledger account is the device's own", () => {
  it("is found already set up on a second run and used as it is, nothing sent", async () => {
    const { backend, submitted } = rig();
    const first = createDemo(backend);
    expect(await first.createAccount("ledger")).toBe(true);
    const address = first.state.address;
    expect(submitted.map((tx) => tx.TransactionType)).toEqual([
      "SetRegularKey",
      "AccountSet",
      "AccountSet",
    ]);

    submitted.length = 0;
    const second = createDemo(backend);
    expect(await second.createAccount("ledger")).toBe(true);
    expect(second.state.error).toBeNull();
    expect(second.state.ready).toBe(true);
    expect(second.state.address).toBe(address);
    expect(submitted).toEqual([]);
    expect(second.state.steps.map((step) => step.label).join("\n")).toContain("already set up");
  });

  it("finishes an account an earlier run left half-way, skipping what is done", async () => {
    const { sim, backend, submitted } = rig();
    let prompts = 0;
    // Approve SetRegularKey and the proof, refuse asfDisableMaster.
    sim.simDevice.setApprover(async () => (prompts += 1) < 3);
    const first = createDemo(backend);
    expect(await first.createAccount("ledger")).toBe(false);
    expect(first.state.error).toContain("Rejected on the device");

    sim.simDevice.setApprover(async () => true);
    submitted.length = 0;
    const second = createDemo(backend);
    expect(await second.createAccount("ledger")).toBe(true);
    expect(submitted.map((tx) => tx.TransactionType)).toEqual(["AccountSet", "AccountSet"]);
    const labels = second.state.steps.map((step) => step.label).join("\n");
    expect(labels).toContain("already on the node: no faucet");
    expect(labels).toContain("regular key is already the device's ML-DSA-44 key");
    expect(second.state.info?.masterDisabled).toBe(true);
  });

  it("uses the account already set up without funding or signing anything", async () => {
    const { backend, submitted } = rig();
    const before = createDemo(backend);
    expect(await before.useExistingLedgerAccount()).toBe(false);
    expect(before.state.error).toContain("does not exist on this node yet");

    expect(await createDemo(backend).createAccount("ledger")).toBe(true);
    submitted.length = 0;
    const demo = createDemo(backend);
    expect(await demo.useExistingLedgerAccount()).toBe(true);
    expect(demo.state.ready).toBe(true);
    expect(submitted).toEqual([]);
    // It can sign: the session opens with the device's ML-DSA-44 key.
    const opened = await demo.openSession({
      mode: "P",
      durationSec: 60,
      permissions: ["Payment"],
      capDrops: 0,
    });
    expect(opened?.code).toBe("tesSUCCESS");
  });

  it("does not use an account whose master key is still enabled", async () => {
    const { sim, backend } = rig();
    let prompts = 0;
    sim.simDevice.setApprover(async () => (prompts += 1) < 3);
    await createDemo(backend).createAccount("ledger");
    const demo = createDemo(backend);
    expect(await demo.useExistingLedgerAccount()).toBe(false);
    expect(demo.state.error).toContain("not set up yet");
    expect(demo.state.ready).toBe(false);
  });

  it("makes a new account on each setup with the simulated Stax, which makes new keys", async () => {
    const sim = createSimBackend();
    sim.simDevice.setApprover(async () => true);
    const demo = createDemo(sim);
    expect(await demo.createAccount("ledger")).toBe(true);
    const first = demo.state.address;
    expect(await demo.createAccount("ledger")).toBe(true);
    expect(demo.state.address).not.toBe(first);
  });
});

describe("the account across a page reload", () => {
  it("keeps the address and public key of a real Stax's account, and nothing that signs", async () => {
    const { backend } = rig();
    const storage = memoryStorage();
    const demo = createDemo(backend, { storage, nodeKey: NODE });
    expect(await demo.createAccount("ledger")).toBe(true);
    const text = storage.map.get(PROFILE_STORAGE_KEY) ?? "";
    const saved = parseSavedProfile(text);
    expect(saved).toMatchObject({
      node: NODE,
      profile: "ledger",
      address: demo.state.address,
      device: "usb",
      authority: { algorithm: "mldsa44", address: demo.state.info?.regularKey },
    });
    // Only these fields; no seed, private key or session key.
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(
      ["address", "authority", "device", "node", "passkeyOnly", "profile", "version"].sort(),
    );
    expect(Object.keys(JSON.parse(text).authority).sort()).toEqual([
      "address",
      "algorithm",
      "publicKey",
    ]);
    expect(text).not.toMatch(/seed|secret|private/i);
  });

  it("finds the account again after a reload, ready to open a session", async () => {
    const { backend, submitted } = rig();
    const storage = memoryStorage();
    const before = createDemo(backend, { storage, nodeKey: NODE });
    await before.createAccount("ledger");
    submitted.length = 0;

    const after = createDemo(backend, { storage, nodeKey: NODE });
    expect(after.state.ready).toBe(false);
    const restored = await after.restore();
    expect(restored?.device).toBe("usb");
    expect(after.state.ready).toBe(true);
    expect(after.state.address).toBe(before.state.address);
    expect(after.state.profile).toBe("ledger");
    expect(after.state.sessionKey).toBeNull();
    expect(submitted).toEqual([]);
    const opened = await after.openSession({
      mode: "C",
      durationSec: 60,
      permissions: [],
      capDrops: 5_000_000,
    });
    expect(opened?.code).toBe("tesSUCCESS");
  });

  it("refuses to sign with a Stax that holds other keys", async () => {
    const { sim, backend, submitted } = rig();
    const storage = memoryStorage();
    await createDemo(backend, { storage, nodeKey: NODE }).createAccount("ledger");
    const after = createDemo(backend, { storage, nodeKey: NODE });
    await after.restore();
    sim.simDevice.reset(); // another device: other keys
    submitted.length = 0;
    expect(
      await after.openSession({
        mode: "P",
        durationSec: 60,
        permissions: ["Payment"],
        capDrops: 0,
      }),
    ).toBeNull();
    expect(after.state.error).toBe(OTHER_DEVICE_MESSAGE);
    expect(submitted).toEqual([]);
  });

  it("keeps one account per node, and forgets one the node no longer agrees with", async () => {
    const { backend } = rig();
    const storage = memoryStorage();
    await createDemo(backend, { storage, nodeKey: NODE }).createAccount("ledger");
    const elsewhere = createDemo(backend, { storage, nodeKey: "ws://localhost:6006" });
    expect(await elsewhere.restore()).toBeNull();
    expect(elsewhere.state.ready).toBe(false);
    // The other node's account is still there for its next visit.
    expect(storage.map.has(PROFILE_STORAGE_KEY)).toBe(true);
    // A profile filed under this node but written for another one is not used.
    storage.map.set(
      profileStorageKey("ws://localhost:6006"),
      storage.map.get(PROFILE_STORAGE_KEY) ?? "",
    );
    expect(await elsewhere.restore()).toBeNull();

    // A new ledger (the node restarted): the account is not there.
    const fresh = rig().backend;
    const gone = createDemo(fresh, { storage, nodeKey: NODE });
    expect(await gone.restore()).toBeNull();
    expect(gone.state.error).toContain("not restored");
    expect(storage.map.has(PROFILE_STORAGE_KEY)).toBe(false);
  });

  it("keeps the profile when the node does not answer, to try at the next load", async () => {
    const { backend } = rig();
    const storage = memoryStorage();
    await createDemo(backend, { storage, nodeKey: NODE }).createAccount("ledger");
    const down: Backend = {
      ...backend,
      node: Object.assign(Object.create(backend.node) as typeof backend.node, {
        accountInfo: async () => {
          throw new Error("socket closed");
        },
      }),
    };
    const demo = createDemo(down, { storage, nodeKey: NODE });
    expect(await demo.restore()).toBeNull();
    expect(demo.state.error).toContain("socket closed");
    expect(storage.map.has(PROFILE_STORAGE_KEY)).toBe(true);
  });

  it("keeps nothing for a demo account or an account of the simulated Stax", async () => {
    const storage = memoryStorage();
    const sim = createSimBackend();
    sim.simDevice.setApprover(async () => true);
    const demo = createDemo(sim, { storage, nodeKey: NODE });
    expect(await demo.createAccount("demo")).toBe(true);
    expect(storage.map.size).toBe(0);
    expect(await demo.createAccount("ledger")).toBe(true);
    expect(storage.map.size).toBe(0);
    // The simulation's passkey (software authenticator) does not outlive the page either.
    expect(await demo.createAccount("mac")).toBe(true);
    expect(storage.map.size).toBe(0);
  });

  it("forgets the saved account on disconnect and when a new setup starts", async () => {
    const { backend } = rig();
    const storage = memoryStorage();
    const demo = createDemo(backend, { storage, nodeKey: NODE });
    await demo.createAccount("ledger");
    demo.disconnect();
    expect(storage.map.has(PROFILE_STORAGE_KEY)).toBe(false);
    await demo.createAccount("ledger");
    expect(await demo.createAccount("demo")).toBe(true);
    expect(storage.map.has(PROFILE_STORAGE_KEY)).toBe(false);
  });

  it("works with storage the browser blocks: the account then lasts for the page", async () => {
    const { backend } = rig();
    const blocked: ChoiceStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const demo = createDemo(backend, { storage: blocked, nodeKey: NODE });
    expect(await demo.createAccount("ledger")).toBe(true);
    expect(await createDemo(backend, { storage: blocked, nodeKey: NODE }).restore()).toBeNull();
  });
});

describe("a passkey account across a reload (live backend, test double node)", () => {
  const noExposure: ExposurePort = {
    mode: "live",
    async check() {
      throw new Error("not used");
    },
  };

  /** One software authenticator that outlives the "page", as the browser's platform one does. */
  function lastingPasskeys(): PasskeySource {
    const rpId = "carbs.invalid";
    const authenticator = new SoftwareAuthenticator(`https://${rpId}`);
    return {
      simulated: true,
      available: () => true,
      create: async () => {
        throw new Error("not used on the live backend");
      },
      material: async () => ({ credential: authenticator.credential, authenticator, rpId }),
      restore: (credential) => ({ credential, authenticator, rpId }),
    };
  }

  it("signs with the same passkey after the reload, by its credential id", async () => {
    const fake = new FakeAlphaNet({ sessions: true });
    const backend = await createLiveBackend({
      client: fake,
      network: () => ({ ...NETWORKS.local, faucet: "http://localhost:3005/accounts" }),
      approver: () => async () => true,
      passkeys: lastingPasskeys(),
      exposure: noExposure,
      fetcher: fake.faucet,
      sleep: async () => undefined,
    });
    const storage = memoryStorage();
    const before = createDemo(backend, { storage, nodeKey: NODE });
    expect(await before.createAccount("mac")).toBe(true);
    const saved = parseSavedProfile(storage.map.get(PROFILE_STORAGE_KEY) ?? null);
    expect(saved?.profile).toBe("mac");
    expect(saved?.authority.algorithm).toBe("p256");
    expect(saved?.authority.credentialId).toMatch(/^[0-9A-F]+$/i);

    const after = createDemo(backend, { storage, nodeKey: NODE });
    expect(await after.restore()).not.toBeNull();
    expect(after.state.ready).toBe(true);
    const opened = await after.openSession({
      mode: "P",
      durationSec: 60,
      permissions: ["Payment"],
      capDrops: 0,
    });
    expect(opened?.code).toBe("tesSUCCESS");
    const last = fake.accounts.get(after.state.address ?? "")?.history.at(-1);
    expect(last?.tx.TransactionType).toBe("SigningSessionSet");
    expect(last?.tx["PasskeySignature"]).toBeDefined();
  });
});

describe("the saved profile as read back", () => {
  const valid = {
    version: 1,
    node: NODE,
    profile: "ledger",
    address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    passkeyOnly: false,
    device: "usb",
    authority: {
      algorithm: "mldsa44",
      publicKey: "ABCD",
      address: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
    },
  };

  it("takes only the fields it knows, so nothing else is ever used", () => {
    const parsed = parseSavedProfile(JSON.stringify({ ...valid, seed: "s…", extra: 1 }));
    expect(parsed).toEqual(valid);
  });

  it("refuses anything malformed", () => {
    expect(parseSavedProfile(null)).toBeNull();
    expect(parseSavedProfile("{")).toBeNull();
    expect(parseSavedProfile(JSON.stringify({ ...valid, version: 2 }))).toBeNull();
    expect(parseSavedProfile(JSON.stringify({ ...valid, profile: "demo" }))).toBeNull();
    expect(parseSavedProfile(JSON.stringify({ ...valid, address: "not an address" }))).toBeNull();
    expect(
      parseSavedProfile(
        JSON.stringify({ ...valid, authority: { ...valid.authority, publicKey: "xyz" } }),
      ),
    ).toBeNull();
  });
});

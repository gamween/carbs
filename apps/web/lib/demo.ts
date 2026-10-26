/**
 * The demo store behind the five screens. It owns no ledger state: account, balance,
 * sessions and results are read back from the node after every action (spec 8.5:
 * "account state comes from the node, not local state"). It only remembers which keys it
 * holds and what it logged.
 */
import { reactive } from "vue";
import type { PqVault } from "@carbs/sessions";
import { xrpToDrops } from "./format";
import {
  DeviceRejectedError,
  type AccountInfo,
  type AccountObjects,
  type Backend,
  type DeviceKey,
  type KeyHandle,
  type NodeResult,
  type SessionParams,
  type UnsignedTx,
  type ServerInfo,
  type SessionEntry,
  type TxJson,
} from "./ports";
import type { ChoiceStorage } from "./node-choice";
import {
  archiveVault,
  clearSavedProfile,
  newSavedProfile,
  readSavedProfile,
  writeSavedProfile,
  type SavedKey,
  type SavedProfile,
} from "./saved-profile";
import { ACTIONS, ATTACKS, type Attack, type ScenarioContext } from "./scenarios";

/** The Actions and Attack logs keep this many entries. */
const MAX_LOG_ENTRIES = 50;

export type Profile = "mac" | "ledger" | "demo";

export const PROFILE_LABELS: Record<Profile, string> = {
  mac: "Mac account (Touch ID)",
  ledger: "Ledger account",
  demo: "Demo account",
};

/** Where the account is kept across reloads; without it, the account lasts for the page. */
export interface DemoOptions {
  /**
   * The browser's storage (localStorage): the profile, and the Mac account's sealed vault, which
   * opens only with the passkey's PRF secret. Never a key in clear.
   */
  storage?: ChoiceStorage | null;
  /** The node the account lives on (its URL); a profile saved for another node is dropped. */
  nodeKey?: string;
}

/** Said when the connected Stax is not the one the Ledger account was set up on. */
export const OTHER_DEVICE_MESSAGE =
  "This Stax holds other keys than the account's: connect the Stax this account was set up on.";

const MAC_KEY_LABEL = "ML-DSA-44 key (sealed, opened by Touch ID)";

/** The node answered, and the account saved in the browser no longer matches it. */
class ProfileMismatch extends Error {}

/** A Ledger account is set up when its master key is disabled and its regular key is the device's ML-DSA-44 key. */
export function isLedgerAccountSetUp(info: AccountInfo, mlDsaAddress: string): boolean {
  return info.masterDisabled && info.regularKey === mlDsaAddress;
}

/**
 * A Mac account's sealed key must survive a reload before its master key is disabled: without
 * it the account would be locked for good.
 */
export const VAULT_NOT_KEPT_MESSAGE =
  "This browser cannot keep the sealed ML-DSA-44 key (storage blocked or full): the master key was left enabled, so the account is not locked out.";

/** Something that can sign for the account with full authority. */
export interface Signer {
  label: string;
  algorithm: string;
  publicKey: string;
  /** The address of that key. */
  address: string;
  /** True when each signature is confirmed on the device. */
  onDevice: boolean;
  sign(tx: TxJson): Promise<TxJson>;
}

export interface StepLog {
  id: number;
  /** The step was signed on the SIMULATED device (the node's answer to it is still the node's). */
  simulatedDevice: boolean;
  label: string;
  status: "pending" | "ok" | "failed";
  result: NodeResult | null;
  note: string | null;
}

export interface LogEntry {
  id: number;
  label: string;
  txType: string;
  signer: string;
  result: NodeResult;
}

export interface DemoState {
  profile: Profile | null;
  /** The account is fully set up and can sign: the other screens wait for it. */
  ready: boolean;
  address: string | null;
  info: AccountInfo | null;
  objects: AccountObjects | null;
  server: ServerInfo | null;
  /** `Date.now()` when `server` was read, to interpolate the countdown. */
  serverAt: number;
  session: SessionEntry | null;
  sessionKey: KeyHandle | null;
  steps: StepLog[];
  actionLog: LogEntry[];
  attackLog: LogEntry[];
  busy: boolean;
  error: string | null;
}

export function createDemo(backend: Backend, options: DemoOptions = {}) {
  const storage = options.storage ?? null;
  const nodeKey = options.nodeKey ?? "";
  const state = reactive<DemoState>({
    profile: null,
    ready: false,
    address: null,
    info: null,
    objects: null,
    server: null,
    serverAt: 0,
    session: null,
    sessionKey: null,
    steps: [],
    actionLog: [],
    attackLog: [],
    busy: false,
    error: null,
  });
  let counter = 0;
  let fullAuth: Signer | null = null;
  /** The Mac account's sealed key, kept with the profile for a reload. */
  let macVault: PqVault | null = null;
  let master: Signer | null = null;
  const { sink, victim } = backend.counterparties;
  const build = backend.builders;

  /* ---- reading the node ---- */

  /** Only the latest read may write the state: a slow poll must not undo a newer refresh. */
  let refreshSequence = 0;

  async function refresh(): Promise<void> {
    refreshSequence += 1;
    const mine = refreshSequence;
    const address = state.address;
    const server = await backend.node.serverInfo();
    const info = address === null ? null : await backend.node.accountInfo(address);
    const objects = address === null ? null : await backend.node.accountObjects(address);
    if (mine !== refreshSequence) return;
    state.server = server;
    state.serverAt = Date.now();
    if (address === null || objects === null) return;
    state.info = info;
    state.objects = objects;
    const key = state.sessionKey?.address;
    state.session =
      key === undefined ? null : (objects.sessions.find((s) => s.sessionKey === key) ?? null);
  }

  /* ---- envelope: Sequence, Fee, LastLedgerSequence (spec 8.3) ---- */

  async function envelope(
    tx: UnsignedTx,
    options: { fee?: string; omitLastLedger?: boolean } = {},
  ): Promise<TxJson> {
    const common = await backend.node.commonFields(tx.Account, options);
    // Flags come from the transaction and from the backend; none is typed here.
    const { Flags: backendFlags, ...fields } = common;
    const flags = ((tx.Flags ?? 0) | (backendFlags ?? 0)) >>> 0;
    const out: TxJson = {
      ...tx,
      ...fields,
      Fee: options.fee ?? tx.Fee ?? common.Fee,
    };
    if (flags !== 0) out.Flags = flags;
    else delete out.Flags;
    return out;
  }

  async function submitWith(
    signer: Pick<Signer, "sign">,
    tx: UnsignedTx,
    options: { fee?: string; omitLastLedger?: boolean } = {},
  ): Promise<NodeResult> {
    const prepared = await envelope(tx, options);
    const signed = await signer.sign(prepared);
    const result = await backend.node.submit(signed);
    // The node's answer is what matters: a failed read afterwards must not lose it.
    try {
      await refresh();
    } catch {
      // The next poll refreshes the state.
    }
    return result;
  }

  function requireAddress(): string {
    if (state.address === null) throw new Error("Create an account first");
    return state.address;
  }

  /* ---- guarded runner ---- */

  async function guarded<T>(work: () => Promise<T>): Promise<T | null> {
    state.busy = true;
    state.error = null;
    try {
      return await work();
    } catch (error) {
      state.error =
        error instanceof DeviceRejectedError
          ? "Rejected on the device. Nothing was sent."
          : error instanceof Error
            ? error.message
            : String(error);
      return null;
    } finally {
      state.busy = false;
    }
  }

  /* ---- account setup ---- */

  function addStep(label: string): StepLog {
    counter += 1;
    const step = reactive<StepLog>({
      id: counter,
      simulatedDevice: false,
      label,
      status: "pending",
      result: null,
      note: null,
    });
    state.steps.push(step);
    return step;
  }

  async function stepTx(label: string, signer: Signer, tx: UnsignedTx): Promise<void> {
    const step = addStep(label);
    // A step signed on the device is signed on the SIMULATED one unless the device is real.
    step.simulatedDevice = signer.onDevice && backend.device.mode === "simulated";
    const result = await submitWith(signer, tx);
    step.result = result;
    step.status = result.success ? "ok" : "failed";
    if (!result.success) throw new Error(`${label}: the node answered ${result.code}`);
  }

  function signerFrom(key: KeyHandle, label: string): Signer {
    return {
      label,
      algorithm: key.algorithm,
      publicKey: key.publicKey,
      address: key.address,
      onDevice: false,
      sign: (tx) => key.sign(tx),
    };
  }

  /**
   * A key of the device. Before each signature it checks that the device still holds that
   * key: another Stax (or a reset simulated one) would sign with a key the account does not know.
   */
  function deviceSigner(
    algorithm: DeviceKey["algorithm"],
    key: Pick<DeviceKey, "publicKey" | "address">,
    label: string,
  ): Signer {
    return {
      label,
      algorithm,
      publicKey: key.publicKey,
      address: key.address,
      onDevice: true,
      async sign(tx) {
        const held = await backend.device.getPublicKey(algorithm);
        if (held.publicKey.toUpperCase() !== key.publicKey.toUpperCase()) {
          throw new Error(OTHER_DEVICE_MESSAGE);
        }
        return backend.device.signTransaction(algorithm, tx);
      },
    };
  }

  async function readLedgerKeys(): Promise<{ classical: DeviceKey; pq: DeviceKey }> {
    const classical = await backend.device.getPublicKey("secp256k1");
    const pq = await backend.device.getPublicKey("mldsa44");
    return { classical, pq };
  }

  async function createAccount(profile: Profile): Promise<boolean> {
    const done = await guarded(async () => {
      reset();
      state.profile = profile;
      if (profile === "mac") await setupMac();
      else if (profile === "ledger") await setupLedger();
      else await setupDemo();
      await refresh();
      state.ready = true;
      save();
      return true;
    });
    return done === true;
  }

  /**
   * The Ledger account already set up on this device, used as it is: the keys are read, the
   * node is asked, nothing is funded or signed.
   */
  async function useExistingLedgerAccount(): Promise<boolean> {
    const done = await guarded(async () => {
      reset();
      state.profile = "ledger";
      const { classical, pq } = await readLedgerKeys();
      state.address = classical.address;
      addStep("Read the device keys (secp256k1 and ML-DSA-44)").status = "ok";
      const info = await backend.node.accountInfo(classical.address);
      if (info === null) {
        throw new Error(
          "This device's account does not exist on this node yet: set it up first (Set up the Ledger account).",
        );
      }
      if (!isLedgerAccountSetUp(info, pq.address)) {
        throw new Error(
          "This device's account is not set up yet (its master key is enabled, or its regular key is not the device's ML-DSA-44 key): set it up first.",
        );
      }
      addStep(
        "This Stax's account is already set up (master key disabled, the device's ML-DSA-44 key as regular key): using it, nothing sent",
      ).status = "ok";
      master = deviceSigner("secp256k1", classical, "Device master key");
      fullAuth = deviceSigner("mldsa44", pq, "Device ML-DSA-44 key");
      await refresh();
      state.ready = true;
      save();
      return true;
    });
    return done === true;
  }

  /* ---- the account across reloads (non-secret profile only) ---- */

  function authorityKey(): SavedKey | null {
    if (fullAuth === null || state.profile === null || state.profile === "demo") return null;
    return { algorithm: "mldsa44", publicKey: fullAuth.publicKey, address: fullAuth.address };
  }

  /** The profile to keep for the account now, or null when nothing of it outlives the page. */
  function savedNow(): SavedProfile | null {
    const authority = authorityKey();
    const address = state.address;
    // The simulated ledger is gone with the page: nothing of it can be found again.
    if (authority === null || address === null || backend.mode === "simulated") return null;
    const ledger = state.profile === "ledger";
    // A simulated Stax makes new keys at each load: nothing to find again.
    if (ledger && backend.device.mode !== "live") return null;
    if (!ledger && macVault === null) return null;
    return newSavedProfile({
      node: nodeKey,
      profile: ledger ? "ledger" : "mac",
      address,
      device: ledger ? "usb" : null,
      authority,
      vault: ledger ? null : macVault,
    });
  }

  /**
   * Keep what a reload needs to find the account again: a real Stax's account, or a Mac account
   * and its sealed vault. Never a demo account's key, never a session key. True when the
   * profile reads back from the storage.
   */
  function save(): boolean {
    const profile = savedNow();
    if (storage === null || profile === null) return false;
    const archived = profile.vault === null || archiveVault(storage, profile.vault);
    writeSavedProfile(storage, profile);
    const back = readSavedProfile(storage, nodeKey);
    return archived && back !== null && JSON.stringify(back) === JSON.stringify(profile);
  }

  /**
   * After a reload: the account saved for this node, checked against the node before it is
   * used. Returns the profile it restored, or null (nothing saved for this node, or the node no
   * longer agrees, which forgets it).
   */
  async function restore(): Promise<SavedProfile | null> {
    const saved = readSavedProfile(storage, nodeKey);
    if (saved === null) return null;
    state.busy = true;
    try {
      const info = await backend.node.accountInfo(saved.address);
      if (info === null) throw new ProfileMismatch(`${saved.address} is not on this node any more`);
      if (!isLedgerAccountSetUp(info, saved.authority.address)) {
        throw new ProfileMismatch(
          `${saved.address} no longer has its ML-DSA-44 key as regular key with the master key disabled`,
        );
      }
      let authority: Signer;
      if (saved.profile === "ledger") {
        authority = deviceSigner(
          "mldsa44",
          { publicKey: saved.authority.publicKey, address: saved.authority.address },
          "Device ML-DSA-44 key",
        );
      } else {
        if (saved.vault === null) throw new ProfileMismatch("the sealed key is missing");
        const key = backend.wallet.openVaultKey(saved.vault);
        if (key.address !== saved.authority.address) {
          throw new ProfileMismatch("the sealed key is not the account's regular key");
        }
        authority = signerFrom(key, MAC_KEY_LABEL);
        macVault = saved.vault;
      }
      reset({ keepSaved: true, keepVault: true });
      state.profile = saved.profile;
      state.address = saved.address;
      fullAuth = authority;
      addStep(
        saved.profile === "mac"
          ? "Found again after the reload: this browser kept the address and the sealed ML-DSA-44 key, which Touch ID opens; the node holds the state"
          : "Found again after the reload: this browser kept the address and the public key, the node holds the state",
      ).status = "ok";
      await refresh();
      state.ready = true;
      return saved;
    } catch (error) {
      // Forgotten only when the node answered and disagrees; a node that did not answer may later.
      reset({ keepSaved: !(error instanceof ProfileMismatch) });
      state.error = `The account kept in this browser was not restored: ${error instanceof Error ? error.message : String(error)}`;
      return null;
    } finally {
      state.busy = false;
    }
  }

  async function fund(address: string): Promise<void> {
    const step = addStep(
      backend.node.mode === "simulated"
        ? "Fund the account (SIMULATED faucet)"
        : "Fund the account at the faucet",
    );
    await backend.node.fundAccount(address);
    step.status = "ok";
  }

  async function setupDemo(): Promise<void> {
    const masterKey = await backend.wallet.createMasterKey();
    master = signerFrom(masterKey, "Demo master key");
    state.address = masterKey.address;
    await fund(masterKey.address);
    fullAuth = master;
  }

  /**
   * The post-quantum Mac account: a master key in the page funds and hands the account to an
   * ML-DSA-44 key sealed under the passkey's PRF secret, which proves itself, then the master
   * key is disabled. No P-256 key reaches the ledger: the passkey is only the PRF oracle.
   */
  async function setupMac(): Promise<void> {
    const masterKey = await backend.wallet.createMasterKey();
    master = signerFrom(masterKey, "Setup master key (secp256k1, in the page)");
    const address = masterKey.address;
    state.address = address;
    const created = await backend.wallet.createVaultKey(address);
    try {
      addStep(
        backend.wallet.prfSimulated
          ? "Create the passkey and seal a new ML-DSA-44 key with its PRF secret (SIMULATED: software PRF, no Touch ID)"
          : "Create the passkey and seal a new ML-DSA-44 key with its PRF secret (Touch ID twice)",
      ).status = "ok";
      macVault = created.vault;
      await fund(address);
      await stepTx(
        "SetRegularKey to the ML-DSA-44 key, signed by the master key",
        master,
        build.setRegularKey(address, created.key.address),
      );
      fullAuth = signerFrom(created.key, MAC_KEY_LABEL);
      await stepTx(
        "Proof transaction, signed by the ML-DSA-44 key",
        fullAuth,
        build.accountSetNoop(address),
      );
      // The sealed key must outlive the page before the master key goes (live node only: the
      // simulated ledger is gone with the page anyway).
      if (backend.mode === "live") {
        if (!save()) throw new Error(VAULT_NOT_KEPT_MESSAGE);
        addStep("Keep the sealed key in this browser (it opens only with Touch ID)").status = "ok";
      }
      await stepTx(
        "AccountSet asfDisableMaster, signed by the master key",
        master,
        build.accountSetDisableMaster(address),
      );
    } finally {
      // From now on each signature asks the passkey again.
      created.wipe();
    }
  }

  /**
   * The device's account: the address of its secp256k1 key, so the same Stax always gives the
   * same account (the simulated Stax makes new keys at each setup). An account already set up
   * is used as it is; one left half-way by an earlier run is finished, skipping what is done.
   */
  async function setupLedger(): Promise<void> {
    backend.device.reset();
    const { classical, pq } = await readLedgerKeys();
    master = deviceSigner("secp256k1", classical, "Device master key");
    const mlDsa = deviceSigner("mldsa44", pq, "Device ML-DSA-44 key");
    const address = classical.address;
    state.address = address;
    addStep("Read the device keys (secp256k1 and ML-DSA-44)").status = "ok";
    const existing = await backend.node.accountInfo(address);
    if (existing !== null && isLedgerAccountSetUp(existing, pq.address)) {
      addStep(
        "This Stax's account is already set up (master key disabled, the device's ML-DSA-44 key as regular key): continuing with it, nothing sent",
      ).status = "ok";
      fullAuth = mlDsa;
      return;
    }
    if (existing?.masterDisabled === true) {
      throw new Error(
        `${address} has its master key disabled and a regular key that is not this device's ML-DSA-44 key: this page cannot set it up again.`,
      );
    }
    if (existing === null) await fund(address);
    else addStep("The account is already on the node: no faucet").status = "ok";
    if (existing?.regularKey === pq.address) {
      addStep("The regular key is already the device's ML-DSA-44 key").status = "ok";
    } else {
      await stepTx(
        "SetRegularKey to the ML-DSA-44 key, signed by the master key on the device",
        master,
        build.setRegularKey(address, pq.address),
      );
    }
    fullAuth = mlDsa;
    await stepTx(
      "Proof transaction, signed by the ML-DSA-44 key on the device",
      fullAuth,
      build.accountSetNoop(address),
    );
    await stepTx(
      "AccountSet asfDisableMaster, signed by the master key on the device",
      master,
      build.accountSetDisableMaster(address),
    );
  }

  function reset(options: { keepSaved?: boolean; keepVault?: boolean } = {}): void {
    // What is kept for a reload always matches a ready account: a new setup forgets the old one.
    if (options.keepSaved !== true) clearSavedProfile(storage, nodeKey);
    if (options.keepVault !== true) macVault = null;
    state.profile = null;
    state.ready = false;
    state.address = null;
    state.info = null;
    state.objects = null;
    state.session = null;
    state.sessionKey = null;
    state.steps = [];
    state.actionLog = [];
    state.attackLog = [];
    state.error = null;
    fullAuth = null;
    master = null;
  }

  /* ---- sessions ---- */

  async function openSession(params: SessionParams): Promise<NodeResult | null> {
    return guarded(async () => {
      const address = requireAddress();
      if (fullAuth === null) throw new Error("No key with full authority");
      const key = await backend.wallet.createSessionKey();
      const result = await submitWith(fullAuth, build.sessionSet(address, key.address, params));
      if (result.success) state.sessionKey = key;
      await refresh();
      return result;
    });
  }

  /** The own close: signed by the session key itself (spec 6.3). */
  async function closeSession(): Promise<NodeResult | null> {
    return guarded(async () => {
      const address = requireAddress();
      const key = state.sessionKey;
      if (key === null) throw new Error("No open session");
      const result = await submitWith(key, build.sessionDelete(address, key.address));
      if (result.success) state.sessionKey = null;
      await refresh();
      return result;
    });
  }

  function scenarioContext(): ScenarioContext {
    const entry = state.session;
    return {
      account: requireAddress(),
      builders: build,
      sink,
      victim,
      remainingCapDrops:
        entry !== null && entry.capDrops !== null ? entry.capDrops - (entry.spentDrops ?? 0) : null,
    };
  }

  async function runAction(id: string): Promise<LogEntry | null> {
    return guarded(async () => {
      const action = ACTIONS.find((a) => a.id === id);
      const key = state.sessionKey;
      if (action === undefined) throw new Error(`Unknown action ${id}`);
      if (key === null) throw new Error("Open a session first");
      // On a real ledger the payee, the issuer and the destination of these actions must exist, and
      // a payment below the reserve cannot create one: fund the counterparty (not session-signed).
      await ensureAccount(sink);
      const result = await submitWith(key, action.build(scenarioContext()));
      counter += 1;
      const entry: LogEntry = {
        id: counter,
        label: action.title,
        txType: action.type,
        signer: "session key",
        result,
      };
      state.actionLog.unshift(entry);
      state.actionLog.length = Math.min(state.actionLog.length, MAX_LOG_ENTRIES);
      return entry;
    });
  }

  /** An account that must exist on the ledger before a transaction can name it. */
  async function ensureAccount(address: string): Promise<void> {
    if ((await backend.node.accountInfo(address)) === null) await backend.node.fundAccount(address);
  }

  async function ensureVictim(): Promise<void> {
    await ensureAccount(victim);
  }

  async function runAttack(id: string): Promise<LogEntry | null> {
    return guarded(async () => {
      const attack: Attack | undefined = ATTACKS.find((a) => a.id === id);
      const key = state.sessionKey;
      if (attack === undefined) throw new Error(`Unknown attack ${id}`);
      if (key === null) throw new Error("Open a session first");
      if (attack.needsExpiry) {
        const entry = state.session;
        if (entry === null) throw new Error("Open a session first");
        const server = await backend.node.serverInfo();
        if (backend.clock !== null) {
          backend.clock.advance(Math.max(1, entry.expiration - server.closeTime + 1));
        } else if (server.closeTime < entry.expiration) {
          // A live node cannot be hurried: the person waits for the Expiration.
          throw new Error(
            `Wait for the session to expire (${entry.expiration - server.closeTime} s left)`,
          );
        }
      }
      if (attack.needsVictimAccount === true) await ensureVictim();
      const ctx = scenarioContext();
      const options: { fee?: string; omitLastLedger?: boolean } = {};
      if (attack.fee !== undefined) options.fee = attack.fee;
      if (attack.omitLastLedger === true) options.omitLastLedger = true;
      const result = await submitWith(key, attack.build(ctx), options);
      counter += 1;
      const entry: LogEntry = {
        id: counter,
        label: attack.title,
        txType: attack.type,
        signer: "session key",
        result,
      };
      state.attackLog.unshift(entry);
      state.attackLog.length = Math.min(state.attackLog.length, MAX_LOG_ENTRIES);
      return entry;
    });
  }

  /** For wallet adapters: fill the envelope of a transaction of the connected account. */
  async function prepare(tx: UnsignedTx): Promise<TxJson> {
    return envelope(tx);
  }

  /** For wallet adapters: sign as the account's own authority (vault key, device or master key). */
  async function signAsAccount(tx: TxJson): Promise<TxJson> {
    if (fullAuth === null) throw new Error("No account is connected");
    return fullAuth.sign(tx);
  }

  function accountPublicKey(): string | null {
    return fullAuth?.publicKey ?? null;
  }

  function accountSignerAddress(): string | null {
    return fullAuth?.address ?? null;
  }

  function disconnect(): void {
    reset();
  }

  /** Simulated clock only: let ledger time pass. */
  async function advance(seconds: number): Promise<void> {
    backend.clock?.advance(seconds);
    await refresh();
  }

  /** The poll: closes a simulated ledger, or reads the live node. Never throws, skips while a store action runs. */
  async function tick(): Promise<void> {
    backend.clock?.closeLedger();
    if (state.busy) return;
    try {
      await refresh();
    } catch {
      // A node that does not answer now answers at the next tick; the actions show their own errors.
    }
  }

  /* ---- Quantum screen: migration of an account the device controls ---- */

  return {
    state,
    refresh,
    createAccount,
    useExistingLedgerAccount,
    restore,
    openSession,
    closeSession,
    runAction,
    runAttack,
    advance,
    tick,
    prepare,
    signAsAccount,
    accountPublicKey,
    accountSignerAddress,
    disconnect,
    sink,
    victim,
    /** Drops for an amount of XRP, for the forms. */
    toDrops: xrpToDrops,
  };
}

export type Demo = ReturnType<typeof createDemo>;

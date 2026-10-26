/**
 * The wallet adapters of the web app, written against the `WalletAdapter` interface of
 * xrpl-connect 1.0.0 (`apps/web/node_modules/xrpl-connect/index.d.ts:1928`, which declares
 * `id`, `name`, `capabilities`, `isAvailable`, `connect`, `disconnect`, `getAccount`,
 * `getNetwork`, `sign`, `signAndSubmit`, `signMessage`, `on`, `off`). Four adapters, and
 * only these: the real Ledger Stax over USB and its SIMULATED software double (Device
 * Management Kit only: the legacy ledgerjs adapter of xrpl-connect is never imported), a
 * post-quantum Mac account unlocked by Touch ID (WebAuthn PRF), and a throw-away demo account.
 * None of them needs an API key or loads a third-party script.
 */
import type {
  AccountInfo,
  NetworkInfo,
  SignedMessage,
  SignedTransaction,
  SubmittedTransaction,
  Transaction,
  WalletAdapter,
  WalletAdapterEvent,
  WalletCapabilities,
} from "xrpl-connect";
import { hasWebHid } from "../browser-support";
import { DEFAULT_FEE_DROPS } from "../constants";
import type { Demo, Profile } from "../demo";
import type { NetworkStore } from "../network-store";
import type { Backend, TxJson } from "../ports";
import { NOT_CONNECTED_MESSAGE, type DeviceSelection } from "../live/device-selection";
import type { PrfSource } from "./prf";
import {
  DEMO_ACCOUNT,
  LEDGER_STAX_SIMULATED,
  LEDGER_STAX_USB,
  MAC_TOUCH_ID,
  type WalletDescription,
  type WalletId,
} from "./catalog";

/** Everything an adapter needs from the app. */
export interface WalletHost {
  backend: Backend;
  demo: Demo;
  network: NetworkStore;
  /** The device of the live backend: the real Stax over USB, or the software double. */
  device: DeviceSelection;
}

type Listener = (data: unknown) => void;

/**
 * The network a wallet reports while the screens run on the simulation: no URL, since no node
 * is contacted, and not the local node's id.
 */
export const SIMULATED_NETWORK: NetworkInfo = {
  id: "simulated",
  name: "Simulated node (SIMULATED)",
  wss: "",
};

/** The network a wallet reports for the node in effect. */
export function walletNetwork(host: Pick<WalletHost, "backend" | "network">): NetworkInfo {
  if (host.backend.mode === "simulated") return { ...SIMULATED_NETWORK };
  const network = host.network.selected();
  return { id: network.id, name: network.name, wss: network.wss, rpc: network.rpc };
}

const CAPABILITIES: WalletCapabilities = { sign: true, signAndSubmit: true, signMessage: false };

/** A transaction of the xrpl-connect shape as the JSON the node takes. */
function toTxJson(tx: Transaction): TxJson {
  const fields: Record<string, unknown> = { ...tx };
  return {
    ...fields,
    TransactionType: String(tx.TransactionType),
    Account: tx.Account,
    Fee: typeof tx.Fee === "string" ? tx.Fee : DEFAULT_FEE_DROPS,
  };
}

abstract class CarbsAdapter implements WalletAdapter {
  abstract readonly id: WalletId;
  abstract readonly name: string;
  abstract readonly description: WalletDescription;
  readonly capabilities = CAPABILITIES;
  private readonly listeners = new Map<WalletAdapterEvent, Set<Listener>>();
  private connected = false;

  constructor(protected readonly host: WalletHost) {}

  abstract isAvailable(): Promise<boolean>;
  /** Create the account for this wallet on the backend. */
  protected abstract open(): Promise<void>;

  async connect(): Promise<AccountInfo> {
    const { demo } = this.host;
    demo.disconnect();
    await this.open();
    if (demo.state.address === null) {
      throw new Error(demo.state.error ?? `${this.name} did not create an account`);
    }
    this.connected = true;
    const account = this.accountInfo();
    this.emit("connect", account);
    return account;
  }

  async disconnect(): Promise<void> {
    this.host.demo.disconnect();
    this.connected = false;
    this.emit("disconnect", undefined);
  }

  async getAccount(): Promise<AccountInfo | null> {
    return this.connected && this.host.demo.state.address !== null ? this.accountInfo() : null;
  }

  async getNetwork(): Promise<NetworkInfo> {
    return this.networkInfo();
  }

  async sign(transaction: Transaction): Promise<SignedTransaction> {
    const signed = await this.signJson(transaction);
    return {
      hash: this.host.backend.node.transactionHash(signed),
      signature: signed.TxnSignature ?? "",
      signerAddress: this.host.demo.accountSignerAddress() ?? "",
      tx: signed,
    };
  }

  async signAndSubmit(transaction: Transaction): Promise<SubmittedTransaction> {
    const signed = await this.signJson(transaction);
    const result = await this.host.backend.node.submit(signed);
    await this.host.demo.refresh();
    return {
      hash: result.hash,
      engine_result: result.code,
      applied: result.success,
      simulated: this.host.backend.mode === "simulated",
      tx: signed,
    };
  }

  async signMessage(_message: string | Uint8Array): Promise<SignedMessage> {
    throw new Error(`${this.name} does not sign messages`);
  }

  on(event: WalletAdapterEvent, callback: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(callback);
    this.listeners.set(event, set);
  }

  off(event: WalletAdapterEvent, callback: Listener): void {
    this.listeners.get(event)?.delete(callback);
  }

  protected emit(event: WalletAdapterEvent, data: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }

  private async signJson(transaction: Transaction): Promise<TxJson> {
    const { demo } = this.host;
    const json = toTxJson(transaction);
    if (json.Account !== demo.state.address) {
      throw new Error("The transaction is not for the connected account");
    }
    return demo.signAsAccount(await demo.prepare(json));
  }

  private networkInfo(): NetworkInfo {
    return walletNetwork(this.host);
  }

  private accountInfo(): AccountInfo {
    const { demo } = this.host;
    const publicKey = demo.accountPublicKey();
    return {
      address: demo.state.address ?? "",
      ...(publicKey === null ? {} : { publicKey }),
      network: this.networkInfo(),
    };
  }
}

async function createFor(host: WalletHost, profile: Profile, adapterName: string): Promise<void> {
  const ok = await host.demo.createAccount(profile);
  if (!ok) throw new Error(host.demo.state.error ?? `${adapterName} could not set up the account`);
}

/**
 * The real Ledger Stax over USB, through the Device Management Kit (WebHID). Only on a live
 * node: the Stax signs for a node with the SigningSessions amendment. The connection runs first, inside
 * the click that opened it, since WebHID's device picker needs that gesture.
 */
export class LedgerStaxUsbAdapter extends CarbsAdapter {
  readonly id = "ledger-stax-usb";
  readonly name = LEDGER_STAX_USB.name;
  readonly description = LEDGER_STAX_USB;

  async isAvailable(): Promise<boolean> {
    return this.host.backend.mode === "live" && hasWebHid();
  }

  protected async open(): Promise<void> {
    const { device } = this.host;
    await device.choose("usb");
    await device.connect();
    if (!device.connected) throw new Error(device.error ?? NOT_CONNECTED_MESSAGE);
    await createFor(this.host, "ledger", this.name);
  }
}

/** The software double of the Stax in this page (SIMULATED): the same flow with no device. */
export class LedgerStaxSimulatedAdapter extends CarbsAdapter {
  readonly id = "ledger-stax-simulated";
  readonly name = LEDGER_STAX_SIMULATED.name;
  readonly description = LEDGER_STAX_SIMULATED;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  protected async open(): Promise<void> {
    // On a live node the device follows the choice: going back to the double closes a real Stax.
    if (this.host.backend.mode === "live") await this.host.device.choose("simulated");
    await createFor(this.host, "ledger", this.name);
  }
}

/**
 * The post-quantum Mac account: Touch ID releases a WebAuthn PRF secret that unlocks an
 * ML-DSA-44 key sealed in this browser. On the simulation the PRF is the software double.
 */
export class MacTouchIdAdapter extends CarbsAdapter {
  readonly id = "mac-touch-id";
  readonly name = MAC_TOUCH_ID.name;
  readonly description = MAC_TOUCH_ID;

  constructor(
    host: WalletHost,
    readonly prf: PrfSource,
  ) {
    super(host);
  }

  async isAvailable(): Promise<boolean> {
    return this.host.backend.mode === "simulated" || this.prf.available();
  }

  protected async open(): Promise<void> {
    await createFor(this.host, "mac", this.name);
  }
}

/** A throw-away account: a master key in the page, on the node in effect (SIMULATED on the simulation). */
export class DemoAccountAdapter extends CarbsAdapter {
  readonly id = "demo-account";
  readonly name = DEMO_ACCOUNT.name;
  readonly description = DEMO_ACCOUNT;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  protected async open(): Promise<void> {
    await createFor(this.host, "demo", this.name);
  }
}

export type { CarbsAdapter };

/** The four adapters, in display order. */
export function createWalletAdapters(host: WalletHost, prf: PrfSource): CarbsAdapter[] {
  return [
    new LedgerStaxUsbAdapter(host),
    new LedgerStaxSimulatedAdapter(host),
    new MacTouchIdAdapter(host, prf),
    new DemoAccountAdapter(host),
  ];
}

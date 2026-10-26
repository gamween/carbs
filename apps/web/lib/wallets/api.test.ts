import { createXrplConnect, useWallet } from "@xrpl-commons/xrpl-connect-vue";
import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import { createAppContext } from "../app-context";
import type { Backend } from "../ports";
import { createWalletAdapters, walletNetwork } from "./adapters";
import { STAX_NEEDS_LIVE_NODE, createWalletsApi } from "./api";
import { browserPasskeySource, softwarePasskeySource } from "./passkey";

function wired(passkeys = softwarePasskeySource()) {
  const ctx = createAppContext();
  ctx.sim.simDevice.setApprover(async () => true);
  const adapters = createWalletAdapters(
    { backend: ctx.backend, demo: ctx.demo, network: ctx.network, device: ctx.deviceSelection },
    passkeys,
  );
  // The same wiring as plugins/xrpl-connect.client.ts.
  const app = createApp({});
  app.use(
    createXrplConnect({
      adapters,
      network: walletNetwork(ctx),
      autoConnect: false,
      logger: { level: "error" },
    }),
  );
  const { manager } = app.runWithContext(() => useWallet());
  return { ctx, api: createWalletsApi(manager, adapters, ctx.backend, passkeys.simulated) };
}

describe("wallets API on the Vue binding", () => {
  it("lists availability, connects and disconnects through the binding's manager", async () => {
    const { api, ctx } = wired();
    await api.refresh();
    // The real Stax needs a live node; the simulation offers the other three.
    expect(api.state.entries.map((e) => e.available)).toEqual([false, true, true, true]);
    expect(api.state.entries[0]?.unavailableReason).toBe(STAX_NEEDS_LIVE_NODE);
    expect(await api.connect("demo-account")).toBe(true);
    expect(api.state.address).toBe(ctx.demo.state.address);
    await api.disconnect();
    expect(api.state.address).toBeNull();
    expect(ctx.demo.state.address).toBeNull();
  });

  it("says why the passkey is unavailable where the browser has no WebAuthn", async () => {
    const { api } = wired(browserPasskeySource());
    await api.refresh();
    const passkey = api.state.entries.find((e) => e.description.id === "passkey-mac");
    expect(passkey?.available).toBe(false);
    expect(passkey?.unavailableReason).toContain("secure context");
  });

  it("keeps the error when a connection fails", async () => {
    const { api, ctx } = wired();
    ctx.sim.simDevice.setApprover(async () => false);
    expect(await api.connect("ledger-stax-simulated")).toBe(false);
    expect(api.state.error).toContain("Rejected on the device");
    expect(api.state.connectedId).toBeNull();
  });
});

describe("the SIMULATED badge of the two Ledger Stax entries", () => {
  it("is on the simulated Stax only, never on the real one, on a live node", async () => {
    const ctx = createAppContext();
    const live: Backend = { ...ctx.backend, mode: "live" };
    const adapters = createWalletAdapters(
      { backend: live, demo: ctx.demo, network: ctx.network, device: ctx.deviceSelection },
      softwarePasskeySource(),
    );
    const manager = {
      connect: async () => ({ address: "", network: walletNetwork(ctx) }),
      disconnect: async () => undefined,
    };
    const api = createWalletsApi(manager, adapters, live, false);
    Object.defineProperty(navigator, "hid", { value: {}, configurable: true });
    try {
      await api.refresh();
    } finally {
      Reflect.deleteProperty(navigator, "hid");
    }
    const byId = new Map(api.state.entries.map((e) => [e.description.id, e]));
    expect(byId.get("ledger-stax-usb")?.available).toBe(true);
    expect(byId.get("ledger-stax-usb")?.simulated).toEqual([]);
    expect(byId.get("ledger-stax-simulated")?.simulated).toEqual(["device"]);
    // Whatever was picked elsewhere (Account screen), the entries do not change.
    await ctx.deviceSelection.choose("usb");
    await api.refresh();
    expect(
      api.state.entries.find((e) => e.description.id === "ledger-stax-simulated")?.simulated,
    ).toEqual(["device"]);
  });

  it("says to use Chrome when the real Stax has no WebHID on a live node", async () => {
    const ctx = createAppContext();
    const live: Backend = { ...ctx.backend, mode: "live" };
    const adapters = createWalletAdapters(
      { backend: live, demo: ctx.demo, network: ctx.network, device: ctx.deviceSelection },
      softwarePasskeySource(),
    );
    const manager = {
      connect: async () => ({ address: "", network: walletNetwork(ctx) }),
      disconnect: async () => undefined,
    };
    const api = createWalletsApi(manager, adapters, live, false);
    Reflect.deleteProperty(navigator, "hid");
    await api.refresh();
    const usb = api.state.entries.find((e) => e.description.id === "ledger-stax-usb");
    expect(usb?.available).toBe(false);
    expect(usb?.unavailableReason).toContain("WebHID");
  });
});

import { describe, expect, it } from "vitest";
import AccountScreen from "./AccountScreen.vue";
import { codesIn, flushPromises, mountScreen, settled } from "./test-utils";

describe("Account screen", () => {
  it("creates the post-quantum Mac account: ML-DSA-44 regular key, master disabled, no passkey on the ledger, SIMULATED", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    expect(wrapper.find("[data-testid='account-state']").exists()).toBe(false);
    await wrapper.get("[data-testid='create-mac']").trigger("click");
    await settled(ctx);
    expect(wrapper.get("[data-testid='address']").text()).toBe(ctx.demo.state.address);
    expect(wrapper.get("[data-testid='master']").text()).toBe("disabled");
    expect(ctx.demo.state.info?.regularKey).toBe(ctx.demo.accountSignerAddress());
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(0);
    expect(codesIn(wrapper)).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
    expect(wrapper.get("[data-testid='setup-steps']").text()).toContain(
      "SIMULATED: software PRF, no Touch ID",
    );
    expect(wrapper.find("[data-testid='sim-badge']").exists()).toBe(true);
  });

  it("shows the reserve the node reports, not a constant", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    await wrapper.get("[data-testid='create-mac']").trigger("click");
    await settled(ctx);
    expect(ctx.demo.state.info?.ownerCount).toBe(0);
    expect(wrapper.get("[data-testid='reserve']").text()).toMatch(
      /^1 XRP\s+\(1 XRP \+ 0 × 0\.2 XRP per owned object, as the node reports; [\d.]+ XRP available\)$/,
    );
    // Another node, other reserves: the screen follows (xrpld's defaults of 10 and 2 XRP).
    if (ctx.demo.state.server === null) throw new Error("no server info");
    ctx.demo.state.server = {
      ...ctx.demo.state.server,
      reserves: { baseDrops: 10_000_000, ownerDrops: 2_000_000 },
    };
    await flushPromises();
    expect(wrapper.get("[data-testid='reserve']").text()).toMatch(/^10 XRP/);
    ctx.demo.state.server = { ...ctx.demo.state.server, reserves: null };
    await flushPromises();
    expect(wrapper.get("[data-testid='reserve']").text()).toBe("not reported by the node");
  });

  it("says why the Mac account uses PRF, what is not verified, and that it is full post-quantum", () => {
    const { wrapper } = mountScreen(AccountScreen);
    const mac = wrapper.get("[data-testid='profile-mac']").text();
    expect(mac).not.toContain("P-256 passkey");
    expect(mac).toContain("No P-256 key reaches the ledger");
    expect(mac).toContain("cannot create an ML-DSA-44 passkey (COSE -48)");
    expect(mac).toContain("PRF with a real Touch ID has not been verified yet");
    expect(mac).toContain("software PRF double (SIMULATED");
    expect(wrapper.text()).toContain(
      "Full post-quantum: no classical key in the flow, except the master key, which the setup disables.",
    );
    const ledger = wrapper.get("[data-testid='profile-ledger']").text();
    expect(ledger).toContain("without side-channel countermeasures");
    expect(ledger).toContain("extractible");
  });

  it("does not claim device signing for the simulated Stax", () => {
    const { wrapper } = mountScreen(AccountScreen);
    const ledger = wrapper.get("[data-testid='profile-ledger']").text();
    expect(ledger).not.toContain("signed on the device");
    expect(ledger).toContain("signed by the simulated Stax");
    expect(wrapper.get("[data-testid='profile-mac']").text()).not.toMatch(/device/i);
  });

  it("creates a Ledger account in three device-signed steps, master disabled, no passkey", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='master']").text()).toBe("disabled");
    expect(ctx.demo.state.objects?.passkeys).toHaveLength(0);
    expect(codesIn(wrapper)).toEqual(["tesSUCCESS", "tesSUCCESS", "tesSUCCESS"]);
  });

  it("names the buttons for what they do: a new Mac account, the Ledger's own account", () => {
    const { wrapper } = mountScreen(AccountScreen);
    // The software PRF double is SIMULATED, and the button says so.
    expect(wrapper.get("[data-testid='create-mac']").text()).toMatch(
      /^Create a new Mac account\s*SIMULATED$/,
    );
    expect(wrapper.get("[data-testid='create-ledger']").text()).toBe("Set up the Ledger account");
    expect(wrapper.get("[data-testid='use-ledger']").text()).toBe("Use the account already set up");
    expect(wrapper.get("[data-testid='ledger-account-note']").text()).toContain(
      "simulated Stax makes new keys at each setup",
    );
  });

  it("uses the Ledger account already set up, sending nothing", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen);
    await wrapper.get("[data-testid='use-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='error']").text()).toContain("set it up first");
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    const address = ctx.demo.state.address;
    await wrapper.get("[data-testid='use-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='error']").exists()).toBe(false);
    expect(ctx.demo.state.address).toBe(address);
    expect(ctx.demo.state.ready).toBe(true);
    expect(codesIn(wrapper)).toEqual([]);
  });

  it("shows a rejection on the device and sends nothing", async () => {
    const { wrapper, ctx } = mountScreen(AccountScreen, { autoApprove: false });
    ctx.sim.simDevice.setApprover(async () => false);
    await wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='error']").text()).toContain("Rejected on the device");
    expect(codesIn(wrapper)).toEqual([]);
  });
});

describe("Account screen, browser support", () => {
  it("says to use Chrome when navigator.hid is missing", () => {
    Reflect.deleteProperty(navigator, "hid");
    const { wrapper } = mountScreen(AccountScreen);
    const warning = wrapper.get("[data-testid='hid-warning']").text();
    expect(warning).toContain("Use Chrome");
    expect(warning).toContain("WebHID");
  });

  it("shows no warning when WebHID exists", () => {
    Object.defineProperty(navigator, "hid", { value: {}, configurable: true });
    try {
      const { wrapper } = mountScreen(AccountScreen);
      expect(wrapper.find("[data-testid='hid-warning']").exists()).toBe(false);
    } finally {
      Reflect.deleteProperty(navigator, "hid");
    }
  });
});

describe("Account screen, steps signed on the simulated device", () => {
  it("badges them even when the node is live", async () => {
    const mounted = mountScreen(AccountScreen);
    const backend = {
      ...mounted.ctx.backend,
      mode: "live",
      device: { ...mounted.ctx.backend.device, mode: "simulated" },
    } as typeof mounted.ctx.backend;
    const live = mountScreen(AccountScreen, { backend });
    await live.wrapper.get("[data-testid='create-ledger']").trigger("click");
    await flushPromises();
    const steps = live.wrapper.findAll("[data-testid='setup-steps'] li");
    expect(live.ctx.demo.state.steps.filter((s) => s.simulatedDevice).length).toBe(3);
    const badged = steps.filter((li) => li.find("p [data-testid='sim-badge']").exists());
    expect(badged).toHaveLength(3);
  });

  it("badges no step as a simulated device for a Mac account on a live node", async () => {
    const mounted = mountScreen(AccountScreen);
    const backend = { ...mounted.ctx.backend, mode: "live" } as typeof mounted.ctx.backend;
    const live = mountScreen(AccountScreen, { backend });
    await live.wrapper.get("[data-testid='create-mac']").trigger("click");
    await flushPromises();
    expect(live.ctx.demo.state.steps.some((s) => s.simulatedDevice)).toBe(false);
  });
});

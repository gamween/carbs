import { describe, expect, it } from "vitest";
import { flushPromises, mountScreen } from "../screens/test-utils";
import WalletConnector from "./WalletConnector.vue";

async function opened() {
  const mounted = mountScreen(WalletConnector);
  await mounted.wallets.refresh();
  await mounted.wrapper.get("[data-testid='wallet-open']").trigger("click");
  return mounted;
}

describe("Wallet entry", () => {
  it("lists the four wallets and nothing else", async () => {
    const { wrapper } = await opened();
    const ids = wrapper
      .findAll("[data-testid^='wallet-']")
      .map((n) => n.attributes("data-testid"))
      .filter((id) =>
        /^wallet-(ledger-stax-usb|ledger-stax-simulated|mac-touch-id|demo-account)$/.test(id ?? ""),
      );
    expect(ids).toEqual([
      "wallet-ledger-stax-usb",
      "wallet-ledger-stax-simulated",
      "wallet-mac-touch-id",
      "wallet-demo-account",
    ]);
    const text = wrapper.text();
    expect(text).not.toMatch(/Xaman|GemWallet|WalletConnect/i);
  });

  it("shows, for each, the key type, who signs what and the SIMULATED badge", async () => {
    const { wrapper } = await opened();
    for (const id of ["ledger-stax-simulated", "mac-touch-id", "demo-account"]) {
      const card = wrapper.get(`[data-testid='wallet-${id}']`);
      expect(card.get("[data-testid='key-type']").text().length).toBeGreaterThan(10);
      expect(card.findAll("[data-testid='signs'] li").length).toBeGreaterThanOrEqual(2);
      expect(card.find("[data-testid='sim-badge']").exists()).toBe(true);
    }
    expect(
      wrapper
        .get("[data-testid='wallet-ledger-stax-simulated'] [data-testid='simulated-parts']")
        .text(),
    ).toBe("node, Stax");
    expect(
      wrapper.get("[data-testid='wallet-ledger-stax-simulated'] [data-testid='key-type']").text(),
    ).toContain("ML-DSA-44");
    expect(
      wrapper.get("[data-testid='wallet-mac-touch-id'] [data-testid='key-type']").text(),
    ).toContain("ML-DSA-44");
    const mac = wrapper.get("[data-testid='wallet-mac-touch-id']").text();
    expect(mac).not.toContain("P-256");
    expect(mac).toContain("cannot create an ML-DSA-44 passkey");
    expect(mac).toContain("has not been verified yet");
    expect(
      wrapper.get("[data-testid='wallet-mac-touch-id'] [data-testid='simulated-parts']").text(),
    ).toBe("node, Touch ID (software PRF)");
  });

  it("connects the demo account, closes, shows the address and disconnects", async () => {
    const { wrapper, ctx } = await opened();
    await wrapper.get("[data-testid='connect-demo-account']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='wallet-modal']").exists()).toBe(false);
    expect(ctx.demo.state.profile).toBe("demo");
    expect(wrapper.get("[data-testid='connected-address']").text()).toContain("rSim");
    await wrapper.get("[data-testid='wallet-disconnect']").trigger("click");
    await flushPromises();
    expect(ctx.demo.state.address).toBeNull();
    expect(wrapper.find("[data-testid='wallet-open']").exists()).toBe(true);
  });

  it("never badges the real Stax, and says on the simulation that it needs a live node", async () => {
    const { wrapper } = await opened();
    const usb = wrapper.get("[data-testid='wallet-ledger-stax-usb']");
    expect(usb.find("[data-testid='sim-badge']").exists()).toBe(false);
    expect(usb.get("[data-testid='key-type']").text()).toContain("ML-DSA-44");
    expect(usb.get("[data-testid='unavailable']").text()).toContain("Local node or Team node");
    expect(usb.get("[data-testid='connect-ledger-stax-usb']").attributes("disabled")).toBeDefined();
  });

  it("connects the simulated Ledger Stax and the Mac account through the software PRF double", async () => {
    const stax = await opened();
    await stax.wrapper.get("[data-testid='connect-ledger-stax-simulated']").trigger("click");
    await flushPromises();
    expect(stax.ctx.demo.state.profile).toBe("ledger");

    const passkey = await opened();
    await passkey.wrapper.get("[data-testid='connect-mac-touch-id']").trigger("click");
    await flushPromises();
    expect(passkey.ctx.demo.state.profile).toBe("mac");
  });

  it("shows the error of a rejected device and stays open", async () => {
    const { wrapper, ctx } = await opened();
    ctx.sim.simDevice.setApprover(async () => false);
    await wrapper.get("[data-testid='connect-ledger-stax-simulated']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='wallet-error']").text()).toContain("Rejected on the device");
    expect(wrapper.find("[data-testid='wallet-modal']").exists()).toBe(true);
  });
});

describe("Wallet entry, keyboard", () => {
  it("moves the focus into the dialog, closes on Escape and gives the focus back", async () => {
    const { wrapper } = mountScreen(WalletConnector);
    const open = wrapper.get("[data-testid='wallet-open']");
    (open.element as HTMLElement).focus();
    await open.trigger("click");
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("wallet-modal");
    await wrapper.get("[data-testid='wallet-modal']").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(wrapper.find("[data-testid='wallet-modal']").exists()).toBe(false);
    await flushPromises();
    expect(document.activeElement?.getAttribute("data-testid")).toBe("wallet-open");
  });
});

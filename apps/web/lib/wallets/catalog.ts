/**
 * What the wallet entry shows for each adapter: the key type, who signs what, and which
 * parts are SIMULATED. Written once here so the modal, the tests and the docs agree.
 */

export type WalletId = "ledger-stax-usb" | "ledger-stax-simulated" | "passkey-mac" | "demo-account";

/** A part of the setup that can be simulated. */
export type SimulatedPart = "node" | "device" | "authenticator" | "account";

export interface WalletDescription {
  id: WalletId;
  name: string;
  /** The key type of the account's own authority. */
  keyType: string;
  /** Who signs what, one line each. */
  signs: readonly string[];
  /** One sentence for the modal. */
  summary: string;
  /** Parts that are real when the backend is live; SIMULATED while it is not. */
  simulatedWhenBackendSimulated: readonly SimulatedPart[];
  /** Parts that are SIMULATED whatever the backend, until a real flow exists. */
  alwaysSimulated: readonly SimulatedPart[];
}

const LEDGER_KEY_TYPE = "ML-DSA-44 root key (post-quantum) plus the device's secp256k1 master key";

/** The real Stax: over USB (WebHID), through the Device Management Kit. Nothing simulated. */
export const LEDGER_STAX_USB: WalletDescription = {
  id: "ledger-stax-usb",
  name: "Ledger Stax (USB)",
  keyType: LEDGER_KEY_TYPE,
  signs: [
    "Master key (secp256k1, on the Stax): SetRegularKey and asfDisableMaster, during setup",
    "ML-DSA-44 key (on the Stax): everything the account's own authority signs, sessions included",
    "Session key (ML-DSA-44, made in the page): the transactions inside its session, no prompt",
  ],
  summary:
    "Your Stax over USB, with the XRP app open. Every own-authority transaction is read and confirmed on its screen, through the Device Management Kit. The account is the Stax's own: one already set up is used as it is.",
  simulatedWhenBackendSimulated: [],
  alwaysSimulated: [],
};

/** A software double of the Stax in this page: the same flow, no device. */
export const LEDGER_STAX_SIMULATED: WalletDescription = {
  id: "ledger-stax-simulated",
  name: "Ledger Stax (simulated)",
  keyType: `${LEDGER_KEY_TYPE}, both held by a software double in this page`,
  signs: [
    "Master key (secp256k1, simulated Stax): SetRegularKey and asfDisableMaster, during setup",
    "ML-DSA-44 key (simulated Stax): everything the account's own authority signs, sessions included",
    "Session key (ML-DSA-44, made in the page): the transactions inside its session, no prompt",
  ],
  summary:
    "No device: a software double of the Stax shows its review in this page. New keys, so a new account, at each connection.",
  simulatedWhenBackendSimulated: ["node"],
  alwaysSimulated: ["device"],
};

export const PASSKEY_MAC: WalletDescription = {
  id: "passkey-mac",
  name: "Passkey (this Mac)",
  keyType: "P-256 passkey (WebAuthn); not post-quantum",
  signs: [
    "Master key (secp256k1, in the page): PasskeyListSet, once, during setup",
    "Passkey (Touch ID or Face ID): opens sessions and signs what the account's own authority signs",
    "Session key (P-256, non-extractible): the transactions inside its session, no prompt",
  ],
  summary:
    "A passkey has full authority and cannot be replaced or removed once registered, so this account is not post-quantum.",
  simulatedWhenBackendSimulated: ["node"],
  alwaysSimulated: [],
};

export const DEMO_ACCOUNT: WalletDescription = {
  id: "demo-account",
  name: "Demo account",
  keyType: "secp256k1 master key, in memory, thrown away on reload",
  signs: [
    "Master key (in the page): everything the account's own authority signs",
    "Session key (P-256): the transactions inside its session, no prompt",
  ],
  summary: "A throw-away account to try the screens. Nothing is kept.",
  // On a live node the account is real (funded by its faucet); only its key is thrown away.
  simulatedWhenBackendSimulated: ["node", "account"],
  alwaysSimulated: [],
};

export const WALLET_DESCRIPTIONS: readonly WalletDescription[] = [
  LEDGER_STAX_USB,
  LEDGER_STAX_SIMULATED,
  PASSKEY_MAC,
  DEMO_ACCOUNT,
];

const PART_ORDER: readonly SimulatedPart[] = ["node", "device", "authenticator", "account"];

/**
 * The parts that are SIMULATED for `description`, given the backend mode and the passkey's
 * authenticator. The two Ledger entries do not depend on a choice made elsewhere: the USB one
 * is the real Stax, the other one is always the software double.
 */
export function simulatedParts(
  description: WalletDescription,
  backendSimulated: boolean,
  authenticatorSimulated = false,
): SimulatedPart[] {
  const parts = new Set<SimulatedPart>(description.alwaysSimulated);
  if (backendSimulated)
    for (const part of description.simulatedWhenBackendSimulated) parts.add(part);
  if (description.id === "passkey-mac" && authenticatorSimulated) parts.add("authenticator");
  return PART_ORDER.filter((part) => parts.has(part));
}

export const PART_LABELS: Record<SimulatedPart, string> = {
  node: "node",
  device: "Stax",
  authenticator: "passkey",
  account: "account",
};

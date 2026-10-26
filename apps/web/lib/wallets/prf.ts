/**
 * Where the post-quantum Mac account's PRF secret comes from: the browser's passkey (Touch ID,
 * real WebAuthn, only when the person presses a button) or the software double of
 * `@carbs/sessions` (tests and the simulation, SIMULATED). The vault itself is
 * `@carbs/sessions` (`keys/prf-vault.ts`), shared with `apps/passkey-wallet`.
 */
import { SoftwarePrfOracle, browserPrfOracle, type PrfOracle } from "@carbs/sessions";

export interface PrfSource {
  /** True for the software double (SIMULATED): no authenticator, no prompt. */
  simulated: boolean;
  /** The browser has WebAuthn in a secure context (whether it has PRF, only a ceremony tells). */
  available(): boolean;
  oracle: PrfOracle;
}

const RELYING_PARTY_NAME = "carbs";

export const PRF_UNAVAILABLE =
  "This account needs WebAuthn with the PRF extension, in a secure context (https or localhost): a recent Safari or Chrome on macOS with Touch ID.";

/** The browser's passkey. Every call opens the platform prompt, so it runs only from a click. */
export function browserPrfSource(): PrfSource {
  const oracle = (): PrfOracle =>
    browserPrfOracle(navigator.credentials, {
      rpId: location.hostname,
      rpName: RELYING_PARTY_NAME,
    });
  return {
    simulated: false,
    available: () =>
      typeof navigator !== "undefined" &&
      "credentials" in navigator &&
      typeof globalThis.PublicKeyCredential !== "undefined" &&
      globalThis.isSecureContext !== false,
    oracle: {
      simulated: false,
      create: (accountName) => oracle().create(accountName),
      evaluate: (credentialId, salt) => oracle().evaluate(credentialId, salt),
    },
  };
}

/** The software PRF double (SIMULATED): its secrets live as long as the object. */
export function softwarePrfSource(): PrfSource {
  return { simulated: true, available: () => true, oracle: new SoftwarePrfOracle() };
}

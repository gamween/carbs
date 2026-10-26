// Passkey used only as a WebAuthn PRF oracle: it is never registered on the ledger.
// After a Touch ID, the PRF extension returns a per-credential 32-byte secret,
// HMAC(credential secret, salt), that unlocks the ML-DSA-44 seed (see vault.ts).
//
// PRF support (known state, to be confirmed on the target machine):
// - Safari 18+ / macOS 15+ with iCloud Keychain passkeys: supported.
// - Recent Chrome (≥ 116 for PRF; iCloud Keychain passkeys on macOS since ~Chrome 132):
//   supported — not verified for the Chrome + iCloud Keychain combination.
// - Google Password Manager, FIDO2 security keys with hmac-secret: supported.
// - Recent Firefox (≥ 135?): not verified.
// - Automated tests: CDP virtual authenticator (WebAuthn.addVirtualAuthenticator,
//   protocol "ctap2", hasPrf: true, hasUserVerification: true, isUserVerified: true).
// Some platforms (iCloud Keychain in particular) return `prf.enabled: true` at creation
// without results: the secret is then only available at get(), hence evaluatePrf.

// The WebAuthn PRF ceremonies live in @carbs/sessions (browserPrfOracle), shared with the
// web app; this module keeps the wallet's own messages.

import {
  browserPrfAvailable,
  browserPrfOracle,
  PrfCancelledError,
  PrfUnsupportedError as CorePrfUnsupportedError,
  type PrfOracle,
} from "@carbs/sessions";

import { RELYING_PARTY_NAME } from "../passkey.ts";

export interface PrfPasskey {
  /** Credential id, base64url. */
  credentialId: string;
}

export class PrfUnsupportedError extends Error {
  constructor(
    message = "Ce navigateur ou cet authentificateur ne prend pas en charge l'extension PRF des passkeys.",
  ) {
    super(message);
    this.name = "PrfUnsupportedError";
  }
}

function oracle(): PrfOracle {
  return browserPrfOracle(navigator.credentials, {
    rpId: location.hostname,
    rpName: RELYING_PARTY_NAME,
  });
}

/** The shared module's errors, with the wallet's messages. */
async function withWalletMessages<T>(run: () => Promise<T>, unsupported: string): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PrfCancelledError) {
      throw new Error("Touch ID cancelled, refused or timed out: the passkey did not answer.", {
        cause: error,
      });
    }
    if (error instanceof CorePrfUnsupportedError) throw new PrfUnsupportedError(unsupported);
    throw error;
  }
}

export async function prfAvailable(): Promise<boolean> {
  return browserPrfAvailable();
}

export async function createPrfPasskey(accountName: string): Promise<PrfPasskey> {
  const credentialId = await withWalletMessages(
    () => oracle().create(accountName),
    "The passkey was created but the authenticator does not enable the PRF extension: the post-quantum key cannot be protected with it.",
  );
  return { credentialId };
}

export async function evaluatePrf(passkey: PrfPasskey, salt: Uint8Array): Promise<Uint8Array> {
  return withWalletMessages(
    () => oracle().evaluate(passkey.credentialId, salt),
    "The passkey returned no PRF secret: cannot unlock.",
  );
}

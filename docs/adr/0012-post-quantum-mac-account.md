# 0012. The Mac account is post-quantum: an ML-DSA-44 key sealed under a passkey's PRF secret

**Status:** Accepted (2026-10-25). Supersedes [0004](0004-non-extractible-p256-session-keys.md) and the Mac-account part of [0011](0011-two-account-profiles.md).

**Context.** After the hackathon the owner asked for both profiles to be post-quantum. The Mac account of 0011 kept its master key and a P-256 passkey with full authority, and its session keys were P-256 WebCrypto keys. A passkey list cannot be replaced or removed in this build (P6), so a P-256 passkey on an account stays a classical key with full authority for good. Apple's platform authenticator cannot create an ML-DSA-44 credential (COSE -48), so a post-quantum WebAuthn passkey from Touch ID is not available. The ML-DSA-44 passkeys of `PasskeyMLDSA` come from a hardware authenticator, the Stax's Security Key app.

**Decision.** The Mac account holds an ML-DSA-44 key, which becomes its `RegularKey`. The key is sealed in the browser under a key derived from a passkey's WebAuthn PRF output: HKDF-SHA256, then AES-256-GCM, with the account's address as associated data. This is the vault of the passkey wallet's #106, moved to `packages/core/src/keys/prf-vault.ts`.

- **Setup.** The passkey is never registered on the ledger; it serves only to release the PRF secret. A temporary master key in the page funds the account and sets the `RegularKey`. The ML-DSA-44 key then signs a proof transaction, and the master key is disabled only after the sealed key reads back from the browser's storage, because the sealed key is the only copy.
- **Session keys** are ML-DSA-44, generated in the client, one per session, as for the Ledger account.
- **The P-256 Mac path is removed from the web app.** The node and `@carbs/sessions` keep their P-256 code, which other packages and tests use.

**Consequences.**

- No classical key keeps authority over either profile once the migration has disabled the master key. The PRF credential is still a classical WebAuthn credential, used only as a local unlock.
- The account lives in one browser, behind one passkey: clearing the site's data or deleting the passkey loses it. A copy of the sealed key is kept under `carbs-vault:<address>`, and a disconnect or a cancelled setup keeps it.
- ML-DSA-44 session keys and the unsealed key live in page memory, as 0011 already says for the Ledger account.
- PRF with a real Touch ID is **UNVERIFIED**: only a virtual authenticator and a software PRF double were tested.

<div align="center">

# 🔐 carbs

**Post-quantum, delegable signing for the XRP Ledger: an ML-DSA-44 root key on a Ledger Stax, post-quantum passkeys, and signing sessions whose rules the ledger enforces and the device shows.**

[![Winner](https://img.shields.io/badge/%F0%9F%8F%86%20Winner-Ledger%20Protocol%20Innovation-f5b301?style=flat-square)](#winner-of-the-ledger-protocol-innovation-track)
[![Live demo](https://img.shields.io/badge/demo-carbs--kappa.vercel.app-000?style=flat-square)](https://carbs-kappa.vercel.app)
[![rippled](https://img.shields.io/badge/rippled-5%20amendments-363636?style=flat-square)](#on-the-ledger)
[![Ledger Stax](https://img.shields.io/badge/Ledger%20Stax-ML--DSA--44-7c3aed?style=flat-square)](#on-the-device)
[![Device Management Kit](https://img.shields.io/badge/Ledger-Device%20Management%20Kit-000?style=flat-square)](./docs/device-contract.md)
[![Upstream](https://img.shields.io/badge/upstream-device--sdk--ts%20%232052%20%C2%B7%20app--xrp%20%23101-1257d4?style=flat-square)](#contributing-back)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat-square)](./LICENSE)

🏆 **Winner — Ledger Protocol Innovation track ($4,000) · XRPL Hackathon NYC · New York, 24–25 October 2026**

**[Open the app](https://carbs-kappa.vercel.app)** · **[Demo video](https://youtu.be/aJu0FsRNgjk)** · **[Pitch video](https://youtube.com/shorts/xvWcqh40NrA)** · **[Sessions XLS draft](./docs/XLS-Sessions.md)** · **[PQ passkeys draft](./docs/XLS-PQ-Passkeys.md)** · **[Developer feedback](./docs/ledger-dx-feedback.md)** · **[Architecture](./docs/ARCHITECTURE.md)** · **[DEVLOG](./docs/DEVLOG.md)**

</div>

carbs lets an XRP Ledger account delegate signing without handing over its key, under a
post-quantum root. A Ledger Stax holds an **ML-DSA-44** key and clear-signs XRPL transactions with
it, so the account can retire its classical keys. A rippled amendment, **`SigningSessions`**, lets
the account open a short-lived key that signs with no prompt, inside limits the **ledger** checks
on every transaction: one of three modes, at most 10 minutes, a fee ceiling, and optional bounds on
spend, payment size, transaction count or a co-signer. A second amendment, **`PasskeyMLDSA`**,
makes passkeys post-quantum too, and Ledger's **Security Key** app on the Stax creates them. A
**quantum exposure check** tells any account whether its public key is already on the ledger.

> On the XRP Ledger a key holds all of an account's authority or none of it, so an app, a game or
> an AI agent that signs for you either holds your full key or asks you every time. XLS-75
> delegation gives rights to another funded account, with no expiry and no amount cap. And a public
> key that has signed once stays on the ledger for good: a forgery target for a future quantum
> computer. carbs moves the expiry, the caps and the post-quantum root into the protocol and the
> device.

> 🏆 **Winner of the Ledger Protocol Innovation track at the AI & Fintech XRPL Hackathon, New
> York, 24–25 October 2026.** A 36-hour event run by XRPL Commons with Ripple, the XRPL Foundation,
> Ledger, Mastercard, AWS and QuickNode. Ledger's [track brief](https://developers.ledger.com/xrplnyc)
> asked for a real device and weighed developer-experience feedback "as much as the code"; ours
> is [`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md). The prize: $4,000 for the team.
>
> **This repository is the maintained copy.** The version the jury judged is
> [`STOOOKEEE/carbs` at the tag `submission`](https://github.com/STOOOKEEE/carbs/tree/submission)
> (`ce42905`), also tagged `submission` here; everything after it is listed in the
> [DEVLOG](./docs/DEVLOG.md).

## Table of contents

- [Try it yourself](#try-it-yourself)
- [How carbs fits the tracks](#how-carbs-fits-the-tracks)
- [How it works](#how-it-works)
- [On the ledger](#on-the-ledger)
- [On the device](#on-the-device)
- [Every claim, verified](#every-claim-verified)
- [What building it made visible](#what-building-it-made-visible)
- [Limits and roadmap](#limits-and-roadmap)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Contributing back](#contributing-back)
- [Team](#team)
- [License](#license)

## Try it yourself

**Videos.** A [demo](https://youtu.be/aJu0FsRNgjk) (3:01, silent) walks through the flow with the
code that implements it, on the ledger and on the device; a
[vertical pitch](https://youtube.com/shorts/xvWcqh40NrA) (2:52, narrated) tells the story for
anyone. The Stax screens in them are Speculos emulator snapshots of the app, and the narration is
text-to-speech from a voice cloned from Sofiane's.

The web app is deployed at **https://carbs-kappa.vercel.app**, a static build of `apps/web`
(deployment notes in [`docs/DEPLOY.md`](./docs/DEPLOY.md)). The **Node** choice in the header picks
who answers:

- **Simulated** (default): a simulated node that applies the specification's rules in order and
  answers with their result codes, with a striped SIMULATED badge on every result that comes from it.
- **Local node**: the standalone node built from `rippled/` on your machine (`pnpm demo --no-web`,
  see [Getting started](#getting-started)).
- **Team node**: the team's server, reachable on the team's private network only.

No public network carries the amendments, so on a public visit Session, Actions and Attack run on
the simulation. The **Quantum** screen is always live: it reads the real public AlphaNet or mainnet
(mainnet only ever read) and migrates fresh AlphaNet accounts.

1. **Quantum.** Paste an AlphaNet or mainnet address: the report says whether each of its keys is
   already on the ledger, and which transaction first revealed it.
2. **Account.** Two profiles, both post-quantum:
   - **Ledger account**: the Stax's ML-DSA-44 key becomes the regular key and the master key is
     disabled. Pick the Stax over USB (WebHID, Chrome or Edge, the XRP app of this repository open)
     or its simulated double. An account the device already set up is recognised and reused.
   - **Mac account (Touch ID)**: an ML-DSA-44 key sealed in the browser and unlocked by Touch ID
     through the WebAuthn PRF extension becomes the regular key. No P-256 key reaches the ledger.
     The screen shows the reserve the node reports, never a hard-coded amount.
3. **Session.** Open a session in mode A, P or C: the device review shows its rules, then the page
   counts down and fills the spent bar.
4. **Actions.** Six transaction types signed by the session key, with no prompt.
5. **Attack.** Replay what a stolen key would try: change the keys, add a passkey, open a second
   session, burn fees, overspend the cap, sign after expiry.
6. **Apps.** The stage demos below, one card each: the session it opens (mode, Stax profile,
   limits), what the ledger and the Stax refuse, and a link that opens on the team's network.

The **Connect a wallet** dialog offers the real Stax over USB on a live node, and a simulated Stax,
always badged SIMULATED.

**The stage demos.** `apps/passkey-wallet` is a test wallet with five single-screen demos on the
amendment node, each opening one session and letting the session key act alone: an AI agent that
buys data from paid APIs on a mode C budget (a scripted compromised-agent step sends the 500 XRP a
prompt injection asks for, and the ledger refuses it with `tefSESSION_LIMIT`), an arcade of
micro-bets, a grid market maker limited to offers, a pay-per-second stream and a ticket minting
desk. It also holds the post-quantum passkey flow driven by a Stax. Run sheet:
[`apps/passkey-wallet/scripts/agent/README.md`](./apps/passkey-wallet/scripts/agent/README.md).

## How carbs fits the tracks

**Ledger Protocol Innovation** (bring the modern Ledger stack into XRPL, and lean into the gaps),
the track carbs won:

- **Things Ledger does not support yet.** ML-DSA-44 signing of XRPL transactions on the Stax, with
  a clear-signed review; ML-DSA-44 credentials (COSE -48) in Ledger's FIDO2 Security Key app, used
  as post-quantum passkeys that signed XRPL transactions on our node; a session policy and per-app
  profiles (agent, game, trading, streaming, minting) that the device enforces before any review.
- **XRPL transaction Clear Signing.** Two new transaction types clear-signed on the Stax
  (`SigningSessionSet`, `SigningSessionDelete`), every inner transaction of a `Batch` shown before
  it is signed, and session transactions never blind-signed. The client predicts the device's review
  line for line from the same fields, checked against frozen screen vectors
  ([`docs/device-contract.md`](./docs/device-contract.md)).
- **The Device Management Kit, and Ledger's XRP signer kit extended.** The client reaches the XRP
  app through the Device Management Kit only (WebHID), and through Ledger's official
  `device-signer-kit-xrp`, imported unmodified into `packages/signer-kit-xrp` and extended in its
  own style: `getPqPublicKey`, `signTransactionPq` and `getSessionPolicy`, and the app's session
  refusals in a separate error map. Its 106 upstream tests run unedited next to ours.
- **A real device.** The ML-DSA-44 root signed on the public AlphaNet, the Security Key app's
  post-quantum passkey signed a payment and a session on our node, and the web app set up a Ledger
  account on the team's node, all on our Stax.
- **Developer feedback**, weighed by the track as much as the code: 62 entries and 568 minutes lost
  where we measured them, in [`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md). Two of
  its findings are now upstream pull requests ([below](#contributing-back)).

**Protocol Innovation, XRPL Commons** (core infrastructure, clients and developer tooling):

- **Core infrastructure, in C++.** Five amendments in rippled ([below](#on-the-ledger)): signing
  sessions, post-quantum passkeys, and three fixes to defects of the base, each with a test that
  failed first. Two XLS drafts written from the implementation.
- **Client.** `@carbs/sessions`: definitions read from `server_definitions`, encoding, session keys,
  ML-DSA-44 passkeys, the PRF vault, the node client and the quantum exposure check.
- **Developer tooling.** A native fuzz loop for the XRP app's parser, a per-assertion record of the
  base tree's own failures, and the developer feedback log.

## How it works

```text
owner: the Stax's ML-DSA-44 root (Ledger account) or a Touch ID-sealed ML-DSA-44 key (Mac account)
  └─▶ SigningSessionSet, one ordinary signature; the Stax shows the rules in clear
       └─▶ SigningSession entry: session key, Expiration (at most 600 s), mode A, P or C,
           optional SessionMaxPerTx, SessionMaxTxCount, SessionWitness
            └─▶ the session key signs with no prompt, LastLedgerSequence on every transaction
                 ├─ inside the rules  → applied; the entry counts XRP spent and transactions
                 └─ outside the rules → tefSESSION_*: never in a ledger, no fee
            └─▶ SigningSessionDelete: by the owner, by the key itself, or by anyone after expiry
```

**1. A post-quantum root in hardware.** The XRP app on the Stax derives an ML-DSA-44 key from the
device's own SLIP-21 key, so from its 24 words, and signs XRPL transactions with it after showing
them in clear. The account moves to it in three transactions, in an order the node enforces:
`SetRegularKey` to the ML-DSA key, signed by the master key; a proof transaction signed by the
ML-DSA key; then `asfDisableMaster`, which only the master key may set. The old classical key then
gets `tefMASTER_DISABLED`. The client refuses the last step until the proof is validated, the key is
shown recoverable (or backed up) and the account's other authorities are reviewed. Builds before 25
October derived one public key on every device ([below](#every-claim-verified)).

**2. Sessions enforced by the ledger.** The account opens a session with **one ordinary
signature** from a key that already has full authority. It is not a multisig. The session key then
signs alone, in exactly one mode:

| Mode  | The session key may                                                            | Bound                                              |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------------- |
| **A** | sign every delegable transaction type except five (66 types, pinned by a test) | time, fee ceiling                                  |
| **P** | sign the 1 to 10 XLS-75 permissions it lists                                   | time, the list, fee ceiling                        |
| **C** | send direct XRP `Payment` only                                                 | time, a total XRP cap (fees included), fee ceiling |

Optional bounds, in any combination, each checked by the ledger:

| Field                              | Mode | The ledger refuses                                                                     | With                    |
| ---------------------------------- | ---- | -------------------------------------------------------------------------------------- | ----------------------- |
| `SessionMaxPerTx`                  | C    | a payment above it, its fee not included                                               | `tefSESSION_LIMIT`      |
| `SessionMaxTxCount` (1 to 100,000) | any  | any transaction once the session has signed that many                                  | `tefSESSION_LIMIT`      |
| `SessionWitness`                   | any  | a transaction without the witness account's co-signature (`WitnessSignature`, `WTS\0`) | `tefSESSION_NO_WITNESS` |

Time runs on the ledger's clock: `Expiration` is the parent ledger's close time at opening plus at
most 600 seconds, compared with the parent close time of each later ledger. A session key can never
change who controls the account: no session signs `SetRegularKey`, `SignerListSet`,
`PasskeyListSet` or `AccountSet`, and the `ValidSigningSession` invariant checks after every
session-signed transaction that the account's keys, signers, passkeys, delegates, beneficiary and
firewall did not move. The key can always give up its session: its own close escapes the expiry,
the cap and the witness, and pays at most the base fee of its type, so a mode C account loses at
most the cap plus one base fee. The owner revokes with any full-authority key, by sequence or by
ticket, and a session key can neither use the account's tickets nor outbid the owner's queued
close.

Two account profiles share the engine, and neither puts a classical key in the flow once the
migration has disabled the master key:

| Profile                      | Full authority                                                                                  | Opens a session with                             | Session key                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------ |
| **Ledger account** (default) | the Stax's ML-DSA-44 key as `RegularKey`, master key disabled, never a passkey                  | an ML-DSA-44 signature on the Stax, clear-signed | ML-DSA-44, made in the client, fresh per session |
| **Mac account (Touch ID)**   | an ML-DSA-44 key as `RegularKey`, sealed in the browser and opened by Touch ID; master disabled | that ML-DSA-44 key                               | ML-DSA-44, made in the client, fresh per session |

Apple's platform authenticator cannot create an ML-DSA-44 passkey (COSE -48), so the Mac account
uses the passkey only as a PRF oracle: the WebAuthn PRF extension releases a per-credential
secret, HKDF-SHA256 derives a key from it, and AES-256-GCM, with the account's address as
associated data, opens the sealed ML-DSA-44 key. The master key is disabled only once the sealed
key reads back from the browser's storage, since it is the only copy. PRF with a real Touch ID has
not been verified yet: it ran with a virtual authenticator and a software PRF double.

**3. Post-quantum passkeys.** Under `PasskeyMLDSA`, a passkey list holds ML-DSA-44 keys next to
P-256 ones, and a `PasskeySignature` made with one is verified as pure ML-DSA-44 over
`authenticatorData ‖ SHA-256(clientDataJSON)`. It authorizes only through the list entry that holds
the key under the same `PasskeyID`, so a relay cannot change the `PasskeyID` and with it the
transaction's ID. The Stax creates such passkeys with the Security Key app of this repository
([below](#on-the-device)). Specification: [`docs/XLS-PQ-Passkeys.md`](./docs/XLS-PQ-Passkeys.md).

**Key rotation on every payment** (#105) keeps even the classical exposure to one key per payment:
with the master key disabled, each payment is an all-or-nothing `Batch` signed by the current
`RegularKey` that carries the payment and a `SetRegularKey` to the next key, so a payment reveals
only the key it retires. The suite `KeyRotationBatch` checks it on the ledger state.

**4. A quantum exposure check.** `checkExposure` (in `@carbs/sessions`) answers `exposed`,
`no-exposure-found` or `unknown` for any account, with the transaction that first revealed each
key. It tells the master key from the regular key and the other authorities, reports separately
what survives `asfDisableMaster` (passkeys, a beneficiary key, delegates, signer lists), and
answers `unknown` rather than guessing when the node's history or the search bound does not cover
the account. Mainnet is only ever read.

## On the ledger

Five amendments on `XRPLF/rippled` `alphanet`, all enabled in the genesis ledger of our standalone
node ([`infra/standalone.cfg`](./infra/standalone.cfg)). The public AlphaNet carries none of them.

| Amendment                    | What it does                                                                                                                                                         | Why                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `SigningSessions`            | the session ledger entry, `SigningSessionSet`, `SigningSessionDelete`, the authorization check and the invariant below; requires XLS-75's `PermissionDelegationV1_1` | bounded, expiring delegation enforced by every node                             |
| `PasskeyMLDSA`               | ML-DSA-44 keys in passkey lists and ML-DSA-44 WebAuthn signatures, bound to their `PasskeyID`; requires `Passkey`, `Quantum` and `fixP256StrictDer`                  | a P-256 passkey keeps full authority: a quantum backdoor next to an ML-DSA root |
| `fixPasskeyChallenge`        | the WebAuthn challenge is compared as bytes                                                                                                                          | defect P5: every passkey signature failed where `char` is signed                |
| `fixP256StrictDer`           | strict DER and a low S for every P-256 signature a transaction carries, and no signature field left unread                                                           | relays could change the hash of P-256 and passkey-signed transactions           |
| `fixPasskeyListNotDelegable` | `PasskeyListSet` is no longer delegable                                                                                                                              | defect P7: a delegate could add its own passkey, with full authority            |

The sessions on the ledger:

| Signing sessions | On the ledger                                                                                  | Notes                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| A session        | `SigningSession` entry (`signing_session`)                                                     | one per account and session key, one owner reserve, never reserve-sponsored                             |
| Opening          | `SigningSessionSet`                                                                            | not delegable, never signed by a session; refused for a key that already has authority over the account |
| Closing          | `SigningSessionDelete`                                                                         | by the owner, by the session key itself, or by anyone once it has expired, to reclaim the reserve       |
| Time             | `SessionDuration`, then `Expiration`                                                           | 1 to 600 seconds, on the parent ledger's close time                                                     |
| Mode             | `tfAllTransactions`, `Permissions` or `SessionCap`                                             | exactly one                                                                                             |
| Spend and count  | `SessionSpent`, `SessionTxCount`                                                               | the only fields that ever change                                                                        |
| Co-signer        | `SessionWitness`, `WitnessSignature`                                                           | signed by the witness account's master key or `RegularKey`                                              |
| Refusals         | `tefSESSION_TX_NOT_ALLOWED`, `tefSESSION_EXPIRED`, `tefSESSION_LIMIT`, `tefSESSION_NO_WITNESS` | `tef`: never in a ledger, never a fee                                                                   |

What every node checks on a session-signed transaction, in this order:

| #   | Rule                                                                                                                  | Refusal                                     |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 0   | not a pseudo-account; the key type may sign (P-256 needs `Passkey` and `fixP256StrictDer`, ML-DSA-44 needs `Quantum`) | `tefBAD_AUTH`, `tefSESSION_TX_NOT_ALLOWED`  |
| 1   | the mode allows the type; never `Batch` or `LoanSet`; no `TicketSequence`, except for the own close                   | `tefSESSION_TX_NOT_ALLOWED`                 |
| 2   | `LastLedgerSequence` present, at most 256 ledgers ahead                                                               | `tefSESSION_TX_NOT_ALLOWED`                 |
| 3   | before `Expiration` (the own close is exempt)                                                                         | `tefSESSION_EXPIRED`                        |
| 4   | `Fee` at most the base fee of the type plus 1,000 base fee units (the own close: its base fee only)                   | `tefSESSION_LIMIT`                          |
| 5   | mode C: `Fee + Amount` within what is left of `SessionCap`, and `Amount` within `SessionMaxPerTx`                     | `tefSESSION_LIMIT`                          |
| 6   | fewer than `SessionMaxTxCount` transactions signed so far                                                             | `tefSESSION_LIMIT`                          |
| 7   | a `WitnessSignature` from the witness account when the session has one, and none otherwise                            | `tefSESSION_NO_WITNESS`, `tefBAD_SIGNATURE` |

The check replaces the transaction's signature check in `preclaim`, so a refusal is never included
in a ledger and never charged. Accounting runs at exactly two places in `Transactor::operator()`, so
a fee-claiming `tec` counts too: a leaked mode C key that only burns fees is stopped by its cap
(the anti-drain test). The invariant ties `SessionSpent` to the XRP that actually left the account.
`ledger_entry` reads a session by index or by account and session key, `account_objects` lists
them, and `server_definitions` serves every new type, field and code: the client reads them from
the node, never from a hand-typed table.

**What modes A and P do not bound.** They bound when the key can sign, not what the signed
transactions leave behind: an escrow, a check, a channel or an offer outlives the session. Only
mode C bounds the XRP that leaves the account, and `SessionMaxTxCount` bounds how many transactions
any mode signs. Every rule, with the `path:line` that implements it, is in the XLS draft,
[`docs/XLS-Sessions.md`](./docs/XLS-Sessions.md).

## On the device

Two Ledger apps run on the Stax, both imported unmodified from Ledger and then extended
([`UPSTREAM.md`](./UPSTREAM.md)).

**The XRP app** (`ledger-app/`, from `LedgerHQ/app-xrp` 2.8.2) gains a post-quantum signing path
and guardrails for sessions. The client reaches it through the Device Management Kit only, over
WebHID; every APDU, status word and screen line is in
[`docs/device-contract.md`](./docs/device-contract.md).

- **The ML-DSA-44 root.** Three instructions: `0x10` reads the 1,312-byte public key, `0x11` takes
  the signing data in chunks (at most 2,048 bytes, key included), `0x12` returns the 2,420-byte
  signature. Pure ML-DSA-44 over `STX\0` and the fields, exactly what the node verifies. The seed is
  the device's SLIP-21 key; an all-zero output is refused. Built for Stax, Flex and Apex P; the
  working buffers overlay the transaction context to fit 36 KB of SRAM.
- **Clear signing on the post-quantum path.** The app strips the prefix, runs the transaction
  through its own parser and shows the same review as a classical signature. While a review is on
  screen the bytes cannot change: an approval signs only what was shown (a SHA-256 check), and an
  instruction change cancels the review. The blind-signing setting is honoured.
- **Sessions in clear, never blind.** A `SigningSessionSet` reads _Open session_, the account, the
  session key and its **Agent ID** (the first 4 bytes of its AccountID, which the agent prints
  too), then _Allows_, _Valid for_, _Max spend_, _Max per payment_, _Witness_, _Max transactions_
  and the note _Cannot change keys or signers_. A session transaction the app cannot show in full
  is refused (`0x6815`) whatever the blind-signing setting, and a signed field that forges one of
  the app's own rows is refused.
- **The owner's own limits.** A session policy, edited only on the device (max spend, max per
  payment, max duration, modes A and P allowed, witness required), is checked before any review,
  on both signing paths: above it the Stax says why and answers `0x6986`. Five profiles (agent,
  game, trading, streaming, minting), named by a memo, carry their own limits and require a
  transaction count; the review names a profile only when the policy is on and the session fits it.
- **Batch.** A `Batch` is clear-signed inner transaction by inner transaction; one the app cannot
  read to its end is refused, since a session could hide in the unread part.

**The Security Key app** (`security-key-app/`, from `LedgerHQ/app-security-key` 1.7.8) gains
ML-DSA-44 credentials: getInfo lists COSE -48, makeCredential returns an AKP key of 1,312 bytes
derived in place (never stored), and getAssertion signs `authData ‖ clientDataHash` with pure
ML-DSA-44. Offered over USB CTAPHID only, where the 2,420-byte signature fits the reply; Stax, Flex
and Apex P. Details in [`security-key-app/CARBS.md`](./security-key-app/CARBS.md).

**Not claimed.** Ledger's v1 ML-DSA has no side-channel or fault-injection countermeasures, by
Ledger's own statement. A side-loaded Security Key app attests with the app's public test key, not
as a genuine Ledger. The screen proves the rules, not who holds the session key.

## Every claim, verified

### On a real Ledger Stax

| What                                             | Where                    | Result                                                                                                                                                         |
| ------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three ML-DSA-44 payments signed by the XRP app   | public AlphaNet, 24 Oct. | `tesSUCCESS`, verified with `@noble/post-quantum` before submission; see the correction below                                                                  |
| A post-quantum passkey from the Security Key app | our standalone node      | `PasskeyListSet`, a 5 XRP `Payment` and a mode C `SigningSessionSet`, each a real CTAP2 assertion approved on the device, `tesSUCCESS`; 4 to 6 s per assertion |
| The device's registration bytes                  | `packages/core` fixture  | the TypeScript parser reads them and returns the same key as python-fido2                                                                                      |
| The web app's Ledger account                     | the team's node, 25 Oct. | `SetRegularKey`, the ML-DSA-44 proof and `asfDisableMaster`, each `tesSUCCESS`; the Stax refused a session above its policy (`0x6986`)                         |

The ML-DSA-44 payments on the public AlphaNet:

| Signed by                                      | Review on the Stax                                                                | Account                              | Transaction hash                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| the XRP app of this repository                 | **clear**: the app parsed the payment and showed its type, amount and destination | `rGcT27HiGhoJWYRxqg9jcnPboGD4RGuLLm` | `46F4D08446F73FDF4DA648EB5E050B7BF0C8FA882B35B53B8D90E2BFD6F6F3EE` |
| the XRP app of this repository                 | blind: the message size and a SHA-256 prefix                                      | `rpxMtodcdjFGpssK5k7D4CixifFBCLS7eV` | `7654683C8DBBD091941A6BBD369DA25F0E5888B2C5C21A1340DFDCD6C652436B` |
| a throw-away spike app, not in this repository | blind                                                                             | `rs3drHLeUPmQmnYNmeVGnFwY68xDnA5G8T` | `B55E26D1E387C2D277A9EA8F7AE4AC1F98FEFE6A28796DB51F4EFD30710C698D` |

> **Correction (25 October): the key of the first two accounts is not secret.** The XRP app then
> derived its ML-DSA-44 seed from bytes the OS never writes, so every device produced
> `ML-DSA-44.KeyGen_internal(32 zero bytes)`, whose address is
> `rDX7hJiDtUVUnN2tjRqswtuZcbE88yi9i2`. `rGcT27…` and `rpxMto…` are test accounts with no value,
> controlled by anyone who runs that key generation. The signatures were made and checked on the
> Stax, so they prove the review and signing path, not a hardware-held secret. The fixed app (#120)
> derives the key from the device's own SLIP-21 key, tested failing first and checked on Speculos
> with two different seeds; the Stax used for the demos still ran the earlier build. The spike
> account `rs3drH…` came from another app and derivation, which this correction does not cover.

The public AlphaNet keeps a rolling window of recent ledgers, so it no longer serves these
transactions; each account still shows an ML-DSA key account as `RegularKey` and its master key
disabled. Account page:
[`rGcT27…`](https://custom.xrpl.org/alphanet.xrpl.org/accounts/rGcT27HiGhoJWYRxqg9jcnPboGD4RGuLLm).

### The amendments, on our node

- **Every case of the sessions test plan asserts its exact result code**: suites `SigningSessions`
  and `SigningSessionsBatch` (56 cases, 3,955 checks) and `InvariantsSigningSession` (one test per
  invariant rule on a mutated view). `PasskeyMLDSA` holds 19 cases and 1,038 checks, `P256StrictDer`
  and the passkey suites pass alongside.
- **Tests first, then mutations.** Each rule's test was run failing before its code existed, then
  proven to bite: a temporary mutation of the rule makes it fail, and is reverted. For
  `PasskeyMLDSA` alone, seven gates were removed one at a time, each caught by 2 to 45 failures. The
  counts are in the DEVLOG.
- **The full rippled suite**, on the tree of `PasskeyMLDSA`: 288 suites, 5,468 cases, 1,318,716
  tests. Its failures are the imported tree's own, listed per assertion in
  [`docs/base-failures.txt`](./docs/base-failures.txt) before we changed anything, plus suites that
  fail only under parallel jobs and pass alone. No failure comes from our code.
- **An independent vector.** A WebAuthn ML-DSA-44 assertion made by `@noble/post-quantum` over the
  signing data `ripple-binary-codec` encodes is verified by the node as it is, and refused with one
  bit changed.
- **On a real node.** The web app's live backend, driven from Node against the standalone node
  (`pnpm --filter web live-run`, which asserts every code), as recorded in the DEVLOG on 24 October:

```text
[A] open: tesSUCCESS
[A] action payment, offer, trust, ticket, mint, check: tesSUCCESS (six times)
[A] attack regular-key, passkey, disable-master, open-session: tefSESSION_TX_NOT_ALLOWED, fee charged: false
[A] attack fee-burn: tefSESSION_LIMIT fee charged: false
[A] attack no-last-ledger: tefSESSION_TX_NOT_ALLOWED fee charged: false
[A] attack other-account: tefBAD_AUTH fee charged: false
[A] own close: tesSUCCESS
[P] (the same, with the six types listed): identical results
[C] open: tesSUCCESS
[C] payment 1..5: tesSUCCESS, spent 3500010, 7000020, 10500030, 14000040, 17500050
[C] payment 6: tefSESSION_LIMIT, spent 17500050
[C] ticket: tefSESSION_TX_NOT_ALLOWED
[C] cap overflow: tefSESSION_LIMIT
[expiry] after expiry: tefSESSION_EXPIRED
[expiry] own close: tesSUCCESS
```

### The client, the web app and the devices

- **759 TypeScript tests**: `@carbs/sessions` 132, Ledger's XRP signer kit 205 (106 of them
  upstream's, unedited), `@carbs/ledger` 74, the web app 329, the passkey wallet 7, `scripts` 12.
  CI runs the format check, the typecheck, these tests and a scan of the static build (no inline
  script, no third-party origin) on every pull request.
- **The client and the device agree byte for byte.** `encodeForDevice` reproduces the session
  vectors of the Ledger app, and the client's predicted review reproduces the app's frozen screen
  vectors line for line.
- **The XRP app.** cmocka unit tests (the ML-DSA instructions 26 of 26, the session policy 23 of 23) and Ragger snapshots on the Speculos emulator: the whole suite on the Stax model, 144 passed;
  emulator screens, not photographs of the Stax.
- **The Security Key app.** LedgerUT suites for the COSE AKP bytes, the derivation chain and
  wiping, the registration and assertion responses, transports and getInfo, with mutations caught.
- **Fuzzed.** The XRP app's transaction parser and session policy, built natively under
  AddressSanitizer and UndefinedBehaviorSanitizer, took 448 million random mutations in 15 minutes
  with no crash (`ledger-app/fuzzing/native/run.sh`). This loop is not coverage-guided.
- **Reviewed.** Protocol and device changes went through independent read-only review gates, whose
  verdicts are in the DEVLOG. They found defects in our own work too, such as a `WitnessSignature`
  that anyone could add to change a transaction's hash (#92), or an approval after an instruction
  change that signed bytes nobody reviewed (#122). Each fix landed with a test that failed first.

### What is real, what is simulated, what is not done

|                               | Real                                                                                                                                         | Simulated, or not done                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node with the amendments**  | a standalone `xrpld` built from `rippled/`; every mode, refusal and the expiry checked against it                                            | not on a public network                                                                                                                                        |
| **Ledger Stax, XRP app**      | the ML-DSA-44 root on the AlphaNet; the web app's Ledger account on the team's node; the policy refusal                                      | the Stax used for the demos runs the build before the seed fix (#120); the other device screens are emulator snapshots                                         |
| **Ledger Stax, Security Key** | registration and assertions over CTAP2 (python-fido2), accepted by our node                                                                  | the browser ceremony with `alg: -48` (Chrome forwarding it to the Stax) is untested                                                                            |
| **Mac account**               | the PRF vault's cryptography and the setup sequence, under tests                                                                             | PRF with a real Touch ID is unverified: a virtual authenticator and a software PRF double only                                                                 |
| **Web app**                   | the Quantum screen against the real AlphaNet and mainnet; the live backend against the amendment node; the Ledger account on the team's node | on a public visit Session, Actions and Attack are SIMULATED; the wallet dialog's USB entry and the reuse of a set-up account ran against software doubles only |
| **Not done**                  |                                                                                                                                              | a coverage-guided fuzzing run; an end-to-end test in CI (the rippled and device suites run by hand, recorded in the DEVLOG)                                    |

## What building it made visible

Developer feedback is a deliverable of the Ledger track, written as we went:
[`docs/ledger-dx-feedback.md`](./docs/ledger-dx-feedback.md) holds 62 entries and 568 minutes lost
where we measured them. The recurring pattern is not missing features but unstated facts. What cost
us the most:

- **ML-DSA is not in the Stax's OS crypto library.** It sits in the SDK sources, not in
  `cx.export`, so an app compiles it itself; `HAVE_MLDSA_OPTIMIZATION` selects the low-RAM variant,
  not a faster one, and the budget is tight: about 31 KB of statics on 36 KB of SRAM that also holds
  the stack.
- **What SLIP-21 derivation writes is unstated.** The OS writes the 32-byte key at the start of a
  64-byte buffer; our app read the other half, so every device derived the same ML-DSA key (#120).
- **Clear-signing a new XRPL transaction type touches about eight places** in app-xrp, and a missed
  one silently falls back to blind signing or "Unknown".
- **Who adds the signing prefix is unstated.** The app prepends `STX\0` itself and the Device
  Management Kit forwards the bytes unchanged; a client that adds it gets its transaction refused.
  Now proposed upstream ([below](#contributing-back)).
- **Loading from macOS.** Docker Desktop does not pass USB to a container, so loading goes through
  `ledgerblue`; a locked device answers `0x5515`, an open app `0x6d00`.
- **The XRPL side.** A browser cannot POST JSON to the AlphaNet RPC (its CORS preflight answers
  400); `ripple-binary-codec` 2.11.0 leaves `PermissionValue` without a serializer under custom
  definitions; xrpl.js rejects `PasskeyListSet`; and a standalone node seeds its genesis amendments
  from `[amendments]`, not `[features]`, with reserves of 10 XRP unless `[voting]` says otherwise.

**In the imported bases:**

- **P5, the WebAuthn challenge.** Where `char` is signed (x86-64, macOS on arm64), the challenge
  comparison fails for any byte at or above `0x80`, and every challenge holds one: the unchanged
  node refuses every WebAuthn signature. Fixed behind `fixPasskeyChallenge`.
- **P-256 malleability.** The DER parser accepted non-canonical forms and a high S and could read
  one byte past a signature, and a `PasskeySignature` or a `TxnSignature` could sit unread next to
  the signature that counts: anyone relaying a P-256 or passkey-signed transaction could change its
  hash. Fixed behind `fixP256StrictDer`, plus two fixes that need none. Still open on the P-256 path:
  `PasskeySignature.PasskeyID` is neither signed nor checked (the ML-DSA-44 path binds it).
- **P6, the passkey list.** A second `PasskeyListSet` fails with `tefEXCEPTION`, so a passkey can
  be neither rotated nor revoked while it keeps full authority (not fixed).
- **P7, a delegated passkey.** `PasskeyListSet` was delegable, so a delegate could register its own
  key as the account's passkey. Fixed behind `fixPasskeyListNotDelegable`.
- **A `Batch` hides a failed key migration.** An all-or-nothing `Batch` of `SetRegularKey` and
  `asfDisableMaster` returns `tesSUCCESS` and applies neither, because an inner transaction carries
  no signature of its own; now pinned in a test.
- **The alphanet tree fails its own suites**: 201 assertions in seven suites, and one gtest, so
  every change was judged per assertion against [`docs/base-failures.txt`](./docs/base-failures.txt).

## Limits and roadmap

| Limit                                                                            | Bounded today by                                                                                 | Roadmap                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| ML-DSA-44 session keys live in page memory: WebCrypto has no ML-DSA              | the ledger-side bounds, a fresh key per session, CSP `script-src 'self'`                         | a non-extractible ML-DSA key from the platform    |
| The Mac account's sealed key lives in one browser's storage                      | the master key stays enabled until the sealed key reads back; the page says so                   | a backup, or a hardware passkey that holds ML-DSA |
| A Ledger-account transaction carries a 1,312-byte key and a 2,420-byte signature | the base fee is unchanged; the device signs at most 2,048 bytes                                  | measure the largest transactions                  |
| A passkey list can be neither replaced nor removed (P6)                          | a Ledger account never gets a passkey                                                            | a protocol fix upstream                           |
| `PasskeyID` unbound on the P-256 path                                            | the client finds a transaction by account and sequence; carbs' own profiles use no P-256 passkey | report it upstream                                |
| The base fixes exist on our node only                                            | the three fix amendments there; the public AlphaNet has none                                     | offer them upstream                               |
| Ledger's v1 ML-DSA on the device has no side-channel countermeasures             | stated wherever the root key is described                                                        | Ledger's hardened ML-DSA                          |
| A `Batch` cannot migrate keys atomically                                         | three transactions with a proof step in between                                                  | none needed                                       |

## Tech stack

- **Protocol**: C++, five amendments on `XRPLF/rippled` `alphanet` (xrpld 3.4.1, imported at
  `68bd02b647`), with jtx and gtest suites.
- **Devices**: C. The XRP app (`LedgerHQ/app-xrp` 2.8.2) and the Security Key app
  (`LedgerHQ/app-security-key` 1.7.8) with the Ledger Secure SDK's ML-DSA in its low-RAM variant and
  NBGL screens; cmocka and LedgerUT unit tests, Ragger on the Speculos emulator.
- **Client**: TypeScript 5.9 strict. `ripple-binary-codec` 2.11.0 with the node's own
  `server_definitions` (xrpl.js rejects the new types), `@noble/post-quantum` 0.7.1 for ML-DSA-44,
  WebAuthn with PRF, and the Ledger Device Management Kit 1.11.0 over WebHID with Ledger's XRP
  signer kit 0.3.0, extended: no legacy ledgerjs package.
- **Web app**: Nuxt 3, Vue 3 and Tailwind, generated from XRPL Commons' `create-xrp` 0.5.0; a
  wallet entry on the `xrpl-connect` 1.0.0 `WalletAdapter` interface; CSP `script-src 'self'` and no
  third-party script; a static build on Vercel.
- **Infra**: a standalone `xrpld` with mainnet's reserves, its ledger closer (one ledger every 3
  seconds) and a dev faucet, started together by `pnpm demo`; Docker Compose for the team's stack.
- **Agent demo**: an OpenAI-compatible LLM endpoint (a local Ollama model by default) and a mock
  x402 merchant.

## Repository structure

```text
rippled/                XRPLF/rippled alphanet, imported unmodified, then the five amendments
  include/xrpl/tx/SigningSession.h      the session-signed predicate and the excluded types
  src/libxrpl/tx/transactors/session/   SigningSessionSet, SigningSessionDelete
  src/test/app/                         SigningSessions, PasskeyMLDSA, P256StrictDer, among the suites
ledger-app/             LedgerHQ/app-xrp, imported unmodified, then clear signing, ML-DSA-44 and the session policy
  src/pq/               the post-quantum root, instructions 0x10 to 0x12
  src/policy/           the session policy and its profiles
security-key-app/       LedgerHQ/app-security-key, imported unmodified, then ML-DSA-44 credentials (CARBS.md)
packages/core/          @carbs/sessions: definitions, encoding, session keys, passkeys, PRF vault, node client, exposure check
packages/ledger/        @carbs/ledger: the device contract over the Device Management Kit, and a software double
packages/signer-kit-xrp/  Ledger's XRP signer kit, imported unmodified, then the ML-DSA-44 root and the session policy
apps/web/               the web app: six screens, the wallet entry, a static build
apps/passkey-wallet/    the test wallet and the stage demos: agent, game, DEX, stream, mint, PQ passkey
infra/                  the standalone node's configuration, the ledger closer, the compose stack
scripts/                pnpm demo: the node, the closer, a dev faucet and the web app on the live backend
docs/
  XLS-Sessions.md       the sessions XLS draft, written from the implementation
  XLS-PQ-Passkeys.md    the post-quantum passkeys draft
  ARCHITECTURE.md       map, wire formats, flows, hook points, limits and roadmap
  device-contract.md    every APDU, status word and screen line between the client and the app
  ledger-dx-feedback.md the developer feedback deliverable
  DEVLOG.md             what was done, simulated, failed or not run, dated
  base-failures.txt     the imported tree's own test failures, one assertion per line
FIANSO-SPEC.md          the specification (Sofiane's), the reference for every decision
UPSTREAM.md             what was imported, from where, at which commit, under which licence
```

## Getting started

Node 22.18 or newer and pnpm 10.33.0 (`.nvmrc`, `package.json`).

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck        # also prepares Nuxt, which the web app's tests need
pnpm test             # every package, the web app and scripts

# the standalone node with the amendments, its closer, a dev faucet and the web app on the live backend
XRPLD_BIN=/path/to/xrpld GENESIS_SEED=… pnpm demo
# with the node started by `pnpm demo --no-web`: the flows of the DEVLOG, asserting the node's codes
pnpm --filter web live-run
```

The daemon builds from `rippled/` with Conan and CMake ([`docs/BUILDING.md`](./docs/BUILDING.md),
recorded from a working build), and the protocol suites run from its build directory:

```sh
./xrpld --unittest=SigningSessions,SigningSessionsBatch,InvariantsSigningSession,PasskeyMLDSA,P256StrictDer
```

The Ledger apps build in the `ledger-app-builder` image and load from macOS with `ledgerblue`
(`ledger-app/carbs/load_stax.sh`, `security-key-app/carbs/load_stax.sh`); after loading the XRP app,
`ledger-app/carbs/pq_key_check.py` checks that the device derives its own key, not the zero-seed
one. The genesis seed of `pnpm demo` comes from the environment: it is never written, and never
passed to the node, the closer or the web app.

### Ripple DevRel DevEx capture hook (optional, per developer)

Builders who use a coding agent are asked to install the hook from `RippleDevRel/xrpl-devex-hook`.
It records XRPL friction pseudonymously and nothing without an XRPL keyword. Each developer
consents on their own; it is **not** committed to this repository. Follow the instructions in that
repository, then use `/xrpl-feedback <what happened>` whenever the XRPL or Ledger documentation, the
SDKs or the node cost you time.

## Contributing back

**Sent to Ledger** (small and factual, from the developer feedback log):

- [LedgerHQ/device-sdk-ts#2052](https://github.com/LedgerHQ/device-sdk-ts/pull/2052): document the
  bytes the XRP signer kit's `signTransaction` expects (the app adds `STX\0`), and fix the README
  example, which throws as written.
- [LedgerHQ/app-xrp#101](https://github.com/LedgerHQ/app-xrp/pull/101): document the signing prefix
  and correct the status-word table (`6982` is not a user refusal; `6985` is), which the signer kit
  copies.

**Ready, not sent:**

- The three base fixes, `fixPasskeyChallenge`, `fixP256StrictDer` and `fixPasskeyListNotDelegable`,
  each with tests that failed before its fix. The unsigned P-256 `PasskeyID` is documented in
  `rippled/API-CHANGELOG.md` under _Known issues_, and P6 in the DEVLOG.
- The two XLS drafts, [`docs/XLS-Sessions.md`](./docs/XLS-Sessions.md) and
  [`docs/XLS-PQ-Passkeys.md`](./docs/XLS-PQ-Passkeys.md).
- The signer kit extension ([`UPSTREAM-PR.md`](./packages/signer-kit-xrp/UPSTREAM-PR.md)), kept
  here: it targets instructions only this repository's XRP app answers.

Commits and pull requests follow rippled's conventions (section 14 of the specification,
[`.github/pull_request_template.md`](./.github/pull_request_template.md)). The imported directories
are unmodified upstream imports up to their import commits ([`UPSTREAM.md`](./UPSTREAM.md)), and no
upstream test is removed or edited to make it pass.

## Team

**carbs**: Sofiane Ben Taleb ([@gamween](https://github.com/gamween)) and Armand Séchon
([@STOOOKEEE](https://github.com/STOOOKEEE)).

**Prior work.** An earlier design ("v2": a witness co-signer, `ForceQuantum`, XRP-only payments)
and a prototype of it exist in `STOOOKEEE/TTT` (branch `feat/signing-sessions`), along with the
preparation dossier of the current design (`docs/carbs/`). **Nothing from the prototype is used
here**: no file was copied, patched or retyped. The history of this repository starts with the
specification; every code commit after it is written here, and the upstream bases are imported
unmodified in their own commits ([`UPSTREAM.md`](./UPSTREAM.md)).

The web app starts from XRPL Commons' `create-xrp` template and follows the look of
xrpl-commons.org, with its fonts self-hosted under their own licences.

## License

[Apache-2.0](./LICENSE) for the code written in this repository; changes made inside `rippled/`
that are meant for the XRPL code base follow its ISC licence. Imported code keeps its own licence:
`rippled/LICENSE.md` (ISC), `ledger-app/LICENSE`, `security-key-app/LICENSE` and
`packages/signer-kit-xrp/LICENSE.MD` (Apache-2.0), and `apps/web/LICENSE` (MIT, the `create-xrp`
template). The fonts are Clash Display under the ITF Free Font License and Plus Jakarta Sans under
the SIL Open Font License 1.1 ([`apps/web/public/fonts/README.md`](./apps/web/public/fonts/README.md)).

<div align="center">
<sub>🏆 Winner of the Ledger Protocol Innovation track · XRPL Hackathon NYC · October 2026</sub>
</div>

/**
 * The amendments this fork adds to rippled (`rippled/include/xrpl/protocol/detail/features.macro`),
 * all enabled by `infra/standalone.cfg`, the configuration of the local and team nodes. None is
 * on the public AlphaNet. `amendments.test.ts` checks this list against both files.
 */
export interface CarbsAmendment {
  /** The name `feature` reports (`fix` + the macro's name for an `XRPL_FIX`). */
  name: string;
  /** What it does, in a few words. */
  what: string;
}

export const CARBS_AMENDMENTS: readonly CarbsAmendment[] = [
  { name: "SigningSessions", what: "signing sessions" },
  { name: "PasskeyMLDSA", what: "ML-DSA-44 passkeys" },
  { name: "fixPasskeyChallenge", what: "the WebAuthn challenge check" },
  { name: "fixP256StrictDer", what: "strict low-S P-256 signatures" },
  { name: "fixPasskeyListNotDelegable", what: "no delegated passkey list" },
];

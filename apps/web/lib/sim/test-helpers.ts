import {
  bytesToHex,
  canonicalizeDer,
  kLastLedgerSequenceOffset,
  SoftwareAuthenticator,
} from "@carbs/sessions";
import { TF_FULLY_CANONICAL_SIG } from "../constants";
import type { KeyHandle, NodeResult, TxJson } from "../ports";
import { accountIdOf, signWith, simPublicKey } from "./keys";
import { SimulatedNode, type SimulatedNodeOptions } from "./node";
import { simSigningData } from "./webauthn";
import { SimulatedWallet } from "./wallet";

let keyCounter = 0;

/**
 * A simulated key of any type the simulated node knows, P-256 included: the node still
 * supports P-256 session keys and passkeys, which the web app no longer makes.
 */
export function simKey(algorithm: "p256" | "mldsa44" | "secp256k1"): KeyHandle {
  keyCounter += 1;
  const publicKey = simPublicKey(algorithm, `test:${algorithm}:${keyCounter}`);
  return {
    algorithm,
    publicKey,
    address: accountIdOf(publicKey),
    sign: async (tx: TxJson) => signWith(publicKey, tx),
  };
}

/** A P-256 passkey of the software authenticator (real P-256, no prompt), for the simulated node. */
export function simPasskey(): KeyHandle {
  const rpId = "carbs.invalid";
  const authenticator = new SoftwareAuthenticator(`https://${rpId}`);
  const { credential } = authenticator;
  const publicKey = bytesToHex(credential.publicKey);
  return {
    algorithm: "p256",
    publicKey,
    address: accountIdOf(publicKey),
    async sign(tx: TxJson): Promise<TxJson> {
      const unsigned: TxJson = { ...tx, SigningPubKey: publicKey };
      delete unsigned.TxnSignature;
      delete unsigned["PasskeySignature"];
      const assertion = await authenticator.getAssertion({
        challenge: simSigningData(unsigned),
        credentialId: credential.credentialId,
        rpId,
      });
      return {
        ...unsigned,
        PasskeySignature: {
          PasskeyID: bytesToHex(credential.credentialId),
          AuthenticatorData: bytesToHex(assertion.authenticatorData),
          ClientDataJSON: bytesToHex(assertion.clientDataJSON),
          Signature: bytesToHex(canonicalizeDer(assertion.signature)),
        },
      };
    },
  };
}

export interface Rig {
  node: SimulatedNode;
  wallet: SimulatedWallet;
  master: KeyHandle;
  account: string;
}

/** A node with one funded account whose master key the test holds. */
export async function rig(options: SimulatedNodeOptions = {}): Promise<Rig> {
  const node = new SimulatedNode(options);
  const wallet = new SimulatedWallet();
  const master = await wallet.createMasterKey();
  await node.fundAccount(master.address);
  return { node, wallet, master, account: master.address };
}

export async function fundedAccount(r: Rig): Promise<KeyHandle> {
  const key = await r.wallet.createMasterKey();
  await r.node.fundAccount(key.address);
  return key;
}

/** Fill the envelope, sign with `key`, submit. `extra` can override or remove fields. */
export async function send(
  node: SimulatedNode,
  key: KeyHandle,
  tx: { TransactionType: string; Account: string } & Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<NodeResult> {
  const info = await node.accountInfo(tx.Account);
  const server = await node.serverInfo();
  const full: TxJson = {
    Fee: "12",
    Flags: TF_FULLY_CANONICAL_SIG,
    Sequence: info?.sequence ?? 0,
    LastLedgerSequence: server.ledgerIndex + 1 + kLastLedgerSequenceOffset,
    ...tx,
    ...extra,
  };
  return node.submit(await key.sign(full));
}

/** Open a session and return the session key. */
export async function openSession(
  r: Rig,
  fields: Record<string, unknown>,
  algorithm: "p256" | "mldsa44" = "p256",
): Promise<{ key: KeyHandle; result: NodeResult }> {
  const key = simKey(algorithm);
  const result = await send(r.node, r.master, {
    TransactionType: "SigningSessionSet",
    Account: r.account,
    SessionKey: key.address,
    SessionDuration: 600,
    ...fields,
  });
  return { key, result };
}

export function pay(account: string, destination: string, drops: number): TxJson {
  return {
    TransactionType: "Payment",
    Account: account,
    Destination: destination,
    Amount: String(drops),
    Fee: "12",
  };
}

export async function secondsUntilExpiry(node: SimulatedNode, account: string): Promise<number> {
  const objects = await node.accountObjects(account);
  const server = await node.serverInfo();
  const session = objects.sessions[0];
  if (session === undefined) throw new Error("no session");
  return session.expiration - server.closeTime;
}

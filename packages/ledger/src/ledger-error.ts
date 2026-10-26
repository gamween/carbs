/**
 * A message for the user from whatever a device call threw: this package's `DeviceError`, or a
 * Device Management Kit error, which is a plain object (`_tag`, `errorCode`, `message`,
 * `originalError`; `@ledgerhq/device-management-kit` 1.11.0, `lib/types/src/api/Error.d.ts`)
 * and would otherwise print as `[object Object]`.
 */

import { DeviceError, formatStatusWord, kSw } from "./apdu.js";

/**
 * Status words the device OS sends, not the XRP app (`kSw` holds the app's own): the device is
 * locked, or the XRP app is not the app in front. A Stax answers `0x650f` to an XRP app command
 * while the dashboard or another app (the Security Key app, for one) is open; seen on the
 * owner's Stax.
 */
export const kSwOs = { locked: 0x5515, appNotOpen: 0x650f } as const;

const kStatusWordHex = /^[0-9a-f]{4}$/i;

const kOpenXrpApp = "open the XRP app on the Stax";

const kStatusHints = new Map<number, string>([
  [kSw.denied, "refused on the device"],
  [kSwOs.locked, `the device is locked: unlock it, then ${kOpenXrpApp}`],
  [
    kSwOs.appNotOpen,
    `the XRP app is not open on the device (the dashboard or another app, such as Security Key, is): ${kOpenXrpApp}`,
  ],
  [kSw.noSignature, "the device is locked, or no signature is waiting on it"],
  [
    kSw.insNotSupported,
    `the open app does not know this instruction: ${kOpenXrpApp} (an XRP app without the carbs ML-DSA-44 commands answers this too)`,
  ],
  [kSw.claNotSupported, `the open app is not the XRP app: ${kOpenXrpApp}`],
  [kSw.wrongData, "the XRP app refused the data"],
  [kSw.wrongLength, "the transaction is too large for the XRP app"],
  [kSw.sessionPolicyRefused, "blocked by your session policy on the device"],
  [
    kSw.sessionBlindRefused,
    "session transactions are never blind-signed: the device cannot show this one in clear",
  ],
]);

/**
 * Device Management Kit errors that carry no status word, by `_tag`
 * (`@ledgerhq/device-management-kit` 1.11.0).
 */
const kTagHints = new Map<string, string>([
  ["DeviceLockedError", `the device is locked: unlock it, then ${kOpenXrpApp}`],
  ["RefusedByUserDAError", "refused on the device"],
  [
    "NoAccessibleDeviceError",
    "no Ledger was picked: plug in the Stax, unlock it and choose it in the browser's list",
  ],
  [
    "DeviceDisconnectedWhileSendingError",
    "the device was disconnected: plug it in again and connect it",
  ],
]);

function stringField(error: object, key: string): string | undefined {
  const value: unknown = Reflect.get(error, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The status word of the error or of the error it wraps. */
function statusWordOf(error: object): number | undefined {
  if (error instanceof DeviceError) return error.statusWord;
  const code = stringField(error, "errorCode");
  if (code !== undefined && kStatusWordHex.test(code)) return Number.parseInt(code, 16);
  const original: unknown = Reflect.get(error, "originalError");
  return typeof original === "object" && original !== null ? statusWordOf(original) : undefined;
}

export function describeLedgerError(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const statusWord = statusWordOf(error);
  const hint = statusWord === undefined ? undefined : kStatusHints.get(statusWord);
  if (statusWord !== undefined && hint !== undefined)
    return `${hint} (${formatStatusWord(statusWord)})`;
  if (error instanceof Error) return error.message;
  const tagHint = kTagHints.get(stringField(error, "_tag") ?? "");
  if (tagHint !== undefined) return tagHint;
  return [
    stringField(error, "_tag") ?? "Ledger error",
    stringField(error, "errorCode"),
    stringField(error, "message"),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

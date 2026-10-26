import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CARBS_AMENDMENTS } from "./amendments";

const read = (path: string) =>
  readFileSync(join(import.meta.dirname, "..", "..", "..", path), "utf8");

describe("the amendments the front names", () => {
  it("are defined in rippled and enabled in the standalone configuration", () => {
    const macro = read("rippled/include/xrpl/protocol/detail/features.macro");
    const cfg = read("infra/standalone.cfg");
    for (const { name } of CARBS_AMENDMENTS) {
      const fix = name.startsWith("fix");
      const macroName = fix ? name.slice("fix".length) : name;
      const definition = new RegExp(
        `^${fix ? "XRPL_FIX" : "XRPL_FEATURE"}\\s*\\(${macroName}\\s*,\\s*Supported::Yes`,
        "m",
      );
      expect(macro, name).toMatch(definition);
      expect(cfg, name).toMatch(new RegExp(`^[0-9A-F]{64} ${name}$`, "m"));
    }
  });

  it("are the five of this fork", () => {
    expect(CARBS_AMENDMENTS.map((a) => a.name)).toEqual([
      "SigningSessions",
      "PasskeyMLDSA",
      "fixPasskeyChallenge",
      "fixP256StrictDer",
      "fixPasskeyListNotDelegable",
    ]);
  });
});

/**
 * The one choice of the header: which node the Account, Session, Actions and Attack screens
 * run on. The simulation is the default until a node is chosen; the local node runs on the
 * person's machine (`pnpm demo`), the team node on the team's server. The Quantum screen reads
 * the public networks and does not follow this choice.
 */
export type NodeChoice = "simulated" | "local" | "team";

/** The live choices, in the order the header lists them. */
export type LiveNodeChoice = Exclude<NodeChoice, "simulated">;

export const NODE_CHOICES: readonly { id: NodeChoice; label: string }[] = [
  { id: "local", label: "Local node" },
  { id: "team", label: "Team node" },
  { id: "simulated", label: "Simulated" },
];

export const NODE_STORAGE_KEY = "carbs-node";

export function isNodeChoice(value: unknown): value is NodeChoice {
  return value === "simulated" || value === "local" || value === "team";
}

export function isLiveChoice(value: NodeChoice): value is LiveNodeChoice {
  return value !== "simulated";
}

/** Minimal storage surface, so tests can pass a fake (or none). */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The build's default (`NUXT_PUBLIC_BACKEND`): `local` or `team`; `live`, its former value,
 * means the local node; anything else is the simulation.
 */
export function defaultNodeChoice(fallback: unknown): NodeChoice {
  if (fallback === "live") return "local";
  return isNodeChoice(fallback) ? fallback : "simulated";
}

/** The choice saved in this browser, or null if none was made (or storage is blocked). */
export function readSavedNodeChoice(storage: ChoiceStorage | null): NodeChoice | null {
  try {
    const saved = storage?.getItem(NODE_STORAGE_KEY);
    if (isNodeChoice(saved)) return saved;
  } catch {
    // Storage can be blocked: nothing is saved.
  }
  return null;
}

/** The saved choice, else the build's default, else the simulation. */
export function readNodeChoice(storage: ChoiceStorage | null, fallback: unknown): NodeChoice {
  return readSavedNodeChoice(storage) ?? defaultNodeChoice(fallback);
}

export function saveNodeChoice(storage: ChoiceStorage | null, choice: NodeChoice): void {
  try {
    storage?.setItem(NODE_STORAGE_KEY, choice);
  } catch {
    // Not saved; the choice then lasts for this page only.
  }
}

/** Forget the saved choice: the build's default applies on the next load. */
export function clearNodeChoice(storage: ChoiceStorage | null): void {
  try {
    storage?.removeItem(NODE_STORAGE_KEY);
  } catch {
    // Nothing saved, or storage blocked.
  }
}

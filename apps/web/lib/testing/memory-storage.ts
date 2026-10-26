import type { ChoiceStorage } from "../node-choice";

/** A Map behind the storage surface of the browser (tests only). */
export function memoryStorage(): ChoiceStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

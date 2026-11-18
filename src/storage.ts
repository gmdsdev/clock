export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** localStorage, ou null quando indisponível (modo privado, cookies bloqueados etc.). */
export function getBrowserStorage(): KeyValueStorage | null {
  try {
    const storage = globalThis.localStorage;
    const probe = "__clock_probe__";
    storage.setItem(probe, probe);
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** `localStorage`, or undefined when it is missing or blocked: even reading the global can throw (blocked site data). */
export function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

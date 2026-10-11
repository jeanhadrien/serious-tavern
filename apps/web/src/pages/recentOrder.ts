/** Shared most-recent-first ordering for the main lists (presets, workflows, chats). */
export function compareRecent<T extends { updatedAt: string; createdAt: string }>(
  a: T,
  b: T,
  nameOf: (item: T) => string,
): number {
  return (
    b.updatedAt.localeCompare(a.updatedAt) ||
    b.createdAt.localeCompare(a.createdAt) ||
    nameOf(a).localeCompare(nameOf(b))
  );
}

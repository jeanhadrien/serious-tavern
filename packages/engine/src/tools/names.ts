// The longest tool name every backend accepts (`toolNameSchema`).
const MAX_NAME = 64;

/**
 * A tool name from `base`: cut to the length limit, and numbered (`_2`, `_3`, ...) when a tool of the same
 * name exists already, so two long names that share their first 64 characters stay apart.
 */
export function uniqueToolName(base: string, taken: ReadonlySet<string>): string {
  let name = base.slice(0, MAX_NAME);
  for (let counter = 2; taken.has(name); counter++) {
    const suffix = `_${counter}`;
    name = `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
  }
  return name;
}

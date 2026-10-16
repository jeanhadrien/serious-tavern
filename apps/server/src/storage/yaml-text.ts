import { isDeepStrictEqual } from 'node:util';
import { Document, parse, stringify, visit } from 'yaml';

type Obj = Record<string, unknown>;

/** A plain object (not null, not an array): what a YAML mapping parses to. */
export const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Copy of `value` with the `first` keys first, the `last` keys last and every other key in between. */
export function arrange(value: Obj, first: readonly string[], last: readonly string[] = []): Obj {
  const result: Obj = {};
  for (const key of first) if (key in value) result[key] = value[key];
  for (const key of Object.keys(value)) if (!first.includes(key) && !last.includes(key)) result[key] = value[key];
  for (const key of last) if (key in value) result[key] = value[key];
  return result;
}

const STRINGIFY = { lineWidth: 0, blockQuote: 'literal', indent: 2 } as const;

const safeParse = (text: string): unknown => {
  try {
    return parse(text, { logLevel: 'error' });
  } catch {
    return undefined;
  }
};

// Block scalars cannot carry some content (e.g. whitespace-only lines); those strings get double quotes.
const canBeBlock = (value: string) => safeParse(stringify(value, STRINGIFY)) === value;

function render(value: Obj, block: (text: string) => boolean): string {
  const doc = new Document(value);
  visit(doc, {
    Scalar(_, node) {
      if (typeof node.value === 'string' && node.value.includes('\n') && !block(node.value)) node.type = 'QUOTE_DOUBLE';
    },
  });
  return doc.toString(STRINGIFY);
}

/**
 * Renders a plain object as YAML that people can read and edit: multi-line strings become literal block
 * scalars. Safety net: the output must read back to exactly `value`, else every multi-line string is
 * double-quoted; if even that fails, throws `<what> cannot be represented as YAML`.
 */
export function toReadableYaml(value: Obj, what: string): string {
  const text = render(value, canBeBlock);
  if (isDeepStrictEqual(safeParse(text), value)) return text;
  const quoted = render(value, () => false);
  if (!isDeepStrictEqual(safeParse(quoted), value)) throw new Error(`${what} cannot be represented as YAML`);
  return quoted;
}

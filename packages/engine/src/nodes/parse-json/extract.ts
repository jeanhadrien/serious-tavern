import { describeValue } from '../../text.js';

export const jsonExpectTypes = ['any', 'object', 'array', 'number', 'boolean', 'text'] as const;
export type JsonExpect = (typeof jsonExpectTypes)[number];

const expected: Record<Exclude<JsonExpect, 'any'>, string> = {
  object: 'an object',
  array: 'an array',
  number: 'a number',
  boolean: 'true or false',
  text: 'text',
};
// Bounds the search through long prose: each start scans forward once.
const MAX_STARTS = 100;

/** Returns `value` when it has the expected JSON type; throws a plain-language error otherwise. */
export function checkType(value: unknown, expect: JsonExpect): unknown {
  const ok =
    expect === 'any' ||
    (expect === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) ||
    (expect === 'array' && Array.isArray(value)) ||
    (expect === 'number' && typeof value === 'number') ||
    (expect === 'boolean' && typeof value === 'boolean') ||
    (expect === 'text' && typeof value === 'string');
  if (!ok) throw new Error(`Expected ${expected[expect as Exclude<JsonExpect, 'any'>]}, got ${describeValue(value)}`);
  return value;
}

function tryParse(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** End (exclusive) of the bracketed span opening at `start`, skipping brackets inside strings. */
function balancedEnd(text: string, start: number): number | undefined {
  const closers: string[] = [];
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') closers.push('}');
    else if (char === '[') closers.push(']');
    else if (char === '}' || char === ']') {
      if (closers.pop() !== char) return undefined;
      if (!closers.length) return i + 1;
    }
  }
  return undefined;
}

/** First balanced `{…}` or `[…]` span of the text that parses as JSON. */
function findBalanced(text: string): { value: unknown } | undefined {
  let starts = 0;
  for (let i = 0; i < text.length && starts < MAX_STARTS; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    starts++;
    const end = balancedEnd(text, i);
    const parsed = end === undefined ? undefined : tryParse(text.slice(i, end));
    if (parsed) return parsed;
  }
  return undefined;
}

/**
 * Reads one JSON value out of text such as an LLM answer: the first fenced code block if there is one
 * (an unterminated fence runs to the end), then the whole text, then the first balanced object or array
 * inside it. A number or boolean must be the whole text, so "Rating: 7" is not 7.
 */
export function extractJson(text: string, expect: JsonExpect): unknown {
  let candidate = text.trim();
  // The info string (```json) only counts when a line break follows it, so ```7``` keeps its 7.
  const fence = /```(?:[\w+-]*[^\S\n]*\n)?([\s\S]*?)(?:```|$)/.exec(candidate);
  if (fence) candidate = fence[1]!.trim();
  if (expect === 'number' || expect === 'boolean') {
    const parsed = tryParse(candidate);
    if (!parsed)
      throw new Error(
        expect === 'number'
          ? 'Expected a number, but the text is not a plain number'
          : 'Expected true or false, but the text is not a plain true or false',
      );
    return checkType(parsed.value, expect);
  }
  const parsed = tryParse(candidate) ?? findBalanced(candidate);
  if (!parsed) throw new Error('No JSON value found in the text');
  return checkType(parsed.value, expect);
}

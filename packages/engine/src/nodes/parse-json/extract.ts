import { describeValue } from '../../text.js';

export const jsonExpectTypes = ['any', 'object', 'array', 'number', 'boolean', 'text'] as const;
export type JsonExpect = (typeof jsonExpectTypes)[number];

/** Plain-language name of each expected type, for errors and port descriptions. */
export const expectedLabel: Record<Exclude<JsonExpect, 'any'>, string> = {
  object: 'an object',
  array: 'an array',
  number: 'a number',
  boolean: 'true or false',
  text: 'text',
};
// Bounds the search through long prose: each start scans forward once.
const MAX_STARTS = 100;

function hasType(value: unknown, expect: JsonExpect): boolean {
  return (
    expect === 'any' ||
    (expect === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) ||
    (expect === 'array' && Array.isArray(value)) ||
    // JSON.parse('1e999') is Infinity, which no JSON consumer can hold.
    (expect === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (expect === 'boolean' && typeof value === 'boolean') ||
    (expect === 'text' && typeof value === 'string')
  );
}

/** Returns `value` when it has the expected JSON type; throws a plain-language error otherwise. */
export function checkType(value: unknown, expect: JsonExpect): unknown {
  if (!hasType(value, expect))
    throw new Error(`Expected ${expectedLabel[expect as Exclude<JsonExpect, 'any'>]}, got ${describeValue(value)}`);
  return value;
}

function tryParse(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/**
 * Scans the bracketed span opening at `start`, skipping brackets inside strings: `end` (exclusive) when it
 * closes, `mismatch` (index of a closer that doesn't match) or neither when the text ends first.
 */
function scanSpan(text: string, start: number): { end?: number; mismatch?: number } {
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
      if (closers.pop() !== char) return { mismatch: i };
      if (!closers.length) return { end: i + 1 };
    }
  }
  return {};
}

/**
 * First top-level `{…}` or `[…]` span that parses with the expected type, otherwise the first one that parses
 * (so the caller reports the type mismatch). Brackets nested in a span are never tried on their own: when the
 * outer value is malformed (trailing comma, single quotes) or cut off, an inner fragment is not the answer.
 */
function findBalanced(text: string, expect: JsonExpect): { value: unknown } | undefined {
  let mismatched: { value: unknown } | undefined;
  for (let i = 0, starts = 0; i < text.length && starts < MAX_STARTS; i++) {
    if (text[i] !== '{' && text[i] !== '[') continue;
    starts++;
    const span = scanSpan(text, i);
    if (span.end !== undefined) {
      const parsed = tryParse(text.slice(i, span.end));
      if (parsed && hasType(parsed.value, expect)) return parsed;
      mismatched ??= parsed;
      i = span.end - 1;
    } else if (span.mismatch !== undefined) {
      i = span.mismatch;
    } else if (text[i] === '{' || /^\[\s*[[{]/.test(text.slice(i, i + 64))) {
      // Never closes: the rest of the text is inside this value. A lone `[` of prose ("[sic") is skipped.
      break;
    }
  }
  return mismatched;
}

/**
 * Reads one JSON value out of text such as an LLM answer: the whole text if it is JSON, otherwise the first
 * fenced code block if there is one (an unterminated fence runs to the end), then the first top-level object
 * or array inside it. A number or boolean must be the whole candidate, so "Rating: 7" is not 7.
 */
export function extractJson(text: string, expect: JsonExpect): unknown {
  const trimmed = text.trim();
  // Valid JSON wins as it is, even when one of its strings holds a code fence.
  const whole = tryParse(trimmed);
  if (whole) return checkType(whole.value, expect);
  let candidate = trimmed;
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
  const parsed = tryParse(candidate) ?? findBalanced(candidate, expect);
  if (!parsed) throw new Error('No JSON value found in the text');
  return checkType(parsed.value, expect);
}

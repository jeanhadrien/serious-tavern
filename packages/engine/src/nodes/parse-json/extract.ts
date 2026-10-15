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

const outOfText = Symbol('out of text');
const notJson = Symbol('not JSON');

/**
 * True when the text from `start` on is the beginning of a JSON value that the end of the text cuts off
 * (`["x", {"a": 1}, {"b":`), false when it stops being JSON before then (prose such as `[sic` or `Use { here`).
 */
function isCutOffJson(text: string, start: number): boolean {
  let i = start;
  const peek = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
    if (i >= text.length) throw outOfText;
    return text[i]!;
  };
  const take = (char: string) => {
    if (peek() !== char) throw notJson;
    i++;
  };
  const string = () => {
    take('"');
    for (; i < text.length; i++) {
      if (text[i] === '\\') i++;
      else if (text[i] === '"') {
        i++;
        return;
      } else if (text[i]! < ' ') throw notJson;
    }
    throw outOfText;
  };
  // Runs `item` for each entry up to and including the closer, starting on the opening bracket.
  const items = (close: string, item: () => void) => {
    i++;
    while (peek() !== close) {
      item();
      if (peek() !== close) take(',');
    }
    i++;
  };
  const value = (): void => {
    const char = peek();
    if (char === '{')
      items('}', () => {
        string();
        take(':');
        value();
      });
    else if (char === '[') items(']', value);
    else if (char === '"') string();
    else {
      const token = /[\w.+-]+/y;
      token.lastIndex = i;
      const scalar = token.exec(text)?.[0] ?? '';
      i += scalar.length;
      if (i >= text.length) throw outOfText;
      // The token is letters, digits and signs only, so whatever parses is a number, true, false or null.
      if (!tryParse(scalar)) throw notJson;
    }
  };
  try {
    value();
    return true;
  } catch (error) {
    // Nesting too deep for the stack is not prose: stop there.
    return error === outOfText || error instanceof RangeError;
  }
}

/**
 * First top-level `{…}` or `[…]` span that parses with the expected type, otherwise the first one that parses
 * (so the caller reports the type mismatch). Brackets nested in a span are never tried on their own: when the
 * outer value is malformed (trailing comma, single quotes) or cut off, an inner fragment is not the answer.
 * A bracket that never closes ends the search when it opens JSON cut off by the end of the text, and is skipped
 * as prose otherwise.
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
    } else if (isCutOffJson(text, i)) {
      // The rest of the text is inside this value, so anything found further on would be a fragment of it.
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
  // An empty fence is the closing half of a prefilled ```json: the value comes before it.
  if (fence) candidate = fence[1]!.trim() || candidate.slice(0, fence.index).trim() || candidate;
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

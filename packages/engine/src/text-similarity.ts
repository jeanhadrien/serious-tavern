// Deterministic text measures (no model, no network): tokens, word n-grams, set overlap and proper names. The
// Stagnation node is built on them; keep them free of node and context types so other features can reuse them.

// Scripts written without spaces: every character is a token of its own, so n-grams still compare something.
const UNSPACED = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}`;
const LETTER = `(?:(?![${UNSPACED}])[\\p{L}\\p{M}\\p{N}])`;
// A spaced word ends where an unspaced script starts, so `Tokyoに` is `Tokyo` and `に`; `don't` stays one word.
const WORD = new RegExp(`[${UNSPACED}]|${LETTER}+(?:['’]${LETTER}+)*`, 'gu');

/** A word of the text with its position, case kept. Letters, marks and digits of any script. */
export type Word = { text: string; index: number };

/** The words of the text in order, case kept. Han, Hiragana and Katakana give one word per character. */
export const wordsOf = (text: string): Word[] =>
  [...text.matchAll(WORD)].map((match) => ({ text: match[0], index: match.index }));

/** Lowercased words, punctuation stripped. */
export const tokenize = (text: string): string[] => wordsOf(text).map((word) => word.text.toLowerCase());

/** Overlapping runs of `n` consecutive tokens, each joined by a space. Fewer than `n` tokens give none. */
export function ngrams(tokens: readonly string[], n: number): string[] {
  const size = Math.max(1, Math.floor(n));
  const grams: string[] = [];
  for (let at = 0; at + size <= tokens.length; at++) grams.push(tokens.slice(at, at + size).join(' '));
  return grams;
}

/**
 * |A ∩ B| / |A ∪ B| over the distinct items. Nothing to compare (either side empty) is 0, not 1: two texts too short
 * to have n-grams are not "identical".
 */
export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const left = new Set(a);
  const right = new Set(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const item of left) if (right.has(item)) shared++;
  return shared / (left.size + right.size - shared);
}

/** The text before a word ends a sentence (or there is none): quotes, brackets and emphasis marks are looked through. */
const SENTENCE_START = /(?:^|[.!?…\n。！？])[\s"“”'‘’«»([*_—–-]*$/u;
const LOOKBACK = 12;

// Capitalised words that are not names in the middle of a sentence ("I", "I'm", titles of address, days, months).
const NOT_NAMES = new Set(
  (
    "i i'm i'll i'd i've a an the and but or so if then this that these those he she it we you they his her its our " +
    'your their my mr mrs ms dr sir lady lord monday tuesday wednesday thursday friday saturday sunday january february ' +
    'march april may june july august september october november december'
  ).split(' '),
);

const startsUpper = (word: string) => {
  const first = word.codePointAt(0)!;
  const char = String.fromCodePoint(first);
  return char !== char.toLowerCase() && char === char.toUpperCase();
};

/**
 * The capitalised words of the text that read as names, lowercased: those inside a sentence, plus (when `known` has
 * them) sentence-initial ones, which on their own are indistinguishable from any other capitalised word. Scripts
 * without case have none. `exclude` holds lowercased words to leave out (the cast everyone already knows).
 */
export function properNames(
  text: string,
  options: { exclude?: ReadonlySet<string>; known?: ReadonlySet<string> } = {},
): Set<string> {
  const names = new Set<string>();
  for (const { text: word, index } of wordsOf(text)) {
    const lower = word.toLowerCase();
    if (word.length < 2 || !startsUpper(word) || NOT_NAMES.has(lower) || options.exclude?.has(lower)) continue;
    const initial = SENTENCE_START.test(text.slice(Math.max(0, index - LOOKBACK), index));
    if (!initial || options.known?.has(lower)) names.add(lower);
  }
  return names;
}

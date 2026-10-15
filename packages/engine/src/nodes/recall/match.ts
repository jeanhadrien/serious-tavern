export type MatchOptions = { caseSensitive: boolean; wholeWords: boolean };

// Letters, marks and digits of any script, plus `_`: what a word is made of for whole-word matching.
const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;
const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{M}\\p{N}_])';

// Only syntax characters: the `u` flag rejects needless escapes such as `\-`.
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A matcher for one keyword, or null for a blank one. Keywords are literal text (regex characters match
 * themselves). With `wholeWords`, a side of the keyword only needs a word boundary when its edge character
 * is a word character, so `C++` and `#tag` still match; boundaries understand every script (`Борин` does
 * not match inside `Борина`).
 */
export function keywordMatcher(keyword: string, options: MatchOptions): RegExp | null {
  const literal = keyword.trim();
  if (!literal) return null;
  let source = escapeRegExp(literal);
  if (options.wholeWords) {
    const chars = [...literal];
    if (WORD_CHAR.test(chars[0]!)) source = BEFORE + source;
    if (WORD_CHAR.test(chars.at(-1)!)) source += AFTER;
  }
  return new RegExp(source, options.caseSensitive ? 'u' : 'iu');
}

/** True when any matcher finds its keyword in one of the texts. Each text is searched on its own. */
export const anyMatch = (matchers: readonly RegExp[], texts: readonly string[]) =>
  matchers.some((matcher) => texts.some((text) => matcher.test(text)));
